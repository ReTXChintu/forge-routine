import { Worker } from 'bullmq';

import { loadConfig } from '@forgeroutine/config';
import { detectPermissionFlag, runInSandbox, type SandboxJob } from '@forgeroutine/sandbox';
import type { ExecutionResult } from '@forgeroutine/shared-types';

/**
 * Code execution worker (docs/deployment.md).
 *
 * Runs under PM2 in **fork** mode, not cluster: each worker spawns child
 * processes of its own, and a cluster master sharing a socket with them would
 * complicate the shutdown path for no benefit. Scale by adding instances.
 */

const EXECUTION_QUEUE_NAME = 'execution';

async function main(): Promise<void> {
  const config = loadConfig();
  const { env } = config;

  if (!env.REDIS_ENABLED) {
    console.error(
      'The sandbox worker requires Redis. Set REDIS_ENABLED=true, or use ' +
        'EXECUTION_DRIVER=inline and do not run this process.',
    );
    process.exit(1);
  }

  const permissionFlag = await detectPermissionFlag();
  if (permissionFlag === null) {
    console.warn(
      '[sandbox] Node permission model unavailable: filesystem isolation is OFF. ' +
        'Timeout, memory, output and environment isolation still apply. ' +
        'See docs/code-execution.md.',
    );
  }

  const worker = new Worker<SandboxJob, ExecutionResult>(
    EXECUTION_QUEUE_NAME,
    async (job) =>
      runInSandbox(job.data, {
        workDir: env.EXECUTION_WORK_DIR,
        timeoutMs: env.EXECUTION_TIMEOUT_MS,
        maxMemoryMb: env.EXECUTION_MAX_MEMORY_MB,
        maxOutputBytes: env.EXECUTION_MAX_OUTPUT_BYTES,
        permissionFlag,
      }),
    {
      connection: { url: env.REDIS_URL },
      prefix: env.REDIS_KEY_PREFIX,
      concurrency: env.EXECUTION_CONCURRENCY,
      // Generous margin over the sandbox's own timeout, which does the real
      // enforcement. This exists only to reclaim a genuinely stuck job.
      lockDuration: env.EXECUTION_TIMEOUT_MS + 30_000,
    },
  );

  worker.on('failed', (job, error) => {
    console.error(`[sandbox] job ${job?.id ?? 'unknown'} failed:`, error.message);
  });

  worker.on('error', (error) => {
    console.error('[sandbox] worker error:', error.message);
  });

  console.info(
    `[sandbox] worker ready · concurrency=${env.EXECUTION_CONCURRENCY} ` +
      `· timeout=${env.EXECUTION_TIMEOUT_MS}ms · memory=${env.EXECUTION_MAX_MEMORY_MB}MB`,
  );

  /**
   * Graceful shutdown. `worker.close()` stops claiming new jobs and waits for
   * in-flight ones; `runInSandbox` kills its own child process group on the way
   * out, so a PM2 reload cannot leave orphaned `node` processes behind.
   */
  const shutdown = async (signal: string): Promise<void> => {
    console.info(`[sandbox] ${signal} received, draining…`);
    await worker.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((error: unknown) => {
  console.error('[sandbox] failed to start:', error);
  process.exit(1);
});
