import { MockProvider } from './mock-provider.js';
import { AnthropicProvider } from './anthropic-provider.js';

/**
 * Provider-agnostic LLM interface used by every agent.
 *
 *   llm.available                       -> false for the mock provider
 *   await llm.generateObject({ system, prompt, schema, effort? }) -> validated object
 *   await llm.generateText({ system, prompt })                     -> string
 *
 * `schema` is a zod schema; providers must return data that parses against it.
 * Agents always keep a deterministic heuristic path and fall back to it when the
 * provider is unavailable or fails, so the platform keeps working offline.
 *
 * To add a provider: implement { name, available, generateObject, generateText }
 * and register it in createLLM below.
 */
export function createLLM(config) {
  const provider = (() => {
    switch (config.llm.provider) {
      case 'anthropic':
        return new AnthropicProvider(config.llm);
      case 'mock':
        return new MockProvider();
      default:
        throw new Error(`Unknown LLM provider "${config.llm.provider}"`);
    }
  })();
  return new LLMClient(provider);
}

export class LLMClient {
  constructor(provider) {
    this.provider = provider;
  }
  get name() {
    return this.provider.name;
  }
  get available() {
    return this.provider.available;
  }
  describe() {
    return { provider: this.provider.name, model: this.provider.model || null, available: this.provider.available };
  }
  /** Returns a per-task view that accounts LLM usage into the task metrics. */
  withUsage(usage, log) {
    const provider = this.provider;
    const track = async (fn, kind) => {
      usage.llmCalls++;
      const t0 = performance.now();
      const res = await fn();
      usage.tokensIn += res.usage?.inputTokens || 0;
      usage.tokensOut += res.usage?.outputTokens || 0;
      log?.debug(`LLM ${kind} via ${provider.name} (${Math.round(performance.now() - t0)}ms)`);
      return res.value;
    };
    return {
      name: provider.name,
      available: provider.available,
      generateObject: (req) => track(() => provider.generateObject(req), 'object'),
      generateText: (req) => track(() => provider.generateText(req), 'text'),
    };
  }
}
