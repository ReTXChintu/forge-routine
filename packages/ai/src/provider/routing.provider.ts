import {
  AIUnavailable,
  type AIProvider,
  type CallContext,
  type EmbedRequest,
  type EmbedResult,
  type GenerateRequest,
  type GenerateResult,
  type ModelOption,
  type StreamChunk,
  type StructuredRequest,
  type StructuredResult,
} from './ai-provider.port.js';
import type { AIVendor } from './catalogue.js';
import type { CliExecutor } from './cli/run-cli.js';

/** What the application must look up to answer "whose key, which vendor". */
export interface ResolvedVendor {
  vendor: AIVendor;
  apiKey: string;
  modelFast: string;
  modelReasoning: string;
  embeddingModel: string | null;
  /**
   * Set for Claude Code or Codex running on the user's own machine through
   * the ForgeRoutine Agent, rather than on this server.
   */
  executor?: CliExecutor;
  /**
   * Whether a caller's `modelOverride` applies here. The assistant's pinned
   * model belongs to one vendor; handing "gpt-5" to Claude Code because the
   * chain fell through to it would fail for no reason. Defaults to true.
   */
  keepsModelOverride?: boolean;
}

/**
 * The vendors to try for a call, in order. Empty means "no AI for this user",
 * which every agent already handles by taking its declared fallback.
 */
export type VendorResolver = (userId: string | undefined) => Promise<ResolvedVendor[]>;

export type ProviderBuilder = (resolved: ResolvedVendor) => AIProvider;

/**
 * Sends each call to the vendors its user has, in order, until one answers.
 *
 * This exists so that switching vendor is a settings change rather than a
 * redeploy, and it is a decorator rather than a change to the fifteen
 * agent call sites because `CallContext` already carries `userId`. Nothing
 * upstream of here knows there is more than one vendor.
 *
 * The order is the user's: their local CLIs through the ForgeRoutine Agent
 * when it is connected, then each saved key. Only `AIUnavailable` moves on to
 * the next — the vendor could not answer at all. A contract violation is an
 * answer, and the agents already know what to do with a bad one.
 *
 * Built providers are cached by vendor and key, since constructing an SDK
 * client per call would open a fresh connection pool every time. The cache
 * is keyed on the key itself, so rotating a key builds a new client and the
 * old one falls out rather than being reused against a revoked secret. Agent
 * entries are not cached: they are cheap and tied to one live connection.
 */
export class RoutingAIProvider implements AIProvider {
  readonly name = 'routing';

  private readonly clients = new Map<string, AIProvider>();

  constructor(
    private readonly resolve: VendorResolver,
    private readonly build: ProviderBuilder,
  ) {}

  private async chainFor(userId: string | undefined, agent: string): Promise<ResolvedVendor[]> {
    const chain = await this.resolve(userId);

    if (chain.length === 0) {
      throw new AIUnavailable(
        agent,
        new Error(
          'No AI provider is available. Start the ForgeRoutine Agent, or add a key in Settings → AI.',
        ),
      );
    }

    return chain;
  }

  private providerOf(resolved: ResolvedVendor): AIProvider {
    if (resolved.executor) return this.build(resolved);

    const cacheKey = `${resolved.vendor}:${resolved.apiKey}:${resolved.modelFast}:${resolved.modelReasoning}`;
    const existing = this.clients.get(cacheKey);
    if (existing) return existing;

    const provider = this.build(resolved);

    // A user changing model names repeatedly should not grow this without
    // bound. Small and crude on purpose: the realistic ceiling is one
    // entry per user, and this app is sized for ten of them.
    if (this.clients.size > 32) this.clients.clear();
    this.clients.set(cacheKey, provider);

    return provider;
  }

  /** Drops cached clients, so a key change takes effect on the next call. */
  forget(): void {
    this.clients.clear();
  }

  /**
   * Tries each vendor in turn. The last failure is what surfaces when none
   * answers, since by then it is the most specific thing there is to say.
   */
  private async firstThatAnswers<R>(
    userId: string | undefined,
    context: CallContext,
    call: (provider: AIProvider, context: CallContext) => Promise<R>,
  ): Promise<R> {
    const chain = await this.chainFor(userId, context.agent);
    let lastError: unknown;

    for (const resolved of chain) {
      try {
        return await call(this.providerOf(resolved), contextFor(resolved, context));
      } catch (error) {
        if (!(error instanceof AIUnavailable)) throw error;
        lastError = error;
      }
    }

    throw lastError;
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    return this.firstThatAnswers(req.context.userId, req.context, (provider, context) =>
      provider.generate({ ...req, context }),
    );
  }

  /**
   * Falls through only before the first chunk. Once text has reached the
   * reader, switching vendor would splice two different answers together.
   */
  async *stream(req: GenerateRequest): AsyncIterable<StreamChunk> {
    const chain = await this.chainFor(req.context.userId, req.context.agent);
    let lastError: unknown;

    for (const resolved of chain) {
      let started = false;
      try {
        const context = contextFor(resolved, req.context);
        for await (const chunk of this.providerOf(resolved).stream({ ...req, context })) {
          started = true;
          yield chunk;
        }
        return;
      } catch (error) {
        if (started || !(error instanceof AIUnavailable)) throw error;
        lastError = error;
      }
    }

    throw lastError;
  }

  async structured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    return this.firstThatAnswers(req.context.userId, req.context, (provider, context) =>
      provider.structured({ ...req, context }),
    );
  }

  /** The models of whichever vendor would answer first. */
  async listModels(context: CallContext): Promise<ModelOption[]> {
    const [first] = await this.chainFor(context.userId, context.agent);
    return this.providerOf(first!).listModels(contextFor(first!, context));
  }

  async embed(req: EmbedRequest): Promise<EmbedResult> {
    return this.firstThatAnswers(req.context.userId, req.context, (provider, context) =>
      provider.embed({ ...req, context }),
    );
  }
}

/** The caller's context, without a model override that belongs to another vendor. */
function contextFor(resolved: ResolvedVendor, context: CallContext): CallContext {
  if (resolved.keepsModelOverride !== false || !context.modelOverride) return context;

  const { modelOverride: _dropped, ...rest } = context;
  return rest;
}
