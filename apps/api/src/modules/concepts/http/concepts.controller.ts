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

import type { RootCauseTrace } from '@forgeroutine/curriculum';
import type { Concept } from '@forgeroutine/shared-types';

import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../../common/http/current-user.decorator.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { JwtAuthGuard } from '../../auth/infrastructure/jwt-auth.guard.js';
import {
  ConceptTutorService,
  type ChatMessageView,
  type ExplainerView,
} from '../application/concept-tutor.service.js';
import { ConceptsService, type ConceptDetail } from '../application/concepts.service.js';
import {
  PracticeSetService,
  type McqAnswerResult,
  type PracticeView,
  type TheoryAnswerResult,
} from '../application/practice-set.service.js';

const askSchema = z.object({
  question: z.string().min(1).max(2_000),
  /**
   * What the user is looking at, as the client describes it. Capped well
   * below the model's window: a whole editor plus a question is context, a
   * whole file tree is a bill.
   */
  screen: z.string().max(8_000).optional(),
});
type AskInput = z.infer<typeof askSchema>;

const theoryAnswerSchema = z.object({ answer: z.string().min(1).max(4_000) });
type TheoryAnswerInput = z.infer<typeof theoryAnswerSchema>;

/** 0 missed it, 1 partly, 2 got it. Three rungs, because five is a shrug. */
const theoryRatingSchema = z.object({ selfRating: z.number().int().min(0).max(2) });
type TheoryRatingInput = z.infer<typeof theoryRatingSchema>;

const mcqAnswerSchema = z.object({ selectedIndex: z.number().int().min(0).max(4) });
type McqAnswerInput = z.infer<typeof mcqAnswerSchema>;

@ApiTags('concepts')
@Controller('concepts')
@UseGuards(JwtAuthGuard)
export class ConceptsController {
  constructor(
    private readonly concepts: ConceptsService,
    private readonly tutor: ConceptTutorService,
    private readonly practiceSet: PracticeSetService,
  ) {}

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

  @Get(':id/explainer')
  @ApiOperation({
    summary: 'The written explanation. Generated once per concept, shared by everyone.',
  })
  explainer(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<ExplainerView> {
    return this.tutor.explainer(user.userId, id);
  }

  @Get(':id/chat')
  @ApiOperation({ summary: "This user's conversation about the concept" })
  chat(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<ChatMessageView[]> {
    return this.tutor.history(user.userId, id);
  }

  @Post(':id/chat')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Ask a question. Returns the question and the answer.' })
  ask(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(askSchema)) body: AskInput,
  ): Promise<ChatMessageView[]> {
    return this.tutor.ask(user.userId, id, body.question, body.screen ?? null);
  }

  @Get(':id/practice')
  @ApiOperation({
    summary: 'The questions and exercises this user was handed, and what is left',
  })
  practice(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<PracticeView> {
    return this.practiceSet.view(user.userId, id);
  }

  @Post(':id/practice/questions')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Five more questions, from the shared pool or the model' })
  moreQuestions(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<PracticeView> {
    return this.practiceSet.moreQuestions(user.userId, id);
  }

  @Post(':id/practice/code')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'One more coding exercise, from the curriculum or the model' })
  moreCode(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<PracticeView> {
    return this.practiceSet.moreCode(user.userId, id);
  }

  @Post('questions/:questionId/choice')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Answer a multiple-choice question' })
  answerMcq(
    @CurrentUser() user: AuthenticatedUser,
    @Param('questionId') questionId: string,
    @Body(new ZodValidationPipe(mcqAnswerSchema)) body: McqAnswerInput,
  ): Promise<McqAnswerResult> {
    return this.practiceSet.answerMcq(user.userId, questionId, body.selectedIndex);
  }

  @Post('questions/:questionId/answer')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Submit a written answer. Returns the model answer, which is withheld until now.',
  })
  answerTheory(
    @CurrentUser() user: AuthenticatedUser,
    @Param('questionId') questionId: string,
    @Body(new ZodValidationPipe(theoryAnswerSchema)) body: TheoryAnswerInput,
  ): Promise<TheoryAnswerResult> {
    return this.practiceSet.answerTheory(user.userId, questionId, body.answer);
  }

  @Post('questions/:questionId/rating')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'How well their written answer matched. Reschedules the review.' })
  rateTheory(
    @CurrentUser() user: AuthenticatedUser,
    @Param('questionId') questionId: string,
    @Body(new ZodValidationPipe(theoryRatingSchema)) body: TheoryRatingInput,
  ) {
    return this.practiceSet.rateTheory(user.userId, questionId, body.selfRating);
  }

  @Get(':id/weakness-trace')
  @ApiOperation({ summary: 'Why the user is struggling: the concept, or a prerequisite' })
  trace(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<RootCauseTrace> {
    return this.concepts.traceWeakness(user.userId, id);
  }
}
