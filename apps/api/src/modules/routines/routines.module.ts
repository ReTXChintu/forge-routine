import { Module } from '@nestjs/common';

import { GenerationModule } from '../generation/generation.module.js';
import { RoadmapModule } from '../roadmap/roadmap.module.js';

import { RoutinesService } from './application/routines.service.js';
import { RoutinesController } from './http/routines.controller.js';

@Module({
  imports: [RoadmapModule, GenerationModule],
  controllers: [RoutinesController],
  providers: [RoutinesService],
  exports: [RoutinesService],
})
export class RoutinesModule {}
