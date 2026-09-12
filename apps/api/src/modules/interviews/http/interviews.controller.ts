import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
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
  InterviewGuideService,
  type InterviewGuideView,
} from '../application/interview-guide.service.js';
import {
  InterviewsService,
  type InterviewReportView,
  type InterviewView,
} from '../application/interviews.service.js';

const startSchema = z.object({
  mode: z.enum(['QUICK', 'TECHNICAL', 'CODING', 'DEBUGGING', 'SYSTEM_DESIGN', 'SENIOR']),
  targetLevel: z.enum(['JUNIOR', 'MID', 'SENIOR']).default('MID'),
});

const answerSchema = z.object({
  questionId: z.string().min(20).max(40),
  // Generous: a good system-design answer is long, and truncating someone
  // mid-thought would grade them on the cut-off rather than the answer.
  text: z.string().min(1).max(8_000),
});

type StartInput = z.infer<typeof startSchema>;
type AnswerInput = z.infer<typeof answerSchema>;

@ApiTags('interviews')
@Controller('interviews')
@UseGuards(JwtAuthGuard)
export class InterviewsController {
  constructor(
    private readonly interviews: InterviewsService,
    private readonly guide: InterviewGuideService,
  ) {}

  @Get('guide')
  @ApiOperation({ summary: 'Readiness dossier: where you would be caught out' })
  getGuide(@CurrentUser() user: AuthenticatedUser): Promise<InterviewGuideView> {
    return this.guide.build(user.userId);
  }

  @Get()
  @ApiOperation({ summary: 'Past interviews, newest first' })
  history(@CurrentUser() user: AuthenticatedUser, @Query('limit') limit?: string) {
    return this.interviews.history(user.userId, limit ? Number(limit) : 10);
  }

  @Post()
  @ApiOperation({ summary: 'Start an interview. Returns the first question.' })
  start(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(startSchema)) body: StartInput,
  ): Promise<InterviewView> {
    return this.interviews.start(user.userId, body.mode, body.targetLevel);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Transcript and the question awaiting an answer' })
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<InterviewView> {
    return this.interviews.get(user.userId, id);
  }

  @Post(':id/answer')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Answer the current question. The grade is withheld until the end.',
  })
  answer(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') _id: string,
    @Body(new ZodValidationPipe(answerSchema)) body: AnswerInput,
  ): Promise<InterviewView> {
    return this.interviews.answer(user.userId, body.questionId, body.text);
  }

  @Post(':id/end')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'End early. The report covers only what was asked.' })
  end(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<InterviewReportView> {
    return this.interviews.end(user.userId, id);
  }

  @Get(':id/report')
  @ApiOperation({ summary: 'The debrief for a finished interview' })
  report(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<InterviewReportView> {
    return this.interviews.report(user.userId, id);
  }
}
