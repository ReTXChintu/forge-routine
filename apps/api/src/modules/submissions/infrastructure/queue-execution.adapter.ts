import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Queue, QueueEvents } from 'bullmq';

import type { AppConfig } from '@forgeroutine/config';
import type { ExecutionResult } from '@forgeroutine/shared-types';

import { APP_CONFIG } from '../../../infrastructure/config/config.module.js';
import type { CodeExecutionPort, ExecutionJob } from '../ports/code-execution.port.js';

export const EXECUTION_QUEUE_NAME = 'execution';

/**
 * Queue driver: the API pushes a job to Redis and `apps/sandbox` workers consume it.
 *
 * Required in production (enforced in `@forgeroutine/config`), because execution
 * load must not compete with request handling on the API's event loop, and workers
 * need to scale independently of HTTP capacity.
 */
@Injectable()
export class QueueExecutionAdapter implements CodeExecutionPort, OnModuleDestroy {
  private readonly logger = new Logger(QueueExecutionAdapter.name);
  private readonly queue: Queue;
  private readonly events: QueueEvents;
  private readonly waitTimeoutMs: number;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    const connection = { url: config.env.REDIS_URL };

    this.queue = new Queue(EXECUTION_QUEUE_NAME, {
      connection,
      prefix: config.env.REDIS_KEY_PREFIX,
      defaultJobOptions: {
        // Execution is not idempotent from the user's point of view and a retry
        // would double-charge their attempt; a failure is reported, not retried.
        attempts: 1,
        removeOnComplete: { age: 3_600, count: 1_000 },
        removeOnFail: { age: 86_400 },
      },
    });

    this.events = new QueueEvents(EXECUTION_QUEUE_NAME, {
      connection,
      prefix: config.env.REDIS_KEY_PREFIX,
    });

    // Generous headroom over the sandbox's own timeout: the difference covers
    // queue wait, and the sandbox kills the process long before this fires.
    this.waitTimeoutMs = config.env.EXECUTION_TIMEOUT_MS + 30_000;
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([
      this.queue.close().catch(() => undefined),
      this.events.close().catch(() => undefined),
    ]);
  }

  async run(job: ExecutionJob): Promise<ExecutionResult> {
    const queued = await this.queue.add('run', job);

    try {
      return (await queued.waitUntilFinished(this.events, this.waitTimeoutMs)) as ExecutionResult;
    } catch (error) {
      this.logger.error({ err: error, jobId: queued.id }, 'Queued execution failed');

      // A queue or worker fault is our problem, not the user's. INTERNAL_ERROR is
      // excluded from their skill record by the submission pipeline.
      return {
        status: 'INTERNAL_ERROR',
        passed: false,
        testsPassed: 0,
        testsTotal: job.testCases.length,
        cases: [],
        stdout: '',
        stderr: 'Execution service is unavailable. Your code was not run.',
        durationMs: 0,
        truncated: false,
      };
    }
  }
}
