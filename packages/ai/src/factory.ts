import type { AppConfig } from '@forgeroutine/config';

import { type AIProvider } from './provider/ai-provider.port.js';
import { AnthropicProvider } from './provider/anthropic/anthropic.provider.js';
import { AI_VENDOR_PROFILES, type AIVendor } from './provider/catalogue.js';
import { GeminiProvider } from './provider/gemini/gemini.provider.js';
import { OpenAIProvider } from './provider/openai/openai.provider.js';
import type { ResolvedVendor } from './provider/routing.provider.js';

/**
 * Builds a client for one already-resolved vendor and key.
 *
 * Pure: it is handed a vendor, a key and two model names, and knows
 * nothing about where they came from. That is what lets the same function
 * serve a key from the server's own environment, a key a user saved in
 * settings, and a key being tested before it is saved.
 */
export function buildAIProvider(
  resolved: ResolvedVendor,
  options: { timeoutMs: number; maxRetries: number; baseURL?: string },
): AIProvider {
  switch (resolved.vendor) {
    case 'ANTHROPIC':
      return new AnthropicProvider({
        apiKey: resolved.apiKey,
        modelFast: resolved.modelFast,
        modelReasoning: resolved.modelReasoning,
        timeoutMs: options.timeoutMs,
        maxRetries: options.maxRetries,
      });

    case 'GEMINI':
      return new GeminiProvider({
        apiKey: resolved.apiKey,
        modelFast: resolved.modelFast,
        modelReasoning: resolved.modelReasoning,
        embeddingModel: resolved.embeddingModel ?? AI_VENDOR_PROFILES.GEMINI.defaultEmbedding!,
        timeoutMs: options.timeoutMs,
      });

    case 'OPENAI':
      return new OpenAIProvider({
        apiKey: resolved.apiKey,
        baseURL: options.baseURL ?? 'https://api.openai.com/v1',
        modelFast: resolved.modelFast,
        modelReasoning: resolved.modelReasoning,
        embeddingModel: resolved.embeddingModel ?? AI_VENDOR_PROFILES.OPENAI.defaultEmbedding!,
        timeoutMs: options.timeoutMs,
        maxRetries: options.maxRetries,
      });
  }
}

/**
 * The server's own vendor, from environment configuration.
 *
 * Still here, and still the fallback, so a deployment that has never
 * touched the settings screen behaves exactly as it did before. A user who
 * saves their own key overrides it; everyone else uses this.
 *
 * Returns `null` rather than throwing when nothing is configured: every
 * agent declares a fallback and the product must stay usable without AI
 * (docs/ai-architecture.md). A hard failure here would make a missing key
 * take down learning entirely.
 */
export function envVendor(config: AppConfig): ResolvedVendor | null {
  if (!config.aiEnabled) return null;

  const { env } = config;
  const vendor = env.AI_PROVIDER.toUpperCase() as AIVendor;
  const profile = AI_VENDOR_PROFILES[vendor] ?? AI_VENDOR_PROFILES.OPENAI;

  const apiKey =
    vendor === 'ANTHROPIC'
      ? env.ANTHROPIC_API_KEY
      : vendor === 'GEMINI'
        ? env.GEMINI_API_KEY
        : env.OPENAI_API_KEY;

  if (apiKey.trim().length === 0) return null;

  return {
    vendor: profile.id,
    apiKey,
    // The OPENAI_MODEL_* names predate multi-vendor support and are kept
    // for compatibility, but they only mean anything when OpenAI is the
    // configured vendor — a `gpt-4o` sent to Claude is a 404.
    modelFast: vendor === 'OPENAI' ? env.OPENAI_MODEL_FAST : profile.defaultFast,
    modelReasoning: vendor === 'OPENAI' ? env.OPENAI_MODEL_REASONING : profile.defaultReasoning,
    embeddingModel: vendor === 'OPENAI' ? env.OPENAI_EMBEDDING_MODEL : profile.defaultEmbedding,
  };
}

/**
 * Resolves the configured provider.
 *
 * Kept for callers that want the server's own vendor directly, without
 * per-user routing — the curriculum generator running from a script, for
 * instance, where there is no request and no user.
 */
export function createAIProvider(config: AppConfig): AIProvider | null {
  const resolved = envVendor(config);
  if (!resolved) return null;

  return buildAIProvider(resolved, {
    timeoutMs: config.env.AI_REQUEST_TIMEOUT_MS,
    maxRetries: config.env.AI_MAX_RETRIES,
    baseURL: config.env.OPENAI_BASE_URL,
  });
}
