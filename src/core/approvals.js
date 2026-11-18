import { ApprovalRequest } from './contracts.js';
import { newId, now } from './util.js';

/**
 * Human-in-the-loop gate for sensitive operations (creating Jira defects,
 * pushing code, triggering deployments...). A workflow step with `approval`
 * pauses until a human decides via the API/dashboard.
 */
export class ApprovalService {
  constructor(store, bus) {
    this.store = store;
    this.bus = bus;
    this.waiters = new Map();
  }
  request({ runId, stepId, agentId, action, title, summary, payload }) {
    const approval = ApprovalRequest.parse({
      id: newId('apr'), runId, stepId, agentId, action, title, summary, payload,
      status: 'pending', decidedBy: null, comment: null, createdAt: now(), decidedAt: null,
    });
    this.store.set('approvals', approval.id, approval);
    // Register the waiter before publishing: listeners may decide synchronously.
    const decision = new Promise((resolve) => this.waiters.set(approval.id, resolve));
    this.bus.publish('approval.requested', approval);
    return { approval, decision };
  }
  decide(id, { approved, decidedBy = 'human', comment = null }) {
    const approval = this.store.get('approvals', id);
    if (!approval) throw Object.assign(new Error(`Approval ${id} not found`), { status: 404 });
    if (approval.status !== 'pending') throw Object.assign(new Error(`Approval ${id} already ${approval.status}`), { status: 409 });
    const updated = { ...approval, status: approved ? 'approved' : 'rejected', decidedBy, comment, decidedAt: now() };
    this.store.set('approvals', id, updated);
    this.bus.publish('approval.decided', updated);
    this.waiters.get(id)?.(updated);
    this.waiters.delete(id);
    return updated;
  }
  /** Approvals left pending by a previous process can no longer resume; expire them. */
  expireOrphans() {
    for (const a of this.store.list('approvals')) {
      if (a.status === 'pending' && !this.waiters.has(a.id)) {
        this.store.set('approvals', a.id, { ...a, status: 'rejected', decidedBy: 'system', comment: 'Expired: orchestrator restarted', decidedAt: now() });
      }
    }
  }
  list(status) {
    return this.store.list('approvals').filter((a) => !status || a.status === status).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}
