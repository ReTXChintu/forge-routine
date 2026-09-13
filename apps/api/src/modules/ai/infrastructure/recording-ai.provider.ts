import { Logger } from '@nestjs/common';

import type {
  AIProvider,
  EmbedRequest,
  EmbedResult,
  GenerateRequest,
  GenerateResult,
  StreamChunk,
  StructuredRequest,
  StructuredResult,
  TokenUsage,
} from '@forgeroutine/ai';

import type { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';

/**
 * Wraps the real provider and records every call in `AIInteraction`.
 *
 * The table and its schema comment have existed since the first migration;
 * nothing ever wrote to it. The result was that the only way to find out what
 * curriculum generation cost was to read the OpenAI dashboard and guess which
 * spike was which — and the first thing anyone asks about an AI product is
 * what it costs to run.
 *
 * A decorator rather than a change inside the AI package, so that package
 * keeps no database dependency: it is a port over an HTTP API, and giving it
 * a Prisma import would make it untestable without one.
 *
 * **Recording never fails a call.** A write that throws is logged and
 * swallowed: losing an answer the user is waiting for, in order to save a row
 * of telemetry, is the wrong trade in every case.
 */
export class RecordingAIProvider implements AIProvider {
  private readonly logger = new Logger(RecordingAIProvider.name);

  constructor(
    private readonly inner: AIProvider,
    private readonly prisma: PrismaService,
  ) {}

  get name(): string {
    return this.inner.name;
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const started = Date.now();

    try {
      const result = await this.inner.generate(request);
      void this.record(request, result.model, result.usage, result.latencyMs, 'OK', null);
      return result;
    } catch (error) {
      // A failed call still spent time and may still have spent tokens.
      // Dropping it would make the record quietly optimistic.
      void this.record(request, null, null, Date.now() - started, 'ERROR', error);
      throw error;
    }
  }

  async *stream(request: GenerateRequest): AsyncIterable<StreamChunk> {
    // Streaming reports no usage, so there is nothing honest to record. It is
    // only used for tutor replies, which are small.
    yield* this.inner.stream(request);
  }

  async structured<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const started = Date.now();

    try {
      const result = await this.inner.structured(request);
      void this.record(
        request,
        result.model,
        result.usage,
        result.latencyMs,
        result.repairAttempts > 0 ? 'REPAIRED' : 'OK',
        null,
      );
      return result;
    } catch (error) {
      void this.record(request, null, null, Date.now() - started, 'ERROR', error);
      throw error;
    }
  }

  async embed(request: EmbedRequest): Promise<EmbedResult> {
    return this.inner.embed(request);
  }

  private async record(
    request: GenerateRequest | StructuredRequest<unknown>,
    model: string | null,
    usage: TokenUsage | null,
    latencyMs: number,
    outcome: string,
    error: unknown,
  ): Promise<void> {
    try {
      await this.prisma.aIInteraction.create({
        data: {
          // A generation job runs as a user, but a script may not.
          userId: request.context.userId ?? null,
          agent: request.context.agent,
          model: model ?? 'unknown',
          promptVersion: request.context.promptVersion,
          inputHash: hashPrompt(request),
          promptTokens: usage?.promptTokens ?? 0,
          completionTokens: usage?.completionTokens ?? 0,
          latencyMs,
          outcome,
          error: error instanceof Error ? error.message.slice(0, 500) : null,
        },
      });
    } catch (writeError) {
      this.logger.warn({ err: writeError }, 'Could not record AI usage');
    }
  }
}

/**
 * A stable fingerprint of the prompt, not the prompt itself.
 *
 * Prompts contain the user's own code and their interview answers. Storing
 * them by default would turn an observability table into a transcript of
 * everything they have written, so only a hash is kept — enough to tell two
 * identical calls apart from two different ones.
 */
function hashPrompt(request: GenerateRequest | StructuredRequest<unknown>): string {
  const text = request.prompt.messages.map((message) => message.content).join('\n');

  // FNV-1a. Not cryptographic and does not need to be: this groups repeated
  // calls, it does not protect anything.
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
}
