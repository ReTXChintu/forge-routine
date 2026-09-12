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
  ProjectsService,
  type ProjectView,
  type StepSubmissionResult,
} from '../application/projects.service.js';

const submitStepSchema = z.object({
  attemptId: z.string().min(20).max(40),
  code: z.string().min(1).max(65_536),
});

type SubmitStepInput = z.infer<typeof submitStepSchema>;

@ApiTags('projects')
@Controller('projects')
@UseGuards(JwtAuthGuard)
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get(':exerciseId')
  @ApiOperation({ summary: 'A project and its steps, with later steps withheld' })
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('exerciseId') exerciseId: string,
  ): Promise<ProjectView> {
    return this.projects.get(user.userId, exerciseId);
  }

  @Post(':exerciseId/start')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Open or resume a project attempt' })
  start(
    @CurrentUser() user: AuthenticatedUser,
    @Param('exerciseId') exerciseId: string,
  ): Promise<ProjectView> {
    return this.projects.start(user.userId, exerciseId);
  }

  @Post('steps/submit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submit the current step for tests and tech-lead review' })
  submit(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(submitStepSchema)) body: SubmitStepInput,
  ): Promise<StepSubmissionResult> {
    return this.projects.submitStep(user.userId, body.attemptId, body.code);
  }
}
