import { now } from './util.js';

/**
 * Shared context & memory between agents.
 *  - run scope:    facts produced during one workflow run (ticket, analysis, results...)
 *  - global scope: long-lived knowledge (failure signatures, flaky tests, selector hints)
 * Agents only receive a scoped view (see Orchestrator#agentContext), never the raw store.
 */
export class ContextStore {
  constructor(store, bus) {
    this.store = store;
    this.bus = bus;
  }
  #key(scope, key) {
    return `${scope}::${key}`;
  }
  get(scope, key, fallback = undefined) {
    return this.store.get('memory', this.#key(scope, key))?.value ?? fallback;
  }
  set(scope, key, value, author = 'system') {
    const entry = { scope, key, value, author, updatedAt: now() };
    this.store.set('memory', this.#key(scope, key), entry);
    this.bus?.publish('memory.updated', { scope, key, author });
    return value;
  }
  update(scope, key, fn, author) {
    return this.set(scope, key, fn(this.get(scope, key)), author);
  }
  list(scope) {
    return this.store.list('memory').filter((e) => !scope || e.scope === scope);
  }
  /** A view bound to one run + the global scope, handed to agents. */
  view(runId, author) {
    const runScope = runId ? `run:${runId}` : 'adhoc';
    return {
      run: {
        get: (k, d) => this.get(runScope, k, d),
        set: (k, v) => this.set(runScope, k, v, author),
      },
      global: {
        get: (k, d) => this.get('global', k, d),
        set: (k, v) => this.set('global', k, v, author),
        update: (k, fn) => this.update('global', k, fn, author),
      },
    };
  }
}
