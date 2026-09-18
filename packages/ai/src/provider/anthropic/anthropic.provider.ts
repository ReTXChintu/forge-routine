import Anthropic from '@anthropic-ai/sdk';
import { zodToJsonSchema } from 'zod-to-json-schema';

import {
  AIContractViolation,
  AIUnavailable,
  type AIProvider,
  type EmbedRequest,
  type EmbedResult,
  type GenerateRequest,
  type GenerateResult,
  type PromptSpec,
  type StreamChunk,
  type StructuredRequest,
  type StructuredResult,
} from '../ai-provider.port.js';
import { stripAbsent, toStrictSchema } from '../openai/strict-schema.js';

export interface AnthropicProviderOptions {
  apiKey: string;
  baseURL?: string;
  modelFast: string;
  modelReasoning: string;
  timeoutMs: number;
  maxRetries: number;
}

/**
 * Claude, behind the same port as every other vendor.
 *
 * Two shape differences from OpenAI worth knowing, because both are easy to
 * get wrong and neither fails loudly:
 *
 *   1. There is no system *message*. The system prompt is a top-level
 *      `system` parameter, and a system-role entry in `messages` is an
 *      error. The messages are split apart below.
 *   2. Structured output takes a plain JSON Schema on
 *      `output_config.format`. The SDK ships a Zod helper, but it is typed
 *      against Zod v4 internals and this repo is on v3, so the schema goes
 *      through the same strict transform the OpenAI provider uses and Zod
 *      validates the result here. Shared rather than duplicated: the
 *      optional-becomes-nullable problem is identical on both vendors.
 *
 * Thinking is on by default on current models and its tokens count against
 * `max_tokens`. Agents here ask for tight budgets (some as low as 700), so
 * effort is pinned low and the ceiling is widened below; left alone, a
 * agent's whole budget can be spent thinking and return nothing.
 */
export class AnthropicProvider implements AIProvider {
  readonly name = 'anthropic';

  private readonly client: Anthropic;

  constructor(private readonly options: AnthropicProviderOptions) {
    this.client = new Anthropic({
      apiKey: options.apiKey,
      ...(options.baseURL ? { baseURL: options.baseURL } : {}),
      // The SDK takes milliseconds here, unlike the Python one.
      timeout: options.timeoutMs,
      maxRetries: options.maxRetries,
    });
  }

  private resolveModel(prompt: PromptSpec): string {
    return prompt.model === 'reasoning' ? this.options.modelReasoning : this.options.modelFast;
  }

  /**
   * Splits our flat message list into Claude's `system` + `messages`.
   *
   * Several system entries are joined rather than dropped: agents build
   * their system prompt in parts, and quietly keeping only the first would
   * silently remove the assistance policy from the tutor.
   */
  private split(prompt: PromptSpec): { system: string; messages: Anthropic.MessageParam[] } {
    const system = prompt.messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n\n');

    const messages = prompt.messages
      .filter((message) => message.role !== 'system')
      .map((message) => ({
        role: message.role as 'user' | 'assistant',
        content: message.content,
      }));

    // Claude requires at least one message and the first must be a user
    // turn. An agent that sent only a system prompt would 400 otherwise.
    if (messages.length === 0 || messages[0]!.role !== 'user') {
      messages.unshift({ role: 'user', content: 'Begin.' });
    }

    return { system, messages };
  }

  /**
   * Room for the answer plus the thinking that precedes it.
   *
   * Our budgets were sized for models that emit only the answer. Reusing
   * them unchanged here truncates mid-JSON, which surfaces as a contract
   * violation rather than as the budget problem it actually is.
   */
  private ceiling(prompt: PromptSpec): number {
    return Math.max(4_096, (prompt.maxTokens ?? 2_048) * 2);
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const model = this.resolveModel(req.prompt);
    const startedAt = Date.now();
    const { system, messages } = this.split(req.prompt);

    try {
      const response = await this.client.messages.create(
        {
          model,
          max_tokens: this.ceiling(req.prompt),
          ...(system ? { system } : {}),
          messages,
          output_config: { effort: 'low' },
        },
        { signal: req.context.signal },
      );

      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('');

      return {
        text,
        usage: {
          promptTokens: response.usage.input_tokens,
          completionTokens: response.usage.output_tokens,
        },
        model,
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      throw new AIUnavailable(req.context.agent, error);
    }
  }

  async *stream(req: GenerateRequest): AsyncIterable<StreamChunk> {
    const model = this.resolveModel(req.prompt);
    const { system, messages } = this.split(req.prompt);

    try {
      const stream = this.client.messages.stream(
        {
          model,
          max_tokens: this.ceiling(req.prompt),
          ...(system ? { system } : {}),
          messages,
          output_config: { effort: 'low' },
        },
        { signal: req.context.signal },
      );

      for await (const event of stream) {
        if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'text_delta' &&
          event.delta.text
        ) {
          yield { delta: event.delta.text, done: false };
        }
      }
      yield { delta: '', done: true };
    } catch (error) {
      throw new AIUnavailable(req.context.agent, error);
    }
  }

  async structured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const model = this.resolveModel(req.prompt);
    const startedAt = Date.now();
    const { system, messages } = this.split(req.prompt);

    const { schema: jsonSchema, absence } = toStrictSchema(
      zodToJsonSchema(req.schema, {
        target: 'jsonSchema7',
        $refStrategy: 'none',
      }) as Record<string, unknown>,
    );

    let response: Anthropic.Message;

    try {
      response = await this.client.messages.create(
        {
          model,
          max_tokens: this.ceiling(req.prompt),
          ...(system ? { system } : {}),
          messages,
          output_config: {
            effort: 'low',
            format: { type: 'json_schema', schema: jsonSchema },
          },
        },
        { signal: req.context.signal },
      );
    } catch (error) {
      throw new AIUnavailable(req.context.agent, error);
    }

    // A refusal is a policy decision, not a malformed answer. Reported as
    // unavailable so the agent takes its declared fallback rather than
    // retrying a request the model has already declined.
    if (response.stop_reason === 'refusal') {
      throw new AIUnavailable(
        req.context.agent,
        new Error(`Claude declined: ${response.stop_details?.category ?? 'unspecified'}`),
      );
    }

    const usage = {
      promptTokens: response.usage.input_tokens,
      completionTokens: response.usage.output_tokens,
    };

    const raw = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new AIContractViolation(
        req.context.agent,
        [
          response.stop_reason === 'max_tokens'
            ? 'Response hit max_tokens before the JSON was complete'
            : `Response was not valid JSON: ${(error as Error).message}`,
        ],
        raw,
      );
    }

    // Zod is still the authority: it carries refinements no JSON Schema can
    // express, and the strict transform turns absent fields into nulls that
    // have to be removed again before validation.
    const validated = req.schema.safeParse(stripAbsent(parsed, absence));
    if (!validated.success) {
      throw new AIContractViolation(
        req.context.agent,
        validated.error.issues.map(
          (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
        ),
        raw,
      );
    }

    return {
      data: validated.data,
      usage,
      model,
      latencyMs: Date.now() - startedAt,
      // The vendor enforces the shape, so there is no repair loop to count.
      // Zero rather than absent, so the telemetry column stays comparable.
      repairAttempts: 0,
    };
  }

  async embed(req: EmbedRequest): Promise<EmbedResult> {
    // Anthropic has no embeddings endpoint. Saying so beats returning zero
    // vectors that would quietly poison anything built on them.
    throw new AIUnavailable(
      req.context.agent,
      new Error('Anthropic does not provide embeddings; configure OpenAI for that'),
    );
  }
}
