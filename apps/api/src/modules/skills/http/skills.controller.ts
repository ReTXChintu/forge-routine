import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import type { WeakSkill } from '@forgeroutine/shared-types';

import { CurrentUser, type AuthenticatedUser } from '../../../common/http/current-user.decorator.js';
import { JwtAuthGuard } from '../../auth/infrastructure/jwt-auth.guard.js';
import { type SkillsService } from '../application/skills.service.js';

@ApiTags('skills')
@Controller('skills')
@UseGuards(JwtAuthGuard)
export class SkillsController {
  constructor(private readonly skills: SkillsService) {}

  @Get('weakest')
  @ApiOperation({ summary: 'Weakest skills, ranked by implementation ability' })
  weakest(
    @CurrentUser() user: AuthenticatedUser,
    @Query('limit') limit?: string,
  ): Promise<WeakSkill[]> {
    return this.skills.getWeakest(user.userId, limit ? Number(limit) : 5);
  }
}
