import { now } from './util.js';

/**
 * Workflow definitions are plain objects:
 *
 * {
 *   id: 'jira-to-qa-report',
 *   name: '...',
 *   input: zodSchema,                // validated before the run starts
 *   steps: [
 *     { id, name, agent, action,
 *       input:  (ctx) => ({...}),    // build the agent input from run context
 *       when:   (ctx) => boolean,    // conditional execution (skipped when false)
 *       approval: { title: (ctx)=>string, summary: (ctx)=>string }, // human gate
 *       retries, timeoutMs, continueOnError },
 *     { id, name, parallel: [step, step, ...] },   // branches run concurrently
 *   ],
 *   output: (ctx) => any,            // final run output
 * }
 *
 * ctx = { input, steps: { [stepId]: output }, run: { id } }
 */

export function flattenSteps(steps, parentId = null) {
  const out = [];
  for (const s of steps) {
    if (s.parallel) {
      out.push({ ...s, kind: 'parallel', parentId });
      out.push(...flattenSteps(s.parallel, s.id));
    } else {
      out.push({ ...s, kind: 'task', parentId });
    }
  }
  return out;
}

/** Static description of a workflow graph for visualization. */
export function describeWorkflow(def) {
  const nodes = [];
  const edges = [];
  let prev = ['__start'];
  nodes.push({ id: '__start', name: 'Start', kind: 'terminal' });
  for (const step of def.steps) {
    if (step.parallel) {
      const ids = step.parallel.map((b) => b.id);
      for (const b of step.parallel) {
        nodes.push(nodeOf(b, step.id));
        prev.forEach((p) => edges.push({ from: p, to: b.id }));
      }
      prev = ids;
    } else {
      nodes.push(nodeOf(step, null));
      prev.forEach((p) => edges.push({ from: p, to: step.id }));
      prev = [step.id];
    }
  }
  nodes.push({ id: '__end', name: 'End', kind: 'terminal' });
  prev.forEach((p) => edges.push({ from: p, to: '__end' }));
  return { id: def.id, name: def.name, description: def.description, nodes, edges };
}

function nodeOf(step, group) {
  return {
    id: step.id,
    name: step.name || step.id,
    kind: 'task',
    agent: step.agent,
    action: step.action,
    conditional: Boolean(step.when),
    condition: step.whenLabel || null,
    approval: Boolean(step.approval),
    group,
  };
}

export class WorkflowEngine {
  /**
   * @param {object} deps
   * @param {(req) => Promise<any>} deps.dispatch  executes one agent action, returns its output
   * @param {(req) => Promise<{approved:boolean, comment?:string}>} deps.requestApproval
   * @param {(run) => void} deps.onUpdate          persist + broadcast run state
   * @param {object} deps.log
   */
  constructor({ dispatch, requestApproval, onUpdate, log }) {
    this.dispatch = dispatch;
    this.requestApproval = requestApproval;
    this.onUpdate = onUpdate;
    this.log = log;
  }

  async execute(def, run, signal) {
    const ctx = { input: run.input, steps: {}, run: { id: run.id } };
    run.status = 'running';
    run.startedAt = now();
    this.onUpdate(run, 'run.started');
    try {
      for (const step of def.steps) {
        if (signal?.aborted) throw Object.assign(new Error('Run cancelled'), { code: 'CANCELLED' });
        if (step.parallel) await this.#parallel(step, ctx, run, signal);
        else await this.#task(step, ctx, run, signal);
      }
      run.output = def.output ? safe(() => def.output(ctx)) : ctx.steps;
      run.status = 'succeeded';
    } catch (err) {
      run.status = err.code === 'CANCELLED' ? 'cancelled' : 'failed';
      run.error = { message: err.message, stepId: err.stepId || null };
      this.log.error(`Run ${run.id} ${run.status}: ${err.message}`);
    } finally {
      run.finishedAt = now();
      run.durationMs = Date.parse(run.finishedAt) - Date.parse(run.startedAt);
      this.onUpdate(run, `run.${run.status}`);
    }
    return run;
  }

  async #parallel(group, ctx, run, signal) {
    const state = this.#state(run, group.id);
    if (group.when && !safe(() => group.when(ctx))) return this.#skip(run, state, group.whenLabel);
    Object.assign(state, { status: 'running', startedAt: now() });
    this.onUpdate(run, 'step.started', state);
    const results = await Promise.allSettled(group.parallel.map((branch) => this.#task(branch, ctx, run, signal)));
    const failed = results.find((r) => r.status === 'rejected');
    Object.assign(state, { status: failed ? 'failed' : 'succeeded', finishedAt: now() });
    this.onUpdate(run, failed ? 'step.failed' : 'step.completed', state);
    if (failed) throw failed.reason;
  }

  async #task(step, ctx, run, signal) {
    const state = this.#state(run, step.id);
    if (step.when && !safe(() => step.when(ctx))) return this.#skip(run, state, step.whenLabel);

    let input;
    try {
      input = step.input ? step.input(ctx) : ctx.input;
    } catch (err) {
      throw Object.assign(new Error(`Step "${step.id}" could not build its input: ${err.message}`), { stepId: step.id });
    }

    if (step.approval) {
      Object.assign(state, { status: 'waiting_approval', startedAt: now() });
      run.status = 'waiting_approval';
      this.onUpdate(run, 'step.waiting_approval', state);
      const decision = await this.requestApproval({
        runId: run.id,
        stepId: step.id,
        agentId: step.agent,
        action: step.action,
        title: safe(() => step.approval.title(ctx)) || step.name,
        summary: safe(() => step.approval.summary(ctx)) || '',
        payload: input,
      });
      run.status = 'running';
      state.approval = { id: decision.id, status: decision.status, decidedBy: decision.decidedBy, comment: decision.comment };
      if (decision.status !== 'approved') {
        Object.assign(state, { status: 'rejected', finishedAt: now() });
        this.onUpdate(run, 'step.rejected', state);
        ctx.steps[step.id] = null;
        return;
      }
    }

    Object.assign(state, { status: 'running', startedAt: state.startedAt || now() });
    this.onUpdate(run, 'step.started', state);
    try {
      const output = await this.dispatch({
        runId: run.id,
        stepId: step.id,
        agentId: step.agent,
        action: step.action,
        input,
        retries: step.retries,
        timeoutMs: step.timeoutMs,
        signal,
        onAttempt: (attempt) => {
          state.attempts = attempt;
        },
      });
      ctx.steps[step.id] = output;
      run.outputs[step.id] = output;
      Object.assign(state, { status: 'succeeded', finishedAt: now(), summary: step.summarize ? safe(() => step.summarize(output)) : null });
      this.onUpdate(run, 'step.completed', state);
      return output;
    } catch (err) {
      Object.assign(state, { status: 'failed', finishedAt: now(), error: err.message });
      this.onUpdate(run, 'step.failed', state);
      if (step.continueOnError) {
        ctx.steps[step.id] = null;
        return null;
      }
      throw Object.assign(err, { stepId: step.id });
    }
  }

  #skip(run, state, reason) {
    Object.assign(state, { status: 'skipped', startedAt: now(), finishedAt: now(), summary: reason ? `Condition not met: ${reason}` : 'Condition not met' });
    this.onUpdate(run, 'step.skipped', state);
    return null;
  }

  #state(run, stepId) {
    return run.steps.find((s) => s.id === stepId);
  }
}

function safe(fn) {
  try {
    return fn();
  } catch {
    return undefined;
  }
}
