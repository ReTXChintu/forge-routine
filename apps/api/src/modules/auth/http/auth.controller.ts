import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import type { AuthTokens } from '@forgeroutine/shared-types';
import {
  loginSchema,
  refreshSchema,
  registerSchema,
  type LoginInput,
  type RefreshInput,
  type RegisterInput,
} from '@forgeroutine/validation';

import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../../common/http/current-user.decorator.js';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { type AuthService } from '../application/auth.service.js';
import { JwtAuthGuard } from '../infrastructure/jwt-auth.guard.js';

/**
 * Transport only. Validate, call one use-case, map the result (§45.3).
 * If a branch about business meaning appears here, it belongs in the service.
 */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @ApiOperation({ summary: 'Create an account' })
  register(@Body(new ZodValidationPipe(registerSchema)) body: RegisterInput): Promise<AuthTokens> {
    return this.auth.register(body);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign in' })
  login(@Body(new ZodValidationPipe(loginSchema)) body: LoginInput): Promise<AuthTokens> {
    return this.auth.login(body);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate a refresh token' })
  refresh(@Body(new ZodValidationPipe(refreshSchema)) body: RefreshInput): Promise<AuthTokens> {
    return this.auth.refresh(body.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke the current session family' })
  logout(@Body(new ZodValidationPipe(refreshSchema)) body: RefreshInput): Promise<void> {
    return this.auth.logout(body.refreshToken);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'The authenticated user' })
  me(@CurrentUser() user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }
}
