import { Module } from '@nestjs/common';

import { SkillsModule } from '../skills/skills.module.js';

import { ProjectsService } from './application/projects.service.js';
import { ProjectsController } from './http/projects.controller.js';

@Module({
  imports: [SkillsModule],
  controllers: [ProjectsController],
  providers: [ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
