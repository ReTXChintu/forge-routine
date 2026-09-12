import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { AppConfig } from '@forgeroutine/config';
import { probePermissionModel, runInSandbox } from '@forgeroutine/sandbox';
import type { ExecutionResult } from '@forgeroutine/shared-types';

import { APP_CONFIG } from '../../../infrastructure/config/config.module.js';
import type { CodeExecutionPort, ExecutionJob } from '../ports/code-execution.port.js';

/**
 * Inline driver: the API spawns the sandbox child process itself.
 *
 * Still fully out-of-process (§45.8) — "inline" describes who enqueues the work,
 * not where it runs. Correct for development and single-node deployments; config
 * forbids it in production so execution load cannot starve the API event loop.
 */
@Injectable()
export class InlineExecutionAdapter implements CodeExecutionPort, OnModuleInit {
  private readonly logger = new Logger(InlineExecutionAdapter.name);
  private usePermissionModel = false;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async onModuleInit(): Promise<void> {
    // Probed once at boot: the flag is experimental and aborts hard on Windows,
    // so discovering this per-submission would mean a failure on every run.
    this.usePermissionModel = await probePermissionModel();

    if (!this.usePermissionModel) {
      this.logger.warn(
        'Node permission model unavailable: sandbox filesystem isolation is OFF. ' +
          'Timeout, memory, output and environment isolation still apply. ' +
          'See docs/code-execution.md.',
      );
    }
  }

  async run(job: ExecutionJob): Promise<ExecutionResult> {
    const { env } = this.config;

    return runInSandbox(
      { code: job.code, language: job.language, testCases: job.testCases },
      {
        workDir: env.EXECUTION_WORK_DIR,
        timeoutMs: env.EXECUTION_TIMEOUT_MS,
        maxMemoryMb: env.EXECUTION_MAX_MEMORY_MB,
        maxOutputBytes: env.EXECUTION_MAX_OUTPUT_BYTES,
        usePermissionModel: this.usePermissionModel,
      },
    );
  }
}
