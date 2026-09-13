import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';

import type { AppConfig } from '@forgeroutine/config';
import { type PermissionFlag, detectPermissionFlag, runInSandbox } from '@forgeroutine/sandbox';
import type { ExecutionResult } from '@forgeroutine/shared-types';

import { APP_CONFIG } from '../../../infrastructure/config/config.module.js';
import type { CodeExecutionPort, ExecutionJob } from '../ports/code-execution.port.js';

/**
 * Inline driver: the API spawns the sandbox child process itself.
 *
 * Still fully out-of-process (§45.8) — "inline" describes who enqueues the
 * work, not where it runs. The API awaits a child process, which is ordinary
 * async I/O and does not block the event loop.
 *
 * What inline genuinely lacks is **backpressure**. The queue driver has
 * `EXECUTION_CONCURRENCY` workers and everything else waits; inline had
 * nothing, so N simultaneous submissions meant N child processes, each
 * allowed `EXECUTION_MAX_MEMORY_MB`. Ten users submitting at once could ask
 * the box for more memory than it has, and the failure mode is the whole
 * machine rather than one slow request.
 *
 * So the same limit applies here. Beyond it, submissions queue — which is
 * what a user expects from "running your code" and is very much better than
 * an OOM killer choosing which process dies.
 */
@Injectable()
export class InlineExecutionAdapter implements CodeExecutionPort, OnModuleInit {
  private readonly logger = new Logger(InlineExecutionAdapter.name);
  private permissionFlag: PermissionFlag | null = null;

  /** Runs in flight. Never exceeds `EXECUTION_CONCURRENCY`. */
  private active = 0;

  /** Waiters, oldest first. Resolved as slots free up. */
  private readonly waiting: (() => void)[] = [];

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async onModuleInit(): Promise<void> {
    // Probed once at boot: the flag is experimental and aborts hard on Windows,
    // so discovering this per-submission would mean a failure on every run.
    this.permissionFlag = await detectPermissionFlag();

    if (this.permissionFlag === null) {
      this.logger.warn(
        'Node permission model unavailable: sandbox filesystem isolation is OFF. ' +
          'Timeout, memory, output and environment isolation still apply. ' +
          'See docs/code-execution.md.',
      );
    } else {
      this.logger.log(`Sandbox filesystem isolation enabled via ${this.permissionFlag}`);
    }
  }

  async run(job: ExecutionJob): Promise<ExecutionResult> {
    const { env } = this.config;

    await this.acquire();

    try {
      return await runInSandbox(
        { code: job.code, language: job.language, testCases: job.testCases },
        {
          workDir: env.EXECUTION_WORK_DIR,
          timeoutMs: env.EXECUTION_TIMEOUT_MS,
          maxMemoryMb: env.EXECUTION_MAX_MEMORY_MB,
          maxOutputBytes: env.EXECUTION_MAX_OUTPUT_BYTES,
          permissionFlag: this.permissionFlag,
        },
      );
    } finally {
      // In `finally`, so a run that throws still frees its slot. Without
      // this a handful of failures would permanently exhaust the pool and
      // every later submission would hang with nothing in the logs.
      this.release();
    }
  }

  private async acquire(): Promise<void> {
    const limit = this.config.env.EXECUTION_CONCURRENCY;

    if (this.active < limit) {
      this.active += 1;
      return;
    }

    // No timeout here on purpose. A run is bounded by EXECUTION_TIMEOUT_MS,
    // so the queue always drains; rejecting instead would turn a two-second
    // wait into a failed submission the user has to retype.
    this.logger.log(`Execution queued: ${this.active} running, ${this.waiting.length + 1} waiting`);

    await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active += 1;
  }

  private release(): void {
    this.active -= 1;
    this.waiting.shift()?.();
  }
}
