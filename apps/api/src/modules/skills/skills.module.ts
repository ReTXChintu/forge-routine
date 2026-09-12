import { Module } from '@nestjs/common';

import { SkillsService } from './application/skills.service.js';
import { SkillsController } from './http/skills.controller.js';

@Module({
  controllers: [SkillsController],
  providers: [SkillsService],
  exports: [SkillsService],
})
export class SkillsModule {}
