import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { completeOnboardingSchema, type CompleteOnboardingInput } from '@forgeroutine/validation';

import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../../common/http/current-user.decorator.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { JwtAuthGuard } from '../../auth/infrastructure/jwt-auth.guard.js';
import {
  OnboardingService,
  type OnboardingResult,
  type OnboardingStatus,
} from '../application/onboarding.service.js';

@ApiTags('onboarding')
@Controller('onboarding')
@UseGuards(JwtAuthGuard)
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get('status')
  @ApiOperation({ summary: 'Whether the first-run flow is done, and what is still generating' })
  status(@CurrentUser() user: AuthenticatedUser): Promise<OnboardingStatus> {
    return this.onboarding.status(user.userId);
  }

  @Post('complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Finish onboarding and build the first roadmap' })
  complete(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(completeOnboardingSchema)) body: CompleteOnboardingInput,
  ): Promise<OnboardingResult> {
    return this.onboarding.complete(user.userId, body);
  }
}
