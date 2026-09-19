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

const askSchema = z.object({ question: z.string().min(1).max(2_000) });
type AskInput = z.infer<typeof askSchema>;

@ApiTags('concepts')
@Controller('concepts')
@UseGuards(JwtAuthGuard)
export class ConceptsController {
  constructor(
    private readonly concepts: ConceptsService,
    private readonly tutor: ConceptTutorService,
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
    return this.tutor.ask(user.userId, id, body.question);
  }

  @Get(':id/weakness-trace')
  @ApiOperation({ summary: 'Why the user is struggling: the concept, or a prerequisite' })
  trace(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<RootCauseTrace> {
    return this.concepts.traceWeakness(user.userId, id);
  }
}
