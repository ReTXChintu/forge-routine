import { GoogleGenAI } from '@google/genai';
import { zodToJsonSchema } from 'zod-to-json-schema';

import {
  AIContractViolation,
  AIUnavailable,
  type AIProvider,
  type CallContext,
  type EmbedRequest,
  type EmbedResult,
  type GenerateRequest,
  type GenerateResult,
  type ModelOption,
  type PromptSpec,
  type StreamChunk,
  type StructuredRequest,
  type StructuredResult,
} from '../ai-provider.port.js';

import { toGeminiSchema } from './gemini-schema.js';

export interface GeminiProviderOptions {
  apiKey: string;
  modelFast: string;
  modelReasoning: string;
  embeddingModel: string;
  timeoutMs: number;
}

/**
 * Gemini, behind the same port.
 *
 * Like Claude, the system prompt is a separate parameter rather than a
 * message. Unlike either of the others, structured output is requested by
 * declaring a response schema up front (`responseJsonSchema` plus a JSON
 * mime type) rather than by attaching one to a tool — see
 * `gemini-schema.ts` for the subset it accepts.
 */
export class GeminiProvider implements AIProvider {
  readonly name = 'gemini';

  private readonly client: GoogleGenAI;

  constructor(private readonly options: GeminiProviderOptions) {
    this.client = new GoogleGenAI({ apiKey: options.apiKey });
  }

  private resolveModel(prompt: PromptSpec): string {
    return prompt.model === 'reasoning' ? this.options.modelReasoning : this.options.modelFast;
  }

  /** Gemini's own split: `systemInstruction` plus role-tagged turns. */
  private split(prompt: PromptSpec) {
    const system = prompt.messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n\n');

    const contents = prompt.messages
      .filter((message) => message.role !== 'system')
      .map((message) => ({
        // Gemini calls the assistant "model". Sending "assistant" is
        // rejected, which is a confusing error to meet at runtime.
        role: message.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: message.content }],
      }));

    if (contents.length === 0) {
      contents.push({ role: 'user', parts: [{ text: 'Begin.' }] });
    }

    return { system, contents };
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const model = this.resolveModel(req.prompt);
    const startedAt = Date.now();
    const { system, contents } = this.split(req.prompt);

    try {
      const response = await this.client.models.generateContent({
        model,
        contents,
        config: {
          ...(system ? { systemInstruction: system } : {}),
          temperature: req.prompt.temperature ?? 0.4,
          maxOutputTokens: req.prompt.maxTokens ?? 1_024,
          abortSignal: req.context.signal,
        },
      });

      return {
        text: response.text ?? '',
        usage: {
          promptTokens: response.usageMetadata?.promptTokenCount ?? 0,
          completionTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
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
    const { system, contents } = this.split(req.prompt);

    try {
      const stream = await this.client.models.generateContentStream({
        model,
        contents,
        config: {
          ...(system ? { systemInstruction: system } : {}),
          temperature: req.prompt.temperature ?? 0.4,
          maxOutputTokens: req.prompt.maxTokens ?? 1_024,
          abortSignal: req.context.signal,
        },
      });

      for await (const chunk of stream) {
        const delta = chunk.text;
        if (delta) yield { delta, done: false };
      }
      yield { delta: '', done: true };
    } catch (error) {
      throw new AIUnavailable(req.context.agent, error);
    }
  }

  async structured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const model = this.resolveModel(req.prompt);
    const startedAt = Date.now();
    const { system, contents } = this.split(req.prompt);

    const jsonSchema = toGeminiSchema(
      zodToJsonSchema(req.schema, {
        target: 'jsonSchema7',
        $refStrategy: 'none',
      }) as Record<string, unknown>,
    );

    let raw = '';
    let usage = { promptTokens: 0, completionTokens: 0 };

    try {
      const response = await this.client.models.generateContent({
        model,
        contents,
        config: {
          ...(system ? { systemInstruction: system } : {}),
          temperature: req.prompt.temperature ?? 0.2,
          // Doubled for the same reason as Claude: our budgets were sized
          // for answer-only output, and a truncated response surfaces as a
          // schema failure rather than as the budget problem it is.
          maxOutputTokens: Math.max(4_096, (req.prompt.maxTokens ?? 2_048) * 2),
          responseMimeType: 'application/json',
          responseJsonSchema: jsonSchema,
          abortSignal: req.context.signal,
        },
      });

      raw = response.text ?? '';
      usage = {
        promptTokens: response.usageMetadata?.promptTokenCount ?? 0,
        completionTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      };
    } catch (error) {
      throw new AIUnavailable(req.context.agent, error);
    }

    // The schema is enforced by the vendor, but Zod is still the authority:
    // it carries refinements the JSON Schema cannot express, and the
    // sanitiser above drops bounds Gemini would reject.
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch (error) {
      throw new AIContractViolation(
        req.context.agent,
        [`Response was not valid JSON: ${(error as Error).message}`],
        raw,
      );
    }

    const validated = req.schema.safeParse(parsedJson);
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
      repairAttempts: 0,
    };
  }

  async listModels(context: CallContext): Promise<ModelOption[]> {
    try {
      const models: ModelOption[] = [];

      for await (const model of await this.client.models.list()) {
        // Filter to what can answer a prompt. The same listing carries
        // embedding and tuning-only models, and offering those as a
        // reasoning model would be offering a guaranteed failure.
        const actions = model.supportedActions ?? [];
        if (actions.length > 0 && !actions.includes('generateContent')) continue;

        const id = (model.name ?? '').replace(/^models\//, '');
        if (id) models.push({ id, label: model.displayName ?? id });
      }

      return models;
    } catch (error) {
      throw new AIUnavailable(context.agent, error);
    }
  }

  async embed(req: EmbedRequest): Promise<EmbedResult> {
    try {
      const response = await this.client.models.embedContent({
        model: this.options.embeddingModel,
        contents: req.inputs,
      });

      return {
        vectors: (response.embeddings ?? []).map((embedding) => embedding.values ?? []),
        // Not reported by this endpoint. Zero rather than a guess: an
        // invented number in the cost table is worse than a missing one.
        usage: { promptTokens: 0, completionTokens: 0 },
        model: this.options.embeddingModel,
      };
    } catch (error) {
      throw new AIUnavailable(req.context.agent, error);
    }
  }
}
