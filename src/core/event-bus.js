import { EventEmitter } from 'node:events';
import { now } from './util.js';

/**
 * In-process event bus. Everything observable (runs, steps, agent status, logs,
 * approvals, Jira changes) flows through here; the API server fans it out via SSE.
 * Swap for Redis/NATS later without touching agents.
 */
export class EventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(100);
    this.seq = 0;
  }
  publish(type, payload = {}) {
    const event = { seq: ++this.seq, type, ts: now(), payload };
    this.emit('event', event);
    this.emit(type, event);
    return event;
  }
}
