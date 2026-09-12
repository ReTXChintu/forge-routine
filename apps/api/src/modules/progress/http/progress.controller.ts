import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import type { DashboardOverview, IndependentCodingScore } from '@forgeroutine/shared-types';

import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../../common/http/current-user.decorator.js';
import { JwtAuthGuard } from '../../auth/infrastructure/jwt-auth.guard.js';
import { type ProgressService } from '../application/progress.service.js';

@ApiTags('progress')
@Controller('progress')
@UseGuards(JwtAuthGuard)
export class ProgressController {
  constructor(private readonly progress: ProgressService) {}

  @Get('overview')
  @ApiOperation({ summary: 'Everything the dashboard needs, in one call' })
  overview(@CurrentUser() user: AuthenticatedUser): Promise<DashboardOverview> {
    return this.progress.getOverview(user.userId);
  }

  @Get('independence')
  @ApiOperation({ summary: 'Independent Coding Score with its components and trend' })
  independence(
    @CurrentUser() user: AuthenticatedUser,
    @Query('windowDays') windowDays?: string,
  ): Promise<IndependentCodingScore> {
    return this.progress.getIndependence(user.userId, windowDays ? Number(windowDays) : 30);
  }
}
