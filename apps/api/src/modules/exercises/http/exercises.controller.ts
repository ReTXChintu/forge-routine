import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import type { ExerciseView, StartAttemptResponse } from '@forgeroutine/shared-types';
import {
  saveDraftSchema,
  startAttemptSchema,
  type SaveDraftInput,
  type StartAttemptInput,
} from '@forgeroutine/validation';

import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../../common/http/current-user.decorator.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { JwtAuthGuard } from '../../auth/infrastructure/jwt-auth.guard.js';
import { ExercisesService } from '../application/exercises.service.js';

@ApiTags('exercises')
@Controller('exercises')
@UseGuards(JwtAuthGuard)
export class ExercisesController {
  constructor(private readonly exercises: ExercisesService) {}

  @Get()
  @ApiOperation({ summary: 'Exercises for a concept, at the user’s assistance level' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('conceptId') conceptId: string,
  ): Promise<ExerciseView[]> {
    return this.exercises.listForConcept(user.userId, conceptId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One exercise, projected to the user’s assistance level' })
  detail(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<ExerciseView> {
    return this.exercises.getView(user.userId, id);
  }

  @Post(':id/attempts')
  @ApiOperation({ summary: 'Open an attempt. Starts the time-to-first-code clock.' })
  start(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(startAttemptSchema)) body: StartAttemptInput,
  ): Promise<StartAttemptResponse> {
    return this.exercises.startAttempt(user.userId, id, body);
  }

  @Put('attempts/:attemptId/draft')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Autosave the editor’s contents for an attempt' })
  saveDraft(
    @CurrentUser() user: AuthenticatedUser,
    @Param('attemptId') attemptId: string,
    @Body(new ZodValidationPipe(saveDraftSchema)) body: SaveDraftInput,
  ): Promise<void> {
    return this.exercises.saveDraft(user.userId, attemptId, body.code);
  }

  @Post('attempts/:attemptId/first-code')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Record the first keystroke in the editor' })
  firstCode(
    @CurrentUser() user: AuthenticatedUser,
    @Param('attemptId') attemptId: string,
  ): Promise<void> {
    return this.exercises.markFirstCode(user.userId, attemptId);
  }
}
