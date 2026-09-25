import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';

import { updateRoutineItemSchema } from '@forgeroutine/validation';

import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../../common/http/current-user.decorator.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { JwtAuthGuard } from '../../auth/infrastructure/jwt-auth.guard.js';
import {
  RoutinesService,
  type NextUpView,
  type RoutineItemView,
  type RoutineView,
} from '../application/routines.service.js';

type UpdateItemInput = z.infer<typeof updateRoutineItemSchema>;

@ApiTags('routines')
@Controller('routines')
@UseGuards(JwtAuthGuard)
export class RoutinesController {
  constructor(private readonly routines: RoutinesService) {}

  @Get('today')
  @ApiOperation({ summary: "Today's routine, or null if it has not been generated" })
  today(@CurrentUser() user: AuthenticatedUser): Promise<RoutineView | null> {
    return this.routines.today(user.userId);
  }

  @Get('next')
  @ApiOperation({ summary: 'What to do after finishing a concept — today’s plan, then the course' })
  next(
    @CurrentUser() user: AuthenticatedUser,
    @Query('after') after: string,
  ): Promise<NextUpView | null> {
    return this.routines.nextAfter(user.userId, after);
  }

  @Post('generate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Build today's routine from the roadmap and due reviews" })
  generate(@CurrentUser() user: AuthenticatedUser): Promise<RoutineView> {
    return this.routines.generate(user.userId);
  }

  @Post('regenerate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Replace today. Discards progress already recorded.' })
  regenerate(@CurrentUser() user: AuthenticatedUser): Promise<RoutineView> {
    return this.routines.generate(user.userId, true);
  }

  @Patch('items/:id')
  @ApiOperation({ summary: 'Mark a routine item started, done or skipped' })
  updateItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateRoutineItemSchema)) body: UpdateItemInput,
  ): Promise<RoutineItemView> {
    return this.routines.setItemStatus(user.userId, id, body.status);
  }
}
