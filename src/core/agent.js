/**
 * Base class for every agent.
 *
 * An agent declares a set of actions. Each action has a zod input schema, a zod
 * output schema and a handler. The orchestrator validates both sides of every
 * call, so agents communicate only through structured, typed messages and can be
 * replaced independently.
 *
 *   class MyAgent extends BaseAgent {
 *     constructor() {
 *       super({ id: 'my-agent', name: 'My Agent', description: '...' });
 *       this.action('doThing', { input: z.object(...), output: z.object(...) }, (input, ctx) => {...});
 *     }
 *   }
 *
 * The handler receives an AgentContext (see Orchestrator#agentContext):
 *   ctx.llm          provider-agnostic LLM client (may be the mock provider)
 *   ctx.integrations jira / github / ci / playwright / codeContext clients
 *   ctx.tools        MCP tools
 *   ctx.memory       { run, global } shared memory views
 *   ctx.log          scoped structured logger
 *   ctx.trace(nodes, edges)  add traceability links
 *   ctx.config       read-only config
 */
export class BaseAgent {
  constructor({ id, name, description, version = '0.1.0', concurrency, tags = [] }) {
    if (!id) throw new Error('Agent id is required');
    this.id = id;
    this.name = name || id;
    this.description = description || '';
    this.version = version;
    this.concurrency = concurrency;
    this.tags = tags;
    this.actions = new Map();
  }

  action(name, { input, output, description = '', sensitive = false }, handler) {
    this.actions.set(name, { name, input, output, description, sensitive, handler: handler.bind(this) });
    return this;
  }

  describe() {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      version: this.version,
      tags: this.tags,
      actions: [...this.actions.values()].map((a) => ({ name: a.name, description: a.description, sensitive: a.sensitive })),
    };
  }

  /** Optional lifecycle hooks. */
  async init(_ctx) {}
  async shutdown() {}
}
