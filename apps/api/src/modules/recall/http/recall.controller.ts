import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
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
  RecallService,
  type RecallAnswerResult,
  type RecallPromptView,
} from '../application/recall.service.js';

const answerSchema = z.object({
  questionId: z.string().min(20).max(40),
  selectedIndex: z.number().int().min(0).max(4),
});

type AnswerInput = z.infer<typeof answerSchema>;

@ApiTags('recall')
@Controller('recall')
@UseGuards(JwtAuthGuard)
export class RecallController {
  constructor(private readonly recall: RecallService) {}

  @Get('due')
  @ApiOperation({ summary: 'Recall prompts that are due, most overdue first' })
  due(
    @CurrentUser() user: AuthenticatedUser,
    @Query('limit') limit?: string,
    @Query('conceptId') conceptId?: string,
  ): Promise<RecallPromptView[]> {
    return this.recall.due(user.userId, limit ? Number(limit) : 3, conceptId);
  }

  @Post('answer')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Answer a prompt. Reschedules; never punishes.' })
  answer(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(answerSchema)) body: AnswerInput,
  ): Promise<RecallAnswerResult> {
    return this.recall.answer(user.userId, body.questionId, body.selectedIndex);
  }
}
