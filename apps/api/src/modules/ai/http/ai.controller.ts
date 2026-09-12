import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import type { HintResponse } from '@forgeroutine/shared-types';
import { hintRequestSchema, type HintRequestInput } from '@forgeroutine/validation';

import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../../common/http/current-user.decorator.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { JwtAuthGuard } from '../../auth/infrastructure/jwt-auth.guard.js';
import { AssistanceService } from '../application/assistance.service.js';

@ApiTags('ai')
@Controller('ai')
@UseGuards(JwtAuthGuard)
export class AiController {
  constructor(private readonly assistance: AssistanceService) {}

  @Post('hint')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request a rung of the assistance ladder' })
  hint(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(hintRequestSchema)) body: HintRequestInput,
  ): Promise<HintResponse> {
    return this.assistance.requestHint(user.userId, body);
  }
}
