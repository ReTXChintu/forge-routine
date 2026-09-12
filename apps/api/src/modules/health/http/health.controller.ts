import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { type PrismaService } from '../../../infrastructure/prisma/prisma.service.js';
import { type CacheService } from '../../../infrastructure/redis/cache.service.js';

/**
 * Liveness and readiness are genuinely different questions (docs/deployment.md):
 * PM2 restarts on liveness failure, nginx withholds traffic on readiness failure.
 * Conflating them turns a brief database blip into a restart loop.
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  @Get('live')
  @ApiOperation({ summary: 'Process is up. Never touches dependencies.' })
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Dependencies are reachable' })
  async ready(): Promise<{
    status: 'ok' | 'degraded';
    database: boolean;
    redis: boolean | 'disabled';
  }> {
    const [database, redis] = await Promise.all([
      this.prisma.isHealthy(),
      this.cache.isHealthy(),
    ]);

    return {
      status: database && redis ? 'ok' : 'degraded',
      database,
      redis: this.cache.enabled ? redis : 'disabled',
    };
  }
}
