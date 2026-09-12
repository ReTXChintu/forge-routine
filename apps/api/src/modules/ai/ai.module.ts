import { Global, Module } from '@nestjs/common';

import { createAIProvider } from '@forgeroutine/ai';
import type { AppConfig } from '@forgeroutine/config';

import { APP_CONFIG } from '../../infrastructure/config/config.module.js';

import { AI_PROVIDER } from './ai.tokens.js';
import { AssistanceService } from './application/assistance.service.js';
import { AiController } from './http/ai.controller.js';

@Global()
@Module({
  controllers: [AiController],
  providers: [
    {
      provide: AI_PROVIDER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => createAIProvider(config),
    },
    AssistanceService,
  ],
  exports: [AI_PROVIDER, AssistanceService],
})
export class AiModule {}
