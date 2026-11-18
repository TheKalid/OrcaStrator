/**
 * Offline provider. It never calls a model: `available` is false so agents use
 * their deterministic heuristic implementations. Calling it directly is an error.
 */
export class MockProvider {
  name = 'mock';
  model = null;
  available = false;
  async generateObject() {
    throw Object.assign(new Error('Mock LLM provider cannot generate; agents should use heuristics'), { code: 'LLM_UNAVAILABLE', retryable: false });
  }
  async generateText() {
    return this.generateObject();
  }
}
