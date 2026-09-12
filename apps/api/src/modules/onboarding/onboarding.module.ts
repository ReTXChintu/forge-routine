import { Module } from '@nestjs/common';

import { RoadmapModule } from '../roadmap/roadmap.module.js';
import { TechnologiesModule } from '../technologies/technologies.module.js';

import { OnboardingService } from './application/onboarding.service.js';
import { OnboardingController } from './http/onboarding.controller.js';

@Module({
  imports: [TechnologiesModule, RoadmapModule],
  controllers: [OnboardingController],
  providers: [OnboardingService],
})
export class OnboardingModule {}
