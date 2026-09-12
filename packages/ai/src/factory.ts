import type { AppConfig } from '@forgeroutine/config';

import { type AIProvider } from './provider/ai-provider.port.js';
import { OpenAIProvider } from './provider/openai/openai.provider.js';

/**
 * Resolves the configured provider.
 *
 * Returns `null` rather than throwing when no key is present: every agent declares
 * a fallback, and the product must stay usable without AI (docs/ai-architecture.md).
 * A hard failure here would make a missing key take down learning entirely.
 */
export function createAIProvider(config: AppConfig): AIProvider | null {
  if (!config.aiEnabled) return null;

  const { env } = config;

  return new OpenAIProvider({
    apiKey: env.OPENAI_API_KEY,
    baseURL: env.OPENAI_BASE_URL,
    modelFast: env.OPENAI_MODEL_FAST,
    modelReasoning: env.OPENAI_MODEL_REASONING,
    embeddingModel: env.OPENAI_EMBEDDING_MODEL,
    timeoutMs: env.AI_REQUEST_TIMEOUT_MS,
    maxRetries: env.AI_MAX_RETRIES,
  });
}
