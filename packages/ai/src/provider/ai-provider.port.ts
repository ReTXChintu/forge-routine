import type { z } from 'zod';

import type { AIModelTier } from '@forgeroutine/shared-types';

/**
 * The interface the application depends on (§27).
 *
 * OpenAI is the only provider ForgeRoutine ships with. The port exists so that
 * prompts, agents, and the learning domain do not have to be rewritten if that
 * changes, and so a deterministic fake can satisfy the same contract in tests.
 */

export interface PromptMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface PromptSpec {
  messages: PromptMessage[];
  /** Symbolic tier resolved to a concrete model by config, so upgrades are config-only. */
  model: AIModelTier;
  temperature?: number;
  maxTokens?: number;
}

export interface CallContext {
  /** For per-user budget accounting and AIInteraction attribution. */
  userId?: string;
  agent: string;
  promptVersion: string;
  signal?: AbortSignal;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface GenerateResult {
  text: string;
  usage: TokenUsage;
  model: string;
  latencyMs: number;
}

export interface StructuredResult<T> {
  data: T;
  usage: TokenUsage;
  model: string;
  latencyMs: number;
  /** Number of schema-repair round trips needed. >0 is a prompt-quality signal. */
  repairAttempts: number;
}

export interface EmbedResult {
  vectors: number[][];
  usage: TokenUsage;
  model: string;
}

export interface StreamChunk {
  delta: string;
  done: boolean;
}

export interface StructuredRequest<T> {
  prompt: PromptSpec;
  schema: z.ZodType<T>;
  /** Stable name for the JSON schema sent to the model. */
  schemaName: string;
  context: CallContext;
}

export interface GenerateRequest {
  prompt: PromptSpec;
  context: CallContext;
}

export interface EmbedRequest {
  inputs: string[];
  context: CallContext;
}

export interface AIProvider {
  readonly name: string;
  generate(req: GenerateRequest): Promise<GenerateResult>;
  stream(req: GenerateRequest): AsyncIterable<StreamChunk>;
  structured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>>;
  embed(req: EmbedRequest): Promise<EmbedResult>;
}

// -- Errors -----------------------------------------------------------------

/** Base for every failure that should trigger an agent's declared fallback. */
export class AIError extends Error {
  constructor(
    message: string,
    public readonly agent: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AIError';
  }
}

/** The model returned output that does not satisfy the agent's schema, twice. */
export class AIContractViolation extends AIError {
  constructor(
    agent: string,
    public readonly issues: string[],
    public readonly raw: string,
  ) {
    super(`AI output failed its contract for agent "${agent}": ${issues.join('; ')}`, agent);
    this.name = 'AIContractViolation';
  }
}

export class AIUnavailable extends AIError {
  constructor(agent: string, cause?: unknown) {
    super(`AI provider unavailable for agent "${agent}"`, agent, cause);
    this.name = 'AIUnavailable';
  }
}

/**
 * The most useful sentence available for a failed AI call.
 *
 * Every provider wraps vendor failures in `AIUnavailable`, whose own
 * message names the agent and nothing else — fine for a log line, useless
 * in front of someone who has just pasted a key. The real reason is one or
 * more levels down in `cause`, and for three of the four vendors it arrives
 * as a JSON error envelope rather than a sentence.
 *
 * So: walk to the deepest cause, and if it turns out to be JSON, lift the
 * message out of it. "API key not valid. Please pass a valid API key."
 * tells the user exactly what to do. "AI provider unavailable" does not.
 */
export function describeAIFailure(error: unknown, maxLength = 300): string {
  let current: unknown = error;
  let best = '';

  // Bounded: a malformed cause chain must not become an infinite walk.
  for (let depth = 0; depth < 8 && current instanceof Error; depth += 1) {
    if (current.message) best = current.message;
    current = (current as { cause?: unknown }).cause;
  }

  const extracted = extractVendorMessage(best);
  const clean = (extracted || best || 'Unknown error').trim();

  return clean.length > maxLength ? `${clean.slice(0, maxLength - 1)}…` : clean;
}

/**
 * Vendors answer errors with JSON, and sometimes with a status line glued
 * to the front of it. Both OpenAI and Gemini nest the readable part under
 * `error.message`.
 */
function extractVendorMessage(raw: string): string | null {
  const start = raw.indexOf('{');
  if (start === -1) return null;

  try {
    const parsed: unknown = JSON.parse(raw.slice(start));
    if (typeof parsed !== 'object' || parsed === null) return null;

    const error = (parsed as { error?: unknown }).error;
    if (typeof error === 'string') return error;
    if (typeof error === 'object' && error !== null) {
      const message = (error as { message?: unknown }).message;
      if (typeof message === 'string') return message;
    }

    const message = (parsed as { message?: unknown }).message;
    return typeof message === 'string' ? message : null;
  } catch {
    // Not JSON after all. The raw message is still better than nothing.
    return null;
  }
}

/** The user's daily token budget is spent. Degrade, do not error at the user. */
export class AIBudgetExceeded extends AIError {
  constructor(agent: string) {
    super(`Daily AI token budget exceeded before agent "${agent}"`, agent);
    this.name = 'AIBudgetExceeded';
  }
}
