import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

import type { AppConfig } from '@forgeroutine/config';

import { APP_CONFIG } from '../config/config.module.js';

/**
 * Cache and ephemeral state.
 *
 * Redis holds nothing that cannot be rebuilt from PostgreSQL (§29). That is a hard
 * requirement, which is what makes the no-op fallback legitimate: with
 * `REDIS_ENABLED=false` every method below degrades to "cache miss" and the
 * application stays correct, only slower.
 */
@Injectable()
export class CacheService implements OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private readonly client: Redis | null;
  private readonly prefix: string;

  /** In-memory fallback for rate limiting so the guard still works without Redis. */
  private readonly localCounters = new Map<string, { count: number; expiresAt: number }>();

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.prefix = config.env.REDIS_KEY_PREFIX;

    if (!config.env.REDIS_ENABLED) {
      this.client = null;
      this.logger.warn('Redis disabled: caching is a no-op and rate limiting is per-process');
      return;
    }

    this.client = new Redis(config.env.REDIS_URL, {
      keyPrefix: this.prefix,
      maxRetriesPerRequest: 2,
      lazyConnect: false,
      // Without this a Redis outage turns every cache read into a slow failure
      // instead of a fast miss.
      enableOfflineQueue: false,
    });

    this.client.on('error', (error) => {
      this.logger.error({ err: error }, 'Redis error');
    });
  }

  get enabled(): boolean {
    return this.client !== null;
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.quit().catch(() => undefined);
  }

  async isHealthy(): Promise<boolean> {
    if (!this.client) return true; // Disabled is a valid, healthy configuration.
    try {
      return (await this.client.ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  async get<T>(key: string): Promise<T | null> {
    if (!this.client) return null;
    try {
      const raw = await this.client.get(key);
      return raw === null ? null : (JSON.parse(raw) as T);
    } catch (error) {
      // A cache failure must never fail the request it was meant to speed up.
      this.logger.warn({ err: error, key }, 'Cache read failed; treating as a miss');
      return null;
    }
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (error) {
      this.logger.warn({ err: error, key }, 'Cache write failed');
    }
  }

  async del(key: string): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.del(key);
    } catch (error) {
      this.logger.warn({ err: error, key }, 'Cache delete failed');
    }
  }

  /**
   * Fixed-window counter used by the rate-limit guard.
   * Returns the count *after* this increment.
   */
  async increment(key: string, windowSeconds: number): Promise<number> {
    if (!this.client) return this.incrementLocal(key, windowSeconds);

    try {
      const [[, count]] = (await this.client
        .multi()
        .incr(key)
        .expire(key, windowSeconds, 'NX')
        .exec()) as [[Error | null, number], [Error | null, number]];
      return count;
    } catch (error) {
      this.logger.warn({ err: error, key }, 'Rate-limit counter failed; using local counter');
      return this.incrementLocal(key, windowSeconds);
    }
  }

  private incrementLocal(key: string, windowSeconds: number): number {
    const now = Date.now();
    const existing = this.localCounters.get(key);

    if (!existing || existing.expiresAt <= now) {
      this.localCounters.set(key, { count: 1, expiresAt: now + windowSeconds * 1000 });
      this.pruneLocal(now);
      return 1;
    }

    existing.count += 1;
    return existing.count;
  }

  /** Without this the local map is an unbounded memory leak in a long-lived process. */
  private pruneLocal(now: number): void {
    if (this.localCounters.size < 10_000) return;
    for (const [key, entry] of this.localCounters) {
      if (entry.expiresAt <= now) this.localCounters.delete(key);
    }
  }
}
