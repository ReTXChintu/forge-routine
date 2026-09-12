import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';

import type { LearningSession } from '@forgeroutine/shared-types';
import { startSessionSchema } from '@forgeroutine/validation';

import { CurrentUser, type AuthenticatedUser } from '../../../common/http/current-user.decorator.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { JwtAuthGuard } from '../../auth/infrastructure/jwt-auth.guard.js';
import { type SessionsService } from '../application/sessions.service.js';

type StartSessionInput = z.infer<typeof startSessionSchema>;

@ApiTags('sessions')
@Controller('sessions')
@UseGuards(JwtAuthGuard)
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  @Post()
  @ApiOperation({ summary: 'Start a learning session' })
  start(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(startSessionSchema)) body: StartSessionInput,
  ): Promise<LearningSession> {
    return this.sessions.start(user.userId, body);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One session' })
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<LearningSession> {
    return this.sessions.get(user.userId, id);
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'End a session and record its duration' })
  complete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<LearningSession> {
    return this.sessions.complete(user.userId, id);
  }
}
