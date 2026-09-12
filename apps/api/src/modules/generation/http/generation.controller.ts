import { Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../../common/http/current-user.decorator.js';
import { JwtAuthGuard } from '../../auth/infrastructure/jwt-auth.guard.js';
import {
  GenerationService,
  type GenerationJobView,
  type GenerationStatusView,
} from '../application/generation.service.js';

@ApiTags('generation')
@Controller('generation')
@UseGuards(JwtAuthGuard)
export class GenerationController {
  constructor(private readonly generation: GenerationService) {}

  @Get('status')
  @ApiOperation({ summary: 'What is still generating, and how far along' })
  status(@CurrentUser() user: AuthenticatedUser): Promise<GenerationStatusView> {
    return this.generation.status(user.userId);
  }

  @Post('retry')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Queue generation for any technology still missing content' })
  retry(@CurrentUser() user: AuthenticatedUser): Promise<GenerationJobView[]> {
    return this.generation.enqueueMissing(user.userId);
  }
}
