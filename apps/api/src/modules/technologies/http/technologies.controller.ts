import {
  Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import type { Technology, UserTechnology } from '@forgeroutine/shared-types';
import {
  addTechnologySchema, updateUserTechnologySchema,
  type AddTechnologyInput, type UpdateUserTechnologyInput,
} from '@forgeroutine/validation';

import { CurrentUser, type AuthenticatedUser } from '../../../common/http/current-user.decorator.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { JwtAuthGuard } from '../../auth/infrastructure/jwt-auth.guard.js';
import { type TechnologiesService } from '../application/technologies.service.js';

@ApiTags('technologies')
@Controller('technologies')
@UseGuards(JwtAuthGuard)
export class TechnologiesController {
  constructor(private readonly technologies: TechnologiesService) {}

  @Get()
  @ApiOperation({ summary: 'Browse the technology catalogue' })
  catalogue(@Query('search') search?: string): Promise<Technology[]> {
    return this.technologies.listCatalogue(search);
  }

  @Get('mine')
  @ApiOperation({ summary: "The user's learning universe" })
  mine(
    @CurrentUser() user: AuthenticatedUser,
    @Query('includeArchived') includeArchived?: string,
  ): Promise<UserTechnology[]> {
    return this.technologies.listMine(user.userId, includeArchived === 'true');
  }

  @Post('mine')
  @ApiOperation({ summary: 'Add a technology, creating it if it is new' })
  add(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(addTechnologySchema)) body: AddTechnologyInput,
  ): Promise<UserTechnology> {
    return this.technologies.add(user.userId, body);
  }

  @Patch('mine/:id')
  @ApiOperation({ summary: 'Update priority, target, frequency or importance' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateUserTechnologySchema)) body: UpdateUserTechnologyInput,
  ): Promise<UserTechnology> {
    return this.technologies.update(user.userId, id, body);
  }

  @Post('mine/:id/pause')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Pause a technology and freeze its review schedule' })
  pause(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<UserTechnology> {
    return this.technologies.pause(user.userId, id);
  }

  @Post('mine/:id/resume')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resume a paused technology' })
  resume(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<UserTechnology> {
    return this.technologies.resume(user.userId, id);
  }

  @Delete('mine/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Archive a technology. History is retained.' })
  archive(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    return this.technologies.archive(user.userId, id);
  }
}
