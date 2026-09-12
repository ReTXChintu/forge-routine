import { Module } from '@nestjs/common';

import { CurriculumModule } from '../curriculum/curriculum.module.js';
import { SkillsModule } from '../skills/skills.module.js';

import { TechnologiesService } from './application/technologies.service.js';
import { TechnologiesController } from './http/technologies.controller.js';

@Module({
  imports: [CurriculumModule, SkillsModule],
  controllers: [TechnologiesController],
  providers: [TechnologiesService],
  exports: [TechnologiesService],
})
export class TechnologiesModule {}
