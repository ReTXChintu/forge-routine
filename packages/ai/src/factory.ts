import { type AIProvider } from './provider/ai-provider.port.js';
import { AnthropicProvider } from './provider/anthropic/anthropic.provider.js';
import { AI_VENDOR_PROFILES } from './provider/catalogue.js';
import { GeminiProvider } from './provider/gemini/gemini.provider.js';
import { OpenAIProvider } from './provider/openai/openai.provider.js';
import type { ResolvedVendor } from './provider/routing.provider.js';

export interface BuildOptions {
  timeoutMs: number;
  maxRetries: number;
}

/**
 * Builds a client for one vendor and one key.
 *
 * The only way to get a provider. There is deliberately no function that
 * reads a vendor out of the environment, because there is no server vendor
 * to read: every key belongs to the user whose call it is, and this is
 * handed one that has already been resolved and decrypted.
 *
 * Pure, so the same function serves a key being used, a key being tested
 * before it is saved, and a key a script was given explicitly.
 */
export function buildAIProvider(resolved: ResolvedVendor, options: BuildOptions): AIProvider {
  const profile = AI_VENDOR_PROFILES[resolved.vendor];

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
        // Non-null for Gemini in the catalogue; the fallback only exists so
        // a future profile without embeddings cannot crash the build.
        embeddingModel: resolved.embeddingModel ?? profile.defaultEmbedding ?? '',
        timeoutMs: options.timeoutMs,
      });

    case 'OPENAI':
      return new OpenAIProvider({
        apiKey: resolved.apiKey,
        baseURL: profile.baseUrl,
        modelFast: resolved.modelFast,
        modelReasoning: resolved.modelReasoning,
        embeddingModel: resolved.embeddingModel ?? profile.defaultEmbedding ?? '',
        timeoutMs: options.timeoutMs,
        maxRetries: options.maxRetries,
      });
  }
}
