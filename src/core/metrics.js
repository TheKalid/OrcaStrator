import { now } from './util.js';

/** Per-agent execution metrics and live status. */
export class AgentMetrics {
  constructor(store, bus) {
    this.store = store;
    this.bus = bus;
    this.live = new Map(); // agentId -> { status, activeTasks, currentTask }
  }
  #base(agentId) {
    return this.store.get('agent_metrics', agentId) || {
      agentId, invocations: 0, succeeded: 0, failed: 0, retries: 0, totalDurationMs: 0,
      llmCalls: 0, tokensIn: 0, tokensOut: 0, lastRunAt: null, lastError: null, recentDurations: [],
    };
  }
  status(agentId) {
    return this.live.get(agentId) || { status: 'idle', activeTasks: 0, currentTask: null };
  }
  started(agentId, task) {
    const s = this.status(agentId);
    const next = { status: 'busy', activeTasks: s.activeTasks + 1, currentTask: { id: task.id, action: task.action, runId: task.runId, since: now() } };
    this.live.set(agentId, next);
    this.bus.publish('agent.status', { agentId, ...next });
  }
  finished(agentId, result, { retried = false } = {}) {
    const m = this.#base(agentId);
    m.invocations++;
    if (result.status === 'succeeded') m.succeeded++;
    else {
      m.failed++;
      m.lastError = result.error?.message || 'unknown error';
    }
    if (retried) m.retries++;
    m.totalDurationMs += result.metrics.durationMs;
    m.llmCalls += result.metrics.llmCalls || 0;
    m.tokensIn += result.metrics.tokensIn || 0;
    m.tokensOut += result.metrics.tokensOut || 0;
    m.lastRunAt = result.finishedAt;
    m.recentDurations = [...m.recentDurations, result.metrics.durationMs].slice(-20);
    this.store.set('agent_metrics', agentId, m);

    const s = this.status(agentId);
    const activeTasks = Math.max(0, s.activeTasks - 1);
    const next = { status: activeTasks ? 'busy' : result.status === 'failed' ? 'error' : 'idle', activeTasks, currentTask: activeTasks ? s.currentTask : null };
    this.live.set(agentId, next);
    this.bus.publish('agent.status', { agentId, ...next });
  }
  snapshot(agentId) {
    const m = this.#base(agentId);
    return {
      ...m,
      successRate: m.invocations ? m.succeeded / m.invocations : null,
      avgDurationMs: m.invocations ? Math.round(m.totalDurationMs / m.invocations) : null,
    };
  }
}
