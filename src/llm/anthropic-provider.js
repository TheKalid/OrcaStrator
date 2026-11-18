import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

/**
 * Claude provider using the official Anthropic SDK.
 * Credentials are resolved by the SDK (ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN
 * or an `ant auth login` profile) and never handled by ORCA itself.
 */
export class AnthropicProvider {
  name = 'anthropic';
  available = true;

  constructor({ model, effort, maxTokens }) {
    this.model = model;
    this.effort = effort;
    this.maxTokens = maxTokens;
    this.client = new Anthropic();
  }

  async generateObject({ system, prompt, schema, effort }) {
    const response = await this.#call(() =>
      this.client.messages.parse({
        model: this.model,
        max_tokens: this.maxTokens,
        system,
        messages: [{ role: 'user', content: prompt }],
        output_config: { effort: effort || this.effort, format: zodOutputFormat(schema) },
      }),
    );
    this.#checkStop(response);
    if (!response.parsed_output) throw Object.assign(new Error('Model returned no structured output'), { retryable: true });
    return { value: response.parsed_output, usage: usageOf(response) };
  }

  async generateText({ system, prompt, effort }) {
    const response = await this.#call(() =>
      this.client.messages.create({
        model: this.model,
        max_tokens: this.maxTokens,
        system,
        messages: [{ role: 'user', content: prompt }],
        output_config: { effort: effort || this.effort },
      }),
    );
    this.#checkStop(response);
    const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    return { value: text, usage: usageOf(response) };
  }

  async #call(fn) {
    try {
      return await fn();
    } catch (err) {
      const retryable = err instanceof Anthropic.RateLimitError || err instanceof Anthropic.InternalServerError || err instanceof Anthropic.APIConnectionError;
      throw Object.assign(new Error(`Anthropic API error: ${err.message}`), { code: 'LLM_ERROR', retryable });
    }
  }

  #checkStop(response) {
    if (response.stop_reason === 'refusal') {
      throw Object.assign(new Error(`Model declined the request (${response.stop_details?.category || 'unspecified'})`), { code: 'LLM_REFUSAL', retryable: false });
    }
    if (response.stop_reason === 'max_tokens') {
      throw Object.assign(new Error('Model output truncated at max_tokens'), { code: 'LLM_TRUNCATED', retryable: false });
    }
  }
}

function usageOf(response) {
  return { inputTokens: response.usage?.input_tokens || 0, outputTokens: response.usage?.output_tokens || 0 };
}
