import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@forgeroutine/database';

/**
 * The Prisma client as a Nest provider.
 *
 * Connects eagerly at boot rather than lazily on first query: a bad DATABASE_URL
 * should fail the deploy, not the first user's first request.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({ log: ['warn', 'error'] });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Connected to PostgreSQL');
  }

  async onModuleDestroy(): Promise<void> {
    // Part of graceful shutdown: drain in-flight queries before the process exits
    // so a PM2 reload cannot sever a transaction mid-write.
    await this.$disconnect();
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
