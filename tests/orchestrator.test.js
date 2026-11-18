import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { BaseAgent } from '../src/core/agent.js';
import { testOrchestrator } from './helpers.js';

class MathAgent extends BaseAgent {
  constructor() {
    super({ id: 'math', name: 'Math' });
    this.calls = 0;
    this.action('double', { input: z.object({ n: z.number() }), output: z.object({ n: z.number() }) }, async ({ n }) => ({ n: n * 2 }));
    this.action('bad', { input: z.object({}), output: z.object({ n: z.number() }) }, async () => ({ n: 'oops' }));
    this.action('flaky', { input: z.object({}), output: z.object({ ok: z.boolean() }) }, async () => {
      this.calls++;
      if (this.calls < 2) throw Object.assign(new Error('transient'), { retryable: true });
      return { ok: true };
    });
    this.action('slow', { input: z.object({}) }, () => new Promise((r) => setTimeout(r, 500)));
  }
}

test('dispatch validates input and output contracts', async () => {
  const orca = testOrchestrator();
  await orca.registerAgent(new MathAgent());
  assert.deepEqual(await orca.dispatch({ agentId: 'math', action: 'double', input: { n: 21 } }), { n: 42 });
  await assert.rejects(orca.dispatch({ agentId: 'math', action: 'double', input: { n: 'x' } }), /expected number/i);
  await assert.rejects(orca.dispatch({ agentId: 'math', action: 'bad', input: {} }), /Output contract violation/);
});

test('dispatch retries retryable failures and records metrics', async () => {
  const orca = testOrchestrator();
  const agent = await orca.registerAgent(new MathAgent());
  assert.deepEqual(await orca.dispatch({ agentId: 'math', action: 'flaky', input: {}, retries: 2 }), { ok: true });
  assert.equal(agent.calls, 2);
  const m = orca.metrics.snapshot('math');
  assert.equal(m.invocations, 2);
  assert.equal(m.failed, 1);
  assert.equal(m.retries, 1);
});

test('dispatch enforces timeouts', async () => {
  const orca = testOrchestrator();
  await orca.registerAgent(new MathAgent());
  await assert.rejects(orca.dispatch({ agentId: 'math', action: 'slow', input: {}, timeoutMs: 50, retries: 0 }), /Timed out/);
});

test('workflow runs sequential, parallel and conditional steps', async () => {
  const orca = testOrchestrator();
  await orca.registerAgent(new MathAgent());
  orca.registerWorkflow({
    id: 'wf',
    name: 'wf',
    steps: [
      { id: 'a', agent: 'math', action: 'double', input: (ctx) => ({ n: ctx.input.n }) },
      {
        id: 'p',
        parallel: [
          { id: 'b', agent: 'math', action: 'double', input: (ctx) => ({ n: ctx.steps.a.n }) },
          { id: 'c', agent: 'math', action: 'double', input: (ctx) => ({ n: ctx.steps.a.n + 1 }) },
        ],
      },
      { id: 'skipped', agent: 'math', action: 'double', when: (ctx) => ctx.steps.b.n > 1000, input: () => ({ n: 0 }) },
    ],
    output: (ctx) => ctx.steps.b.n + ctx.steps.c.n,
  });
  const run = await orca.startRun('wf', { n: 1 }).done;
  assert.equal(run.status, 'succeeded');
  assert.equal(run.output, 4 + 6);
  assert.equal(run.steps.find((s) => s.id === 'skipped').status, 'skipped');
  assert.equal(run.steps.find((s) => s.id === 'b').parentId, 'p');
});

test('approval gate pauses the run until a human decides', async () => {
  const orca = testOrchestrator();
  await orca.registerAgent(new MathAgent());
  orca.registerWorkflow({
    id: 'gated',
    name: 'gated',
    steps: [{ id: 'g', agent: 'math', action: 'double', input: () => ({ n: 5 }), approval: { title: () => 'Double five?' } }],
  });
  const approve = (approved) => {
    const started = orca.startRun('gated', {});
    return new Promise((resolve) => setTimeout(() => {
      const pending = orca.approvals.list('pending').find((a) => a.runId === started.id);
      assert.equal(orca.getRun(started.id).status, 'waiting_approval');
      orca.approvals.decide(pending.id, { approved });
      resolve(started.done);
    }, 20));
  };
  const ok = await approve(true);
  assert.deepEqual(ok.outputs.g, { n: 10 });
  const rejected = await approve(false);
  assert.equal(rejected.steps[0].status, 'rejected');
  assert.equal(rejected.status, 'succeeded');
});

test('a failing step fails the run unless continueOnError', async () => {
  const orca = testOrchestrator();
  await orca.registerAgent(new MathAgent());
  orca.registerWorkflow({ id: 'f', name: 'f', steps: [{ id: 'x', agent: 'math', action: 'bad', input: () => ({}) }, { id: 'y', agent: 'math', action: 'double', input: () => ({ n: 1 }) }] });
  const run = await orca.startRun('f', {}).done;
  assert.equal(run.status, 'failed');
  assert.equal(run.error.stepId, 'x');
  assert.equal(run.steps.find((s) => s.id === 'y').status, 'pending');
});
