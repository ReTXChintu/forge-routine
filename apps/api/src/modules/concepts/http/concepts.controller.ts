import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import type { RootCauseTrace } from '@forgeroutine/curriculum';
import type { Concept } from '@forgeroutine/shared-types';

import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../../common/http/current-user.decorator.js';
import { JwtAuthGuard } from '../../auth/infrastructure/jwt-auth.guard.js';
import { type ConceptsService, type ConceptDetail } from '../application/concepts.service.js';

@ApiTags('concepts')
@Controller('concepts')
@UseGuards(JwtAuthGuard)
export class ConceptsController {
  constructor(private readonly concepts: ConceptsService) {}

  @Get()
  @ApiOperation({ summary: 'Concepts for a technology, in learning order' })
  list(@Query('technologyId') technologyId: string): Promise<Concept[]> {
    return this.concepts.listForTechnology(technologyId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Concept detail with prerequisites, readiness and skill' })
  detail(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<ConceptDetail> {
    return this.concepts.getDetail(user.userId, id);
  }

  @Get(':id/weakness-trace')
  @ApiOperation({ summary: 'Why the user is struggling: the concept, or a prerequisite' })
  trace(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<RootCauseTrace> {
    return this.concepts.traceWeakness(user.userId, id);
  }
}
