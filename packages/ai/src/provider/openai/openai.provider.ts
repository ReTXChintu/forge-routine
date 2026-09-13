import OpenAI from 'openai';
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

import { stripAbsent, toStrictSchema } from './strict-schema.js';

export interface OpenAIProviderOptions {
  apiKey: string;
  baseURL: string;
  modelFast: string;
  modelReasoning: string;
  embeddingModel: string;
  timeoutMs: number;
  maxRetries: number;
}

/**
 * The only shipped provider (§27, user decision: OpenAI exclusively).
 *
 * Responsibilities kept deliberately narrow: transport, model resolution, JSON-mode
 * plumbing, and one schema-repair round trip. Prompt content and policy belong to
 * agents; retry/budget accounting belongs to the instrumented client above this.
 */
export class OpenAIProvider implements AIProvider {
  readonly name = 'openai';

  private readonly client: OpenAI;

  constructor(private readonly options: OpenAIProviderOptions) {
    this.client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
      timeout: options.timeoutMs,
      maxRetries: options.maxRetries,
    });
  }

  private resolveModel(prompt: PromptSpec): string {
    return prompt.model === 'reasoning' ? this.options.modelReasoning : this.options.modelFast;
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const model = this.resolveModel(req.prompt);
    const startedAt = Date.now();

    try {
      const completion = await this.client.chat.completions.create(
        {
          model,
          messages: req.prompt.messages,
          temperature: req.prompt.temperature ?? 0.4,
          max_tokens: req.prompt.maxTokens ?? 1_024,
        },
        { signal: req.context.signal },
      );

      return {
        text: completion.choices[0]?.message?.content ?? '',
        usage: {
          promptTokens: completion.usage?.prompt_tokens ?? 0,
          completionTokens: completion.usage?.completion_tokens ?? 0,
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

    try {
      const stream = await this.client.chat.completions.create(
        {
          model,
          messages: req.prompt.messages,
          temperature: req.prompt.temperature ?? 0.4,
          max_tokens: req.prompt.maxTokens ?? 1_024,
          stream: true,
        },
        { signal: req.context.signal },
      );

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) yield { delta, done: false };
      }
      yield { delta: '', done: true };
    } catch (error) {
      throw new AIUnavailable(req.context.agent, error);
    }
  }

  /**
   * Strict JSON mode plus validation. Never returns unvalidated data.
   *
   * `strict: true` makes OpenAI itself guarantee the shape, so the repair
   * round trip below is a genuine last resort rather than the normal path it
   * used to be. It is kept because strict mode constrains structure and not
   * meaning: a schema can still come back with an empty array where the
   * agent needs one entry, and that is worth one more ask.
   *
   * A second failure is a contract violation: the agent falls back rather
   * than the domain receiving a guess.
   */
  async structured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const model = this.resolveModel(req.prompt);
    const startedAt = Date.now();

    // jsonSchema7, not openApi3: strict mode expresses nullability as
    // `type: [..., "null"]` rather than OpenAPI's `nullable: true`.
    // No `name`: that option wraps the result in a root \ plus a
    // definitions block, and strict mode wants the schema itself. The name
    // is passed to OpenAI separately below.
    const generated = zodToJsonSchema(req.schema, {
      target: 'jsonSchema7',
      $refStrategy: 'none',
    });

    const { schema: jsonSchema, absence } = toStrictSchema(generated as Record<string, unknown>);

    const messages = [...req.prompt.messages];
    let promptTokens = 0;
    let completionTokens = 0;
    let lastRaw = '';
    let lastIssues: string[] = [];

    for (let attempt = 0; attempt <= 1; attempt += 1) {
      let raw: string;

      try {
        const completion = await this.client.chat.completions.create(
          {
            model,
            messages,
            temperature: req.prompt.temperature ?? 0.2,
            max_tokens: req.prompt.maxTokens ?? 2_048,
            response_format: {
              type: 'json_schema',
              json_schema: {
                name: req.schemaName,
                strict: true,
                schema: jsonSchema,
              },
            },
          },
          { signal: req.context.signal },
        );

        promptTokens += completion.usage?.prompt_tokens ?? 0;
        completionTokens += completion.usage?.completion_tokens ?? 0;
        raw = completion.choices[0]?.message?.content ?? '';
      } catch (error) {
        throw new AIUnavailable(req.context.agent, error);
      }

      lastRaw = raw;
      const parsed = safeParseJson(raw);

      if (parsed.ok) {
        // Strict mode has no "omit this key", so an optional field comes back
        // as an explicit null. Turn those back into absences before Zod sees
        // them, or every `.optional()` in every agent schema fails.
        const validated = req.schema.safeParse(stripAbsent(parsed.value, absence));
        if (validated.success) {
          return {
            data: validated.data,
            usage: { promptTokens, completionTokens },
            model,
            latencyMs: Date.now() - startedAt,
            repairAttempts: attempt,
          };
        }
        lastIssues = validated.error.issues.map(
          (i) => `${i.path.join('.') || '(root)'}: ${i.message}`,
        );
      } else {
        lastIssues = [`Response was not valid JSON: ${parsed.error}`];
      }

      messages.push(
        { role: 'assistant', content: raw },
        {
          role: 'user',
          content:
            `Your previous response did not satisfy the required schema:\n` +
            `${lastIssues.map((i) => `- ${i}`).join('\n')}\n\n` +
            `Return corrected JSON only. No prose, no code fences.`,
        },
      );
    }

    throw new AIContractViolation(req.context.agent, lastIssues, lastRaw);
  }

  async embed(req: EmbedRequest): Promise<EmbedResult> {
    try {
      const response = await this.client.embeddings.create(
        { model: this.options.embeddingModel, input: req.inputs },
        { signal: req.context.signal },
      );

      return {
        vectors: response.data.map((d) => d.embedding),
        usage: {
          promptTokens: response.usage?.prompt_tokens ?? 0,
          completionTokens: 0,
        },
        model: this.options.embeddingModel,
      };
    } catch (error) {
      throw new AIUnavailable(req.context.agent, error);
    }
  }
}

type JsonParseResult = { ok: true; value: unknown } | { ok: false; error: string };

/**
 * Models occasionally wrap JSON in a code fence despite JSON mode. Stripping one
 * fence is worth it; anything more elaborate is a genuine failure we want to see.
 */
function safeParseJson(raw: string): JsonParseResult {
  const trimmed = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');

  try {
    return { ok: true, value: JSON.parse(trimmed) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
