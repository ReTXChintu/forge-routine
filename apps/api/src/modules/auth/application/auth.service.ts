import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { AppConfig } from '@forgeroutine/config';
import type { AuthTokens } from '@forgeroutine/shared-types';
import type { LoginInput, RegisterInput } from '@forgeroutine/validation';
import bcrypt from 'bcryptjs';

import { Problems } from '../../../common/http/problem-details.js';
import { APP_CONFIG } from '../../../infrastructure/config/config.module.js';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';
import { classifyRefreshToken, parseDuration } from '../domain/token.js';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async register(input: RegisterInput): Promise<AuthTokens> {
    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (existing) throw Problems.emailTaken();

    const passwordHash = await bcrypt.hash(input.password, this.config.env.BCRYPT_ROUNDS);

    const user = await this.prisma.user.create({
      data: {
        email: input.email,
        passwordHash,
        displayName: input.displayName,
        // Preferences are created alongside the user so no code path has to handle
        // a user without them.
        preferences: { create: {} },
      },
    });

    return this.issueTokens(user.id, user.email, randomUUID());
  }

  async login(input: LoginInput): Promise<AuthTokens> {
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });

    // Hash against a dummy value when the user is unknown, so response time does
    // not reveal whether the email exists.
    const hash = user?.passwordHash ?? DUMMY_HASH;
    const matches = await bcrypt.compare(input.password, hash);

    if (!user || !matches || user.archivedAt !== null) {
      throw Problems.invalidCredentials();
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return this.issueTokens(user.id, user.email, randomUUID());
  }

  /**
   * Rotates a refresh token. Single-use with reuse detection: presenting a token
   * that has already been used revokes every token in its family.
   */
  async refresh(rawToken: string): Promise<AuthTokens> {
    const tokenHash = hashToken(rawToken);
    const record = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
    const outcome = classifyRefreshToken(record, new Date());

    if (outcome.kind === 'REUSE_DETECTED') {
      this.logger.warn(
        { familyId: outcome.familyId },
        'Refresh token reuse detected; revoking the family',
      );
      await this.prisma.refreshToken.updateMany({
        where: { familyId: outcome.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw Problems.unauthorized('Session revoked. Please sign in again.');
    }

    if (outcome.kind !== 'VALID') {
      throw Problems.unauthorized('Your session has expired. Please sign in again.');
    }

    const user = await this.prisma.user.findUnique({ where: { id: outcome.record.userId } });
    if (!user || user.archivedAt !== null) throw Problems.unauthorized();

    await this.prisma.refreshToken.update({
      where: { id: outcome.record.id },
      data: { usedAt: new Date() },
    });

    return this.issueTokens(user.id, user.email, outcome.record.familyId);
  }

  async logout(rawToken: string): Promise<void> {
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(rawToken) },
    });
    if (!record) return; // Already gone; logging out twice is not an error.

    await this.prisma.refreshToken.updateMany({
      where: { familyId: record.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async issueTokens(
    userId: string,
    email: string,
    familyId: string,
  ): Promise<AuthTokens> {
    const accessTtlMs = parseDuration(this.config.env.JWT_ACCESS_TTL);
    const refreshTtlMs = parseDuration(this.config.env.JWT_REFRESH_TTL);

    const accessToken = await this.jwt.signAsync(
      { sub: userId, email },
      {
        secret: this.config.env.JWT_ACCESS_SECRET,
        // The env value is validated as a duration string by @forgeroutine/config;
        // jsonwebtoken types it as a narrow template literal it cannot infer here.
        expiresIn: this.config.env.JWT_ACCESS_TTL as `${number}${'s' | 'm' | 'h' | 'd'}`,
      },
    );

    // An opaque random string, not a JWT: refresh tokens are looked up server-side
    // anyway, so there is nothing to gain from making them self-describing.
    const refreshToken = randomBytes(48).toString('base64url');

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: hashToken(refreshToken),
        familyId,
        expiresAt: new Date(Date.now() + refreshTtlMs),
      },
    });

    return {
      accessToken,
      refreshToken,
      expiresInSeconds: Math.floor(accessTtlMs / 1000),
    };
  }
}

/**
 * SHA-256 rather than bcrypt: these are 48 bytes of cryptographic randomness, not
 * user-chosen secrets, so there is nothing to brute-force and the lookup must be
 * a fast indexed equality check.
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** A real bcrypt hash of a value nothing can match, for constant-time login. */
const DUMMY_HASH = '$2a$12$C6UzMDM.H6dfI/f/IKcEe.4rHoeUSPHkJ1u5uTJMt8GKoKLxEQZKC';
