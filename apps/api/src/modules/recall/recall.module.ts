import { Module } from '@nestjs/common';

import { SkillsModule } from '../skills/skills.module.js';

import { RecallService } from './application/recall.service.js';
import { RecallController } from './http/recall.controller.js';

@Module({
  imports: [SkillsModule],
  controllers: [RecallController],
  providers: [RecallService],
  exports: [RecallService],
})
export class RecallModule {}
