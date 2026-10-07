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
       * Never null any more: whether a call can happen is decided per user,
       * per call, by what they have connected and saved.
       */
      useFactory: (config: AppConfig, prisma: PrismaService, settings: AISettingsService) => {
        // Always built, even where ENCRYPTION_KEY is unset and no key can be
        // stored: a user's own Claude Code or Codex, reached through the
        // ForgeRoutine Agent, needs no key at all.
        const routing = new RoutingAIProvider(
          // No server fallback. A user with no agent connected and no key
          // saved gets no AI: nobody spends anybody else's money by default.
          (userId) => settings.resolveChainFor(userId),
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
