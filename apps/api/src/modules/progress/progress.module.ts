import { Module } from '@nestjs/common';

import { GenerationModule } from '../generation/generation.module.js';
import { SkillsModule } from '../skills/skills.module.js';

import { ProgressService } from './application/progress.service.js';
import { ProgressController } from './http/progress.controller.js';

@Module({
  imports: [SkillsModule, GenerationModule],
  controllers: [ProgressController],
  providers: [ProgressService],
})
export class ProgressModule {}
