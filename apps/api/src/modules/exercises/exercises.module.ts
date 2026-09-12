import { Module } from '@nestjs/common';

import { ConceptsModule } from '../concepts/concepts.module.js';
import { SkillsModule } from '../skills/skills.module.js';

import { ExercisesService } from './application/exercises.service.js';
import { ExercisesController } from './http/exercises.controller.js';

@Module({
  imports: [SkillsModule, ConceptsModule],
  controllers: [ExercisesController],
  providers: [ExercisesService],
  exports: [ExercisesService],
})
export class ExercisesModule {}
