import { Module } from '@nestjs/common';

import { RoadmapService } from './application/roadmap.service.js';
import { RoadmapController } from './http/roadmap.controller.js';

@Module({
  controllers: [RoadmapController],
  providers: [RoadmapService],
  exports: [RoadmapService],
})
export class RoadmapModule {}
