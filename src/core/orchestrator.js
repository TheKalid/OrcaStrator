import { AgentTask, AgentResult } from './contracts.js';
import { WorkflowEngine, flattenSteps, describeWorkflow } from './workflow-engine.js';
import { newId, now, Semaphore, withTimeout, sleep } from './util.js';

/**
 * The central orchestrator. It is the only component that talks to agents:
 * it assigns tasks, enforces contracts, concurrency, timeouts and retries,
 * runs workflows, gates sensitive actions behind human approval, records
 * traceability and exposes everything as events for observability.
 *
 * It knows nothing about any specific LLM provider or external system; those
 * are injected into agents through the AgentContext.
 */
export class Orchestrator {
  constructor({ config, registry, bus, store, memory, trace, metrics, approvals, logger, llm, integrations, tools }) {
    Object.assign(this, { config, registry, bus, store, memory, trace, metrics, approvals, logger, llm, integrations, tools });
    this.workflows = new Map();
    this.agentLimits = new Map();
    this.runLimit = new Semaphore(config.orchestrator.maxConcurrentRuns);
    this.activeRuns = new Map(); // runId -> AbortController
    this.schedules = new Map();
  }

  // ---------------------------------------------------------------- agents
  async registerAgent(agent) {
    this.registry.register(agent);
    this.agentLimits.set(agent.id, new Semaphore(agent.concurrency || this.config.orchestrator.defaultAgentConcurrency));
    await agent.init?.(this.agentContext(agent, { runId: null, stepId: null, taskId: 'init' }));
    this.bus.publish('agent.registered', agent.describe());
    return agent;
  }

  listAgents() {
    return this.registry.list().map((a) => ({
      ...a.describe(),
      ...this.metrics.status(a.id),
      metrics: this.metrics.snapshot(a.id),
      queued: this.agentLimits.get(a.id)?.pending || 0,
    }));
  }

  /** Scoped capabilities handed to an agent for one task. */
  agentContext(agent, { runId, stepId, taskId, signal }) {
    const log = this.logger.child({ agentId: agent.id, runId: runId || undefined, stepId: stepId || undefined });
    const usage = { llmCalls: 0, tokensIn: 0, tokensOut: 0 };
    const pendingTrace = { nodes: [], edges: [] };
    return {
      agentId: agent.id,
      runId,
      stepId,
      taskId,
      signal,
      log,
      config: this.config,
      integrations: this.integrations,
      tools: this.tools,
      memory: this.memory.view(runId, agent.id),
      llm: this.llm.withUsage(usage, log),
      usage,
      trace: (nodes = [], edges = []) => {
        pendingTrace.nodes.push(...nodes);
        pendingTrace.edges.push(...edges);
      },
      pendingTrace,
      emit: (type, payload) => this.bus.publish(type, { agentId: agent.id, runId, ...payload }),
      // Agents may delegate to other agents through the orchestrator (never directly).
      delegate: (agentId, action, input) => this.dispatch({ agentId, action, input, runId, stepId }),
    };
  }

  /**
   * Execute one agent action with validation, concurrency limits, timeout and retries.
   * Returns the validated output or throws.
   */
  async dispatch({ agentId, action, input, runId = null, stepId = null, retries, timeoutMs, signal, onAttempt }) {
    const agent = this.registry.get(agentId);
    const def = agent.actions.get(action);
    if (!def) throw Object.assign(new Error(`Agent "${agentId}" has no action "${action}"`), { code: 'ACTION_NOT_FOUND' });

    const parsedInput = def.input ? def.input.parse(input) : input;
    const maxAttempts = 1 + (retries ?? this.config.orchestrator.defaultRetries);
    const limit = this.agentLimits.get(agentId);
    let lastError;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (signal?.aborted) throw Object.assign(new Error('Run cancelled'), { code: 'CANCELLED' });
      onAttempt?.(attempt);
      const task = AgentTask.parse({ id: newId('task'), runId, stepId, agentId, action, input: parsedInput, attempt, createdAt: now() });
      const result = await limit.run(() => this.#execute(agent, def, task, timeoutMs, signal));
      this.metrics.finished(agentId, result, { retried: attempt > 1 });
      this.bus.publish('task.finished', { ...result, runId, stepId, attempt, output: undefined });

      if (result.status === 'succeeded') {
        if (result.trace) this.trace.record(result.trace, runId);
        return result.output;
      }
      lastError = Object.assign(new Error(result.error.message), result.error);
      if (!result.error.retryable || attempt === maxAttempts) break;
      this.logger.child({ agentId, runId, stepId }).warn(`Attempt ${attempt} failed, retrying: ${result.error.message}`);
      await sleep(Math.min(250 * 2 ** (attempt - 1), 4000));
    }
    throw lastError;
  }

  async #execute(agent, def, task, timeoutMs, signal) {
    const startedAt = now();
    const t0 = performance.now();
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    const ctx = this.agentContext(agent, { runId: task.runId, stepId: task.stepId, taskId: task.id, signal: controller.signal });
    this.metrics.started(agent.id, task);
    this.bus.publish('task.started', { taskId: task.id, agentId: agent.id, action: task.action, runId: task.runId, stepId: task.stepId, attempt: task.attempt });
    ctx.log.info(`→ ${task.action}${task.attempt > 1 ? ` (attempt ${task.attempt})` : ''}`);

    let result;
    try {
      const raw = await withTimeout(def.handler(task.input, ctx), timeoutMs || this.config.orchestrator.defaultTaskTimeoutMs, () => controller.abort());
      const output = def.output ? def.output.parse(raw) : raw;
      result = { status: 'succeeded', output };
      ctx.log.info(`✓ ${task.action} (${Math.round(performance.now() - t0)}ms)`);
    } catch (err) {
      const isValidation = err?.name === 'ZodError';
      result = {
        status: 'failed',
        error: {
          message: isValidation ? `Output contract violation: ${err.message}` : err.message || String(err),
          code: err.code || (isValidation ? 'CONTRACT_VIOLATION' : 'AGENT_ERROR'),
          retryable: err.retryable ?? (!isValidation && err.code !== 'CANCELLED'),
        },
      };
      ctx.log.error(`✗ ${task.action}: ${result.error.message}`);
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }

    return AgentResult.parse({
      taskId: task.id,
      agentId: agent.id,
      action: task.action,
      ...result,
      trace: ctx.pendingTrace,
      metrics: { durationMs: Math.round(performance.now() - t0), ...ctx.usage },
      startedAt,
      finishedAt: now(),
    });
  }

  // ------------------------------------------------------------- workflows
  registerWorkflow(def) {
    this.workflows.set(def.id, def);
  }

  listWorkflows() {
    return [...this.workflows.values()].map(describeWorkflow);
  }

  startRun(workflowId, input = {}, { trigger = 'manual', label } = {}) {
    const def = this.workflows.get(workflowId);
    if (!def) throw Object.assign(new Error(`Workflow "${workflowId}" not found`), { status: 404 });
    // Workflows that take an environment run against the active one unless told otherwise.
    const envs = this.integrations?.environments;
    if (envs && def.input?.shape?.environment) {
      input = { ...input, environment: input.environment || envs.active };
      envs.assert(input.environment);
    }
    const parsedInput = def.input ? def.input.parse(input) : input;
    const run = {
      id: newId('run'),
      workflowId,
      workflowName: def.name,
      label: label || (def.label ? def.label(parsedInput) : workflowId),
      trigger,
      input: parsedInput,
      status: 'queued',
      createdAt: now(),
      startedAt: null,
      finishedAt: null,
      durationMs: null,
      steps: flattenSteps(def.steps).map((s) => ({
        id: s.id, name: s.name || s.id, kind: s.kind, parentId: s.parentId, agent: s.agent || null, action: s.action || null,
        status: 'pending', startedAt: null, finishedAt: null, attempts: 0, error: null, summary: null,
      })),
      outputs: {},
      output: null,
      error: null,
    };
    this.#saveRun(run, 'run.queued');

    const controller = new AbortController();
    this.activeRuns.set(run.id, controller);
    const engine = new WorkflowEngine({
      dispatch: (req) => this.dispatch(req),
      requestApproval: (req) => this.approvals.request(req).decision,
      onUpdate: (r, type, step) => this.#saveRun(r, type, step),
      log: this.logger.child({ runId: run.id }),
    });
    run.done = this.runLimit
      .run(() => engine.execute(def, run, controller.signal))
      .finally(() => this.activeRuns.delete(run.id));
    return run;
  }

  cancelRun(runId) {
    const controller = this.activeRuns.get(runId);
    if (!controller) throw Object.assign(new Error(`Run ${runId} is not active`), { status: 409 });
    controller.abort();
    // A run blocked on approval is unblocked by rejecting its pending approvals.
    for (const a of this.approvals.list('pending').filter((x) => x.runId === runId)) {
      this.approvals.decide(a.id, { approved: false, decidedBy: 'system', comment: 'Run cancelled' });
    }
  }

  getRun(id) {
    return this.store.get('runs', id);
  }

  listRuns({ limit = 50, ticketKey } = {}) {
    return this.store
      .list('runs')
      .filter((r) => !ticketKey || r.input?.ticketKey === ticketKey)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map(({ outputs, ...r }) => r);
  }

  #saveRun(run, type, step) {
    const { done, ...serializable } = run;
    this.store.set('runs', run.id, serializable);
    this.bus.publish(type, { runId: run.id, workflowId: run.workflowId, label: run.label, status: run.status, step: step || undefined });
  }

  // -------------------------------------------------------------- schedules
  /** Run an agent action on an interval (e.g. Jira polling). */
  schedule(name, intervalMs, fn) {
    this.unschedule(name);
    let running = false;
    const tick = async () => {
      if (running) return;
      running = true;
      try {
        await fn();
      } catch (err) {
        this.logger.warn(`Scheduled job "${name}" failed: ${err.message}`);
      } finally {
        running = false;
      }
    };
    this.schedules.set(name, { intervalMs, timer: setInterval(tick, intervalMs) });
    return tick;
  }

  unschedule(name) {
    const s = this.schedules.get(name);
    if (s) clearInterval(s.timer);
    this.schedules.delete(name);
  }

  async shutdown() {
    for (const name of this.schedules.keys()) this.unschedule(name);
    for (const c of this.activeRuns.values()) c.abort();
    for (const a of this.registry.list()) await a.shutdown?.();
    await this.tools?.close?.();
    this.store.flush();
  }
}
