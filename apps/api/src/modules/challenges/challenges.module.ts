import { Module } from '@nestjs/common';

import { SkillsModule } from '../skills/skills.module.js';

import { ChallengesService } from './application/challenges.service.js';
import { ChallengesController } from './http/challenges.controller.js';

@Module({
  imports: [SkillsModule],
  controllers: [ChallengesController],
  providers: [ChallengesService],
  exports: [ChallengesService],
})
export class ChallengesModule {}
