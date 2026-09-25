import { Module } from '@nestjs/common';

import { GenerationModule } from '../generation/generation.module.js';
import { RoutinesModule } from '../routines/routines.module.js';
import { SkillsModule } from '../skills/skills.module.js';

import { ConceptTutorService } from './application/concept-tutor.service.js';
import { ConceptsService } from './application/concepts.service.js';
import { PracticeSetService } from './application/practice-set.service.js';
import { ConceptsController } from './http/concepts.controller.js';

@Module({
  imports: [SkillsModule, GenerationModule, RoutinesModule],
  controllers: [ConceptsController],
  providers: [ConceptsService, ConceptTutorService, PracticeSetService],
  exports: [ConceptsService, PracticeSetService],
})
export class ConceptsModule {}
