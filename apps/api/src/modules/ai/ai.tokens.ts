import type { AIProvider } from '@forgeroutine/ai';

export const AI_PROVIDER = Symbol('AI_PROVIDER');

/**
 * `null` when no API key is configured.
 *
 * Every consumer must handle null and fall back, so a missing key degrades the
 * product rather than breaking it (docs/ai-architecture.md).
 */
export type OptionalAIProvider = AIProvider | null;
