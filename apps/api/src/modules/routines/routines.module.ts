import { Module } from '@nestjs/common';

import { RoadmapModule } from '../roadmap/roadmap.module.js';

import { RoutinesService } from './application/routines.service.js';
import { RoutinesController } from './http/routines.controller.js';

@Module({
  imports: [RoadmapModule],
  controllers: [RoutinesController],
  providers: [RoutinesService],
  exports: [RoutinesService],
})
export class RoutinesModule {}
