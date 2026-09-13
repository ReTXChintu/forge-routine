import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../../common/http/current-user.decorator.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { JwtAuthGuard } from '../../auth/infrastructure/jwt-auth.guard.js';
import {
  ChallengesService,
  type ChallengeSummary,
  type ChallengeView,
  type TerminalRunResult,
  type WrittenReviewResult,
} from '../application/challenges.service.js';

const runSchema = z.object({
  // Generous but bounded: a long session of exploration is normal, an
  // unbounded array is a way to make the server replay forever.
  commands: z.array(z.string().max(500)).max(200),
});

const submitTerminalSchema = z.object({
  attemptId: z.string().min(20).max(40),
  commands: z.array(z.string().max(500)).max(200),
});

const submitWrittenSchema = z.object({
  attemptId: z.string().min(20).max(40),
  // A real system design runs long. Cutting someone off mid-argument would
  // grade them on the truncation.
  text: z.string().min(1).max(30_000),
});

type RunInput = z.infer<typeof runSchema>;
type SubmitTerminalInput = z.infer<typeof submitTerminalSchema>;
type SubmitWrittenInput = z.infer<typeof submitWrittenSchema>;

@ApiTags('challenges')
@Controller('challenges')
@UseGuards(JwtAuthGuard)
export class ChallengesController {
  constructor(private readonly challenges: ChallengesService) {}

  @Get()
  @ApiOperation({ summary: 'System design, incident and terminal challenges' })
  list(@CurrentUser() user: AuthenticatedUser): Promise<ChallengeSummary[]> {
    return this.challenges.list(user.userId);
  }

  @Get(':exerciseId')
  @ApiOperation({ summary: 'One challenge. Never includes the answer.' })
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('exerciseId') exerciseId: string,
  ): Promise<ChallengeView> {
    return this.challenges.get(user.userId, exerciseId);
  }

  @Post(':exerciseId/start')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Open an attempt. Reuses one that is already open.' })
  start(
    @CurrentUser() user: AuthenticatedUser,
    @Param('exerciseId') exerciseId: string,
  ): Promise<ChallengeView> {
    return this.challenges.start(user.userId, exerciseId);
  }

  @Post(':exerciseId/terminal/run')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Replay commands without grading. Nothing is recorded.',
  })
  run(
    @Param('exerciseId') exerciseId: string,
    @Body(new ZodValidationPipe(runSchema)) body: RunInput,
  ): Promise<TerminalRunResult> {
    // No user scoping: a dry run reads nothing user-specific and records
    // nothing. The guard already established there is a signed-in user.
    return this.challenges.runTerminal(exerciseId, body.commands);
  }

  @Post('terminal/submit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Grade a terminal attempt and record the evidence' })
  submitTerminal(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(submitTerminalSchema)) body: SubmitTerminalInput,
  ): Promise<TerminalRunResult> {
    return this.challenges.submitTerminal(user.userId, body.attemptId, body.commands);
  }

  @Post('written/submit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Submit a design or incident write-up for review',
  })
  submitWritten(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(submitWrittenSchema)) body: SubmitWrittenInput,
  ): Promise<WrittenReviewResult> {
    return this.challenges.submitWritten(user.userId, body.attemptId, body.text);
  }
}
