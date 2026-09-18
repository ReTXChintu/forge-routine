import { Global, Module } from '@nestjs/common';

import { buildAIProvider, envVendor, RoutingAIProvider } from '@forgeroutine/ai';
import type { AppConfig } from '@forgeroutine/config';

import { APP_CONFIG } from '../../infrastructure/config/config.module.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { AISettingsService } from '../settings/application/ai-settings.service.js';

import { AI_PROVIDER } from './ai.tokens.js';
import { AssistanceService } from './application/assistance.service.js';
import { AiController } from './http/ai.controller.js';
import { RecordingAIProvider } from './infrastructure/recording-ai.provider.js';

@Global()
@Module({
  controllers: [AiController],
  providers: [
    {
      provide: AI_PROVIDER,
      inject: [APP_CONFIG, PrismaService, AISettingsService],
      /**
       * Two decorators over whichever vendor the caller has configured.
       *
       * Recording on the outside so telemetry captures the model that was
       * actually used, whichever vendor routing picked; routing on the
       * inside so the fifteen agent call sites never learn there is more
       * than one vendor. `CallContext.userId` is already threaded through
       * every call, which is what makes per-user routing possible without
       * touching any of them.
       *
       * Null when no real call is possible: the master switch is off, or
       * there is neither a server vendor nor anywhere to keep a user's own
       * key. Every agent handles a null provider already.
       */
      useFactory: (config: AppConfig, prisma: PrismaService, settings: AISettingsService) => {
        // The master switch wins over everything, including a key a user
        // saved themselves. "Disables every model call" has to mean every
        // one, or it is not a switch anybody can rely on to stop a bill.
        if (!config.env.AI_ENABLED) return null;

        const fallback = envVendor(config);

        // No server vendor, and nowhere to put a user's own key either:
        // there is no path to a real call, so do not pretend otherwise.
        // Saying "available" here would have the generator queueing work
        // that can only fail.
        if (!fallback && !config.secretsEnabled) return null;

        const routing = new RoutingAIProvider(
          async (userId) => (await settings.resolveFor(userId)) ?? fallback,
          (resolved) =>
            buildAIProvider(resolved, {
              timeoutMs: config.env.AI_REQUEST_TIMEOUT_MS,
              maxRetries: config.env.AI_MAX_RETRIES,
              baseURL: config.env.OPENAI_BASE_URL,
            }),
        );

        return new RecordingAIProvider(routing, prisma);
      },
    },
    AssistanceService,
  ],
  exports: [AI_PROVIDER, AssistanceService],
})
export class AiModule {}
