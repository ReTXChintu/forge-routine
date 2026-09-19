import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  AI_VENDOR_PROFILES,
  buildAIProvider,
  describeAIFailure,
  isAIVendor,
  type ModelOption,
  type AIVendor,
  type ResolvedVendor,
} from '@forgeroutine/ai';
import type { AppConfig } from '@forgeroutine/config';
import { decryptSecret, encryptSecret, lastFour } from '@forgeroutine/utils';

import { Problems } from '../../../common/http/problem-details.js';
import { APP_CONFIG } from '../../../infrastructure/config/config.module.js';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';

export interface VendorSettingView {
  id: AIVendor;
  label: string;
  keyUrl: string;
  keyPrefix: string;
  note: string;
  /** Whether this user has saved a key for this vendor. */
  configured: boolean;
  /** Last four characters, so two keys can be told apart. Never the key. */
  keyLast4: string | null;
  verifiedAt: string | null;
  modelFast: string;
  modelReasoning: string;
  defaultFast: string;
  defaultReasoning: string;
}

export interface AISettingsView {
  /** The vendor this user's calls go to. Null means no AI for them. */
  selected: AIVendor | null;
  /** False when ENCRYPTION_KEY is unset: keys cannot be stored safely. */
  canStoreKeys: boolean;
  vendors: VendorSettingView[];
}

/**
 * Which model vendor a user's AI calls go to, and the key to reach it.
 *
 * Keys are encrypted with `ENCRYPTION_KEY` and never leave this service in
 * plaintext except on the way to the vendor. Nothing here returns a key,
 * there is no endpoint that can, and `keyLast4` exists only so a user can
 * tell two keys apart in the UI.
 *
 * Storing them at all is a considered trade. The alternative — one vendor
 * in the server's environment — meant switching vendor was a redeploy, and
 * meant every user spent the operator's money. Per-user keys make the
 * choice a setting and the bill the chooser's.
 */
@Injectable()
export class AISettingsService {
  private readonly logger = new Logger(AISettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async view(userId: string): Promise<AISettingsView> {
    const [preferences, credentials] = await Promise.all([
      this.prisma.userPreferences.findUnique({
        where: { userId },
        select: { aiProvider: true },
      }),
      this.prisma.aICredential.findMany({ where: { userId } }),
    ]);

    const byVendor = new Map(credentials.map((row) => [row.provider as AIVendor, row]));

    return {
      selected: (preferences?.aiProvider as AIVendor | null) ?? null,
      canStoreKeys: this.config.secretsEnabled,
      vendors: Object.values(AI_VENDOR_PROFILES).map((profile) => {
        const saved = byVendor.get(profile.id);
        return {
          id: profile.id,
          label: profile.label,
          keyUrl: profile.keyUrl,
          keyPrefix: profile.keyPrefix,
          note: profile.note,
          configured: saved !== undefined,
          keyLast4: saved?.keyLast4 ?? null,
          verifiedAt: saved?.verifiedAt?.toISOString() ?? null,
          modelFast: saved?.modelFast ?? profile.defaultFast,
          modelReasoning: saved?.modelReasoning ?? profile.defaultReasoning,
          defaultFast: profile.defaultFast,
          defaultReasoning: profile.defaultReasoning,
        };
      }),
    };
  }

  /** Chooses the vendor. Null turns AI off for this user. */
  async select(userId: string, vendor: AIVendor | null): Promise<AISettingsView> {
    if (vendor !== null) {
      const credential = await this.prisma.aICredential.findUnique({
        where: { userId_provider: { userId, provider: vendor } },
        select: { id: true },
      });

      // Selecting a vendor with no key would leave every agent falling back
      // silently, which reads as "the AI is broken" rather than "you have
      // not finished setting this up".
      if (!credential) {
        throw Problems.badRequest(
          `Add a ${AI_VENDOR_PROFILES[vendor].label} API key before selecting it.`,
        );
      }
    }

    await this.prisma.userPreferences.upsert({
      where: { userId },
      create: { userId, aiProvider: vendor },
      update: { aiProvider: vendor },
    });

    return this.view(userId);
  }

  /**
   * Saves a key, models, or both.
   *
   * `apiKey` is optional on purpose. It used to be required, which meant
   * changing a model name was impossible without pasting the key again —
   * so a model edit silently did nothing and calls kept going to the old
   * one. Anything omitted here keeps the value already stored.
   */
  async saveKey(
    userId: string,
    vendor: AIVendor,
    input: { apiKey?: string | null; modelFast?: string | null; modelReasoning?: string | null },
  ): Promise<AISettingsView> {
    const apiKey = input.apiKey?.trim() ?? '';
    const profile = AI_VENDOR_PROFILES[vendor];

    const existing = await this.prisma.aICredential.findUnique({
      where: { userId_provider: { userId, provider: vendor } },
      select: { id: true },
    });

    if (apiKey.length === 0 && !existing) {
      throw Problems.badRequest(`Add a ${profile.label} API key first.`);
    }
    if (apiKey.length > 0 && apiKey.length < 8) {
      throw Problems.badRequest('That does not look like an API key.');
    }

    const models = {
      modelFast: blankToNull(input.modelFast),
      modelReasoning: blankToNull(input.modelReasoning),
      // Cleared on a model change as well as a key change. A tick earned
      // by a different model vouches for nothing about this one.
      verifiedAt: null,
    };

    const credentials = apiKey
      ? {
          keyCipher: encryptSecret(apiKey, this.requireEncryptionKey()),
          keyLast4: lastFour(apiKey),
        }
      : {};

    if (existing) {
      await this.prisma.aICredential.update({
        where: { id: existing.id },
        data: { ...models, ...credentials },
      });
    } else {
      await this.prisma.aICredential.create({
        data: { userId, provider: vendor, ...models, ...credentials } as never,
      });
    }

    // Never the key, never the cipher. Enough to answer "did my save land".
    this.logger.log(`${profile.label} ${apiKey ? 'key and models' : 'models'} saved for ${userId}`);

    return this.view(userId);
  }

  /**
   * The models this user's key can actually reach.
   *
   * Asked of the vendor rather than kept in a list here. A hard-coded set
   * goes stale the moment a vendor retires something, and the user finds
   * out through a failed call naming a model they never picked — which is
   * exactly how `gemini-2.5-flash` outlived its own support window here.
   */
  async listModels(userId: string, vendor: AIVendor): Promise<ModelOption[]> {
    const credential = await this.prisma.aICredential.findUnique({
      where: { userId_provider: { userId, provider: vendor } },
    });
    if (!credential) throw Problems.badRequest('Add a key for this provider first.');

    const provider = buildAIProvider(this.toResolved(credential), {
      timeoutMs: Math.min(this.config.env.AI_REQUEST_TIMEOUT_MS, 20_000),
      maxRetries: 0,
    });

    try {
      const models = await provider.listModels({
        userId,
        agent: 'settings-models',
        promptVersion: 'v1',
      });
      return [...models].sort((a, b) => a.id.localeCompare(b.id));
    } catch (error) {
      throw Problems.badRequest(describeAIFailure(error));
    }
  }

  async removeKey(userId: string, vendor: AIVendor): Promise<AISettingsView> {
    await this.prisma.aICredential.deleteMany({ where: { userId, provider: vendor } });

    // Leaving it selected would point every call at a vendor with no key.
    const preferences = await this.prisma.userPreferences.findUnique({
      where: { userId },
      select: { aiProvider: true },
    });
    if (preferences?.aiProvider === vendor) {
      await this.prisma.userPreferences.update({
        where: { userId },
        data: { aiProvider: null },
      });
    }

    return this.view(userId);
  }

  /**
   * Makes one real, tiny call to prove the key works.
   *
   * Worth the fraction of a cent. The alternative is finding out the key is
   * wrong when a curriculum generation fails twenty minutes in, by which
   * point the failure looks like a product bug.
   */
  async test(userId: string, vendor: AIVendor): Promise<{ ok: boolean; detail: string }> {
    const credential = await this.prisma.aICredential.findUnique({
      where: { userId_provider: { userId, provider: vendor } },
    });
    if (!credential) return { ok: false, detail: 'No key saved for this provider.' };

    // Resolved here rather than through `resolveFor`, which swallows a
    // decryption failure to keep agents degrading quietly. On this screen
    // that silence is the wrong answer: someone who has just pasted a key
    // and been told "no provider configured" has no idea what to do.
    let resolved: ResolvedVendor;
    try {
      resolved = this.toResolved(credential);
    } catch (error) {
      this.logger.error(
        `Could not decrypt the ${vendor} key for ${userId}`,
        error instanceof Error ? error.stack : undefined,
      );
      return {
        ok: false,
        detail:
          'This key cannot be decrypted, which means ENCRYPTION_KEY has changed since it ' +
          'was saved. Save the key again to re-encrypt it with the current one.',
      };
    }

    const provider = buildAIProvider(resolved, {
      timeoutMs: Math.min(this.config.env.AI_REQUEST_TIMEOUT_MS, 20_000),
      // No retries: a wrong key is wrong three times as well as once, and
      // the user is watching a spinner while it finds that out.
      maxRetries: 0,
    });

    try {
      const result = await provider.generate({
        prompt: {
          model: 'fast',
          maxTokens: 16,
          temperature: 0,
          messages: [{ role: 'user', content: 'Reply with the single word: ready' }],
        },
        context: { userId, agent: 'settings-test', promptVersion: 'v1' },
      });

      await this.prisma.aICredential.updateMany({
        where: { userId, provider: vendor },
        data: { verifiedAt: new Date() },
      });

      return {
        ok: true,
        detail: `${AI_VENDOR_PROFILES[vendor].label} answered on ${result.model}.`,
      };
    } catch (error) {
      // The vendor's own sentence is the useful part — "API key not valid"
      // tells the user exactly what to fix, where "AI provider unavailable"
      // sends them to open a support ticket. It lives several levels down
      // in the cause chain, inside a JSON envelope, so it has to be dug out.
      const detail = describeAIFailure(error);
      this.logger.warn(`${vendor} key test failed for ${userId}: ${detail}`);
      return { ok: false, detail };
    }
  }

  /**
   * The vendor and key for a user's calls, or null for none.
   *
   * This is what `RoutingAIProvider` calls on every request. There is no
   * server fallback behind it: a user who has saved no key gets no AI, and
   * every agent already handles that by taking its declared fallback.
   */
  async resolveFor(userId: string | undefined, force?: AIVendor): Promise<ResolvedVendor | null> {
    if (!userId) return null;

    const vendor = force ?? (await this.selectedVendor(userId));
    if (!vendor) return null;

    const credential = await this.prisma.aICredential.findUnique({
      where: { userId_provider: { userId, provider: vendor } },
    });
    if (!credential) return null;

    try {
      return this.toResolved(credential);
    } catch (error) {
      // Almost always a changed ENCRYPTION_KEY. Degrading rather than
      // throwing keeps the product usable; the log says what to do, and
      // the settings screen reports it properly when a key is tested.
      this.logger.error(
        `Could not decrypt the ${vendor} key for ${userId}. ` +
          'If ENCRYPTION_KEY changed, saved keys must be re-entered.',
        error instanceof Error ? error.stack : undefined,
      );
      return null;
    }
  }

  /** Decrypts one stored credential and fills in the vendor's defaults. */
  private toResolved(credential: {
    provider: string;
    keyCipher: string;
    modelFast: string | null;
    modelReasoning: string | null;
  }): ResolvedVendor {
    const vendor = credential.provider as AIVendor;
    const profile = AI_VENDOR_PROFILES[vendor];

    return {
      vendor,
      apiKey: decryptSecret(credential.keyCipher, this.requireEncryptionKey()),
      modelFast: credential.modelFast ?? profile.defaultFast,
      modelReasoning: credential.modelReasoning ?? profile.defaultReasoning,
      embeddingModel: profile.defaultEmbedding,
    };
  }

  private async selectedVendor(userId: string): Promise<AIVendor | null> {
    const preferences = await this.prisma.userPreferences.findUnique({
      where: { userId },
      select: { aiProvider: true },
    });

    return (preferences?.aiProvider as AIVendor | null) ?? null;
  }

  private requireEncryptionKey(): string {
    const key = this.config.env.ENCRYPTION_KEY.trim();
    if (key.length < 16) {
      throw Problems.badRequest(
        'This server cannot store API keys: ENCRYPTION_KEY is not configured.',
      );
    }
    return key;
  }
}

export function parseVendor(value: string): AIVendor {
  const upper = value.toUpperCase();
  if (!isAIVendor(upper)) throw Problems.notFound('Provider');
  return upper;
}

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}
