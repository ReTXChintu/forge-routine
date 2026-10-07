import { type AIProvider } from './provider/ai-provider.port.js';
import { AnthropicProvider } from './provider/anthropic/anthropic.provider.js';
import { AI_VENDOR_PROFILES } from './provider/catalogue.js';
import { ClaudeCodeProvider } from './provider/claude-code/claude-code.provider.js';
import { CodexProvider } from './provider/codex/codex.provider.js';
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

    case 'CLAUDE_CODE':
      // No key: the CLI carries its own credentials, which is the whole
      // reason this vendor exists.
      return new ClaudeCodeProvider({
        modelFast: resolved.modelFast,
        modelReasoning: resolved.modelReasoning,
        // Generous against the other vendors. Process start plus an agent
        // loop is seconds even for a short answer, and a timeout that fires
        // on a working call is worse than a slow one.
        timeoutMs: Math.max(options.timeoutMs, 120_000),
        // Set when the CLI is on the user's machine, reached through the
        // ForgeRoutine Agent, rather than on this server.
        ...(resolved.executor ? { executor: resolved.executor } : {}),
      });

    case 'CODEX':
      // Keyless, like Claude Code: the CLI carries its own sign-in.
      return new CodexProvider({
        modelFast: resolved.modelFast,
        modelReasoning: resolved.modelReasoning,
        // Generous: process start plus an agent turn is seconds even for a
        // short answer, and a timeout that fires on a working call is worse
        // than a slow one.
        timeoutMs: Math.max(options.timeoutMs, 120_000),
        ...(resolved.executor ? { executor: resolved.executor } : {}),
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
        maxRetries: options.maxRetries,
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
