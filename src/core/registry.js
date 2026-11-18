import { BaseAgent } from './agent.js';

/** Plug-in registry. Agents can be registered, replaced or removed at runtime. */
export class AgentRegistry {
  constructor() {
    this.agents = new Map();
  }
  register(agent) {
    if (!(agent instanceof BaseAgent)) throw new Error('Agents must extend BaseAgent');
    this.agents.set(agent.id, agent);
    return agent;
  }
  replace(agent) {
    return this.register(agent);
  }
  unregister(id) {
    this.agents.delete(id);
  }
  get(id) {
    const agent = this.agents.get(id);
    if (!agent) throw Object.assign(new Error(`Agent "${id}" is not registered`), { code: 'AGENT_NOT_FOUND' });
    return agent;
  }
  has(id) {
    return this.agents.has(id);
  }
  list() {
    return [...this.agents.values()];
  }
}
