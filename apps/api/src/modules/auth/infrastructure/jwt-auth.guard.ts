import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { type JwtService } from '@nestjs/jwt';
import type { Request } from 'express';

import type { AppConfig } from '@forgeroutine/config';

import type { AuthenticatedUser } from '../../../common/http/current-user.decorator.js';
import { Problems } from '../../../common/http/problem-details.js';
import { APP_CONFIG } from '../../../infrastructure/config/config.module.js';
import type { AccessTokenClaims } from '../domain/token.js';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const header = request.headers.authorization;

    if (!header?.startsWith('Bearer ')) {
      throw Problems.unauthorized('Provide a Bearer access token.');
    }

    try {
      const claims = await this.jwt.verifyAsync<AccessTokenClaims>(header.slice(7), {
        secret: this.config.env.JWT_ACCESS_SECRET,
      });
      request.user = { userId: claims.sub, email: claims.email };
      return true;
    } catch {
      throw Problems.unauthorized('Your access token is invalid or has expired.');
    }
  }
}
