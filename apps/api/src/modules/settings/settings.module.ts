import { Global, Module } from '@nestjs/common';

import { AISettingsService } from './application/ai-settings.service.js';
import { AISettingsController } from './http/ai-settings.controller.js';

/**
 * Global because the AI module's provider factory needs it to resolve a
 * vendor per call, and a circular import between the two would otherwise
 * be the only way to arrange that.
 */
@Global()
@Module({
  controllers: [AISettingsController],
  providers: [AISettingsService],
  exports: [AISettingsService],
})
export class SettingsModule {}
