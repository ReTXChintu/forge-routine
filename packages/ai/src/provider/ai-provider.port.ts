import type { AIModelTier } from '@forgeroutine/shared-types';
import type { z } from 'zod';

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

/** The user's daily token budget is spent. Degrade, do not error at the user. */
export class AIBudgetExceeded extends AIError {
  constructor(agent: string) {
    super(`Daily AI token budget exceeded before agent "${agent}"`, agent);
    this.name = 'AIBudgetExceeded';
  }
}
