import {
  AIUnavailable,
  type AIProvider,
  type EmbedRequest,
  type EmbedResult,
  type GenerateRequest,
  type GenerateResult,
  type StreamChunk,
  type StructuredRequest,
  type StructuredResult,
} from './ai-provider.port.js';
import type { AIVendor } from './catalogue.js';

/** What the application must look up to answer "whose key, which vendor". */
export interface ResolvedVendor {
  vendor: AIVendor;
  apiKey: string;
  modelFast: string;
  modelReasoning: string;
  embeddingModel: string | null;
}

/**
 * Finds the vendor for a call. Returning null means "no AI for this user",
 * which every agent already handles by taking its declared fallback.
 */
export type VendorResolver = (userId: string | undefined) => Promise<ResolvedVendor | null>;

export type ProviderBuilder = (resolved: ResolvedVendor) => AIProvider;

/**
 * Sends each call to whichever vendor its user has configured.
 *
 * This exists so that switching vendor is a settings change rather than a
 * redeploy, and it is a decorator rather than a change to the fifteen
 * agent call sites because `CallContext` already carries `userId`. Nothing
 * upstream of here knows there is more than one vendor.
 *
 * Built providers are cached by vendor and key, since constructing an SDK
 * client per call would open a fresh connection pool every time. The cache
 * is keyed on the key itself, so rotating a key builds a new client and the
 * old one falls out rather than being reused against a revoked secret.
 */
export class RoutingAIProvider implements AIProvider {
  readonly name = 'routing';

  private readonly clients = new Map<string, AIProvider>();

  constructor(
    private readonly resolve: VendorResolver,
    private readonly build: ProviderBuilder,
  ) {}

  private async providerFor(userId: string | undefined, agent: string): Promise<AIProvider> {
    const resolved = await this.resolve(userId);

    if (!resolved) {
      throw new AIUnavailable(
        agent,
        new Error('No AI provider is configured. Add a key in Settings → AI.'),
      );
    }

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

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const provider = await this.providerFor(req.context.userId, req.context.agent);
    return provider.generate(req);
  }

  async *stream(req: GenerateRequest): AsyncIterable<StreamChunk> {
    const provider = await this.providerFor(req.context.userId, req.context.agent);
    yield* provider.stream(req);
  }

  async structured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const provider = await this.providerFor(req.context.userId, req.context.agent);
    return provider.structured(req);
  }

  async embed(req: EmbedRequest): Promise<EmbedResult> {
    const provider = await this.providerFor(req.context.userId, req.context.agent);
    return provider.embed(req);
  }
}
