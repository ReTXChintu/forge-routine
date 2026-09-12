import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import type { SubmissionResponse } from '@forgeroutine/shared-types';
import { submitCodeSchema, type SubmitCodeInput } from '@forgeroutine/validation';

import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../../common/http/current-user.decorator.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { JwtAuthGuard } from '../../auth/infrastructure/jwt-auth.guard.js';
import {
  SubmissionsQueryService,
  type SubmissionDetail,
} from '../application/submissions-query.service.js';
import { SubmitSolutionUseCase } from '../application/submit-solution.use-case.js';

@ApiTags('submissions')
@Controller('submissions')
@UseGuards(JwtAuthGuard)
export class SubmissionsController {
  constructor(
    private readonly submit: SubmitSolutionUseCase,
    private readonly submissions: SubmissionsQueryService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Execute a solution against its tests and evaluate it' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(submitCodeSchema)) body: SubmitCodeInput,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<SubmissionResponse> {
    return this.submit.execute(user.userId, body, idempotencyKey);
  }

  @Get(':id')
  @ApiOperation({ summary: 'A previous submission with its result and evaluation' })
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<SubmissionDetail> {
    return this.submissions.findOne(user.userId, id);
  }
}
