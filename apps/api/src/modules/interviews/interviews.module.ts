import { Module } from '@nestjs/common';

import { SkillsModule } from '../skills/skills.module.js';

import { InterviewGuideService } from './application/interview-guide.service.js';
import { InterviewsService } from './application/interviews.service.js';
import { InterviewsController } from './http/interviews.controller.js';

@Module({
  imports: [SkillsModule],
  controllers: [InterviewsController],
  providers: [InterviewsService, InterviewGuideService],
  exports: [InterviewsService, InterviewGuideService],
})
export class InterviewsModule {}
