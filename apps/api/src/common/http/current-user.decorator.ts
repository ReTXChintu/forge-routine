import { type ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';

export interface AuthenticatedUser {
  userId: string;
  email: string;
}

/**
 * Reads the user the JwtAuthGuard attached. The guard runs first, so by the time a
 * controller sees this the value is present; the assertion documents that ordering.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const user = request.user;
    if (!user) {
      throw new Error('CurrentUser used on a route without JwtAuthGuard');
    }
    return user;
  },
);
