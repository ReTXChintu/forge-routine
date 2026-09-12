import { Module, type Provider } from '@nestjs/common';
import type { AppConfig } from '@forgeroutine/config';

import { APP_CONFIG } from '../../infrastructure/config/config.module.js';
import { SkillsModule } from '../skills/skills.module.js';

import { SubmissionsQueryService } from './application/submissions-query.service.js';
import { SubmitSolutionUseCase } from './application/submit-solution.use-case.js';
import { SubmissionsController } from './http/submissions.controller.js';
import { InlineExecutionAdapter } from './infrastructure/inline-execution.adapter.js';
import { QueueExecutionAdapter } from './infrastructure/queue-execution.adapter.js';
import { CODE_EXECUTION_PORT } from './ports/code-execution.port.js';

/**
 * Binds the execution port to the configured driver. The application layer never
 * learns which one it got — that is the entire point of the port.
 */
const executionProvider: Provider = {
  provide: CODE_EXECUTION_PORT,
  inject: [APP_CONFIG],
  useFactory: (config: AppConfig) =>
    config.env.EXECUTION_DRIVER === 'queue'
      ? new QueueExecutionAdapter(config)
      : new InlineExecutionAdapter(config),
};

@Module({
  imports: [SkillsModule],
  controllers: [SubmissionsController],
  providers: [SubmitSolutionUseCase, SubmissionsQueryService, executionProvider],
  exports: [SubmitSolutionUseCase],
})
export class SubmissionsModule {}
