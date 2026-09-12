import { Module } from '@nestjs/common';

import { SkillsModule } from '../skills/skills.module.js';

import { ConceptsService } from './application/concepts.service.js';
import { ConceptsController } from './http/concepts.controller.js';

@Module({
  imports: [SkillsModule],
  controllers: [ConceptsController],
  providers: [ConceptsService],
  exports: [ConceptsService],
})
export class ConceptsModule {}
