import { Global, Module } from '@nestjs/common';

import { createAIProvider } from '@forgeroutine/ai';
import type { AppConfig } from '@forgeroutine/config';

import { APP_CONFIG } from '../../infrastructure/config/config.module.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';

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
      inject: [APP_CONFIG, PrismaService],
      // Wrapped so every call lands in AIInteraction. Without it the only
      // record of what generation cost is the OpenAI dashboard, which cannot
      // say which technology or which agent spent it.
      useFactory: (config: AppConfig, prisma: PrismaService) => {
        const provider = createAIProvider(config);
        return provider === null ? null : new RecordingAIProvider(provider, prisma);
      },
    },
    AssistanceService,
  ],
  exports: [AI_PROVIDER, AssistanceService],
})
export class AiModule {}
