import { Global, Module } from '@nestjs/common';

import { buildAIProvider, RoutingAIProvider } from '@forgeroutine/ai';
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
       * Null when no real call is possible — which now means only one
       * thing: this server cannot store a key, so no user can supply one.
       * Every agent handles a null provider already.
       */
      useFactory: (config: AppConfig, prisma: PrismaService, settings: AISettingsService) => {
        // Nowhere to put a key means no user can ever supply one, so there
        // is no path to a real call. Saying "available" here would have the
        // generator queueing work that can only fail.
        if (!config.secretsEnabled) return null;

        const routing = new RoutingAIProvider(
          // No fallback. A user with no key saved gets no AI, which is the
          // whole point: nobody spends anybody else's money by default.
          (userId) => settings.resolveFor(userId),
          (resolved) =>
            buildAIProvider(resolved, {
              timeoutMs: config.env.AI_REQUEST_TIMEOUT_MS,
              maxRetries: config.env.AI_MAX_RETRIES,
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
