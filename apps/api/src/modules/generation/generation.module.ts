import { Module } from '@nestjs/common';

import { RoadmapModule } from '../roadmap/roadmap.module.js';

import { CurriculumGeneratorService } from './application/curriculum-generator.service.js';
import { ExerciseVerifier } from './application/exercise-verifier.js';
import { GenerationService } from './application/generation.service.js';
import { GenerationController } from './http/generation.controller.js';

@Module({
  imports: [RoadmapModule],
  controllers: [GenerationController],
  providers: [GenerationService, CurriculumGeneratorService, ExerciseVerifier],
  exports: [GenerationService, CurriculumGeneratorService, ExerciseVerifier],
})
export class GenerationModule {}
