import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { updateRoadmapItemSchema, type UpdateRoadmapItemInput } from '@forgeroutine/validation';

import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../../common/http/current-user.decorator.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { JwtAuthGuard } from '../../auth/infrastructure/jwt-auth.guard.js';
import {
  RoadmapService,
  type RoadmapItemView,
  type RoadmapView,
} from '../application/roadmap.service.js';

@ApiTags('roadmap')
@Controller('roadmap')
@UseGuards(JwtAuthGuard)
export class RoadmapController {
  constructor(private readonly roadmap: RoadmapService) {}

  @Get()
  @ApiOperation({ summary: 'The active roadmap, or null before onboarding' })
  get(@CurrentUser() user: AuthenticatedUser): Promise<RoadmapView | null> {
    return this.roadmap.getActive(user.userId);
  }

  @Post('regenerate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Replan. Completed work is carried over by concept id.' })
  regenerate(@CurrentUser() user: AuthenticatedUser): Promise<RoadmapView> {
    return this.roadmap.regenerate(user.userId);
  }

  @Patch('items/:id')
  @ApiOperation({ summary: 'Mark a roadmap item started, done or skipped' })
  updateItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateRoadmapItemSchema)) body: UpdateRoadmapItemInput,
  ): Promise<RoadmapItemView> {
    return this.roadmap.setItemStatus(user.userId, id, body.status);
  }
}
