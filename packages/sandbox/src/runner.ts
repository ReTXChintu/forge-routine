import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { transformSync } from 'esbuild';

import type { ExecutionResult, ExecutionStatus, TestCaseResult } from '@forgeroutine/shared-types';

import { HARNESS_SOURCE, buildTestsModule } from './harness.template.js';

/**
 * The sandbox runner (docs/code-execution.md).
 *
 * User code is hostile input. It runs in a short-lived child process, always,
 * including in development — there is no in-process path, because that shortcut
 * would inevitably reach production (§45.8).
 *
 * Read docs/code-execution.md for the honest statement of what this does and does
 * not defend against. In short: it stops accidental damage and casual escapes, and
 * it is not a security boundary against a determined attacker. The port above it
 * exists so a container/microVM backend can replace this without the learning
 * domain noticing.
 */

export interface SandboxTestCase {
  name: string;
  hidden: boolean;
  code: string;
}

export interface SandboxJob {
  code: string;
  language: 'javascript' | 'typescript';
  testCases: readonly SandboxTestCase[];
}

export interface SandboxOptions {
  workDir: string;
  timeoutMs: number;
  maxMemoryMb: number;
  maxOutputBytes: number;
  /**
   * Which permission-model flag this Node accepts, or null when it supports
   * none. Resolve it once with `detectPermissionFlag`; see the note there for
   * why this is not a boolean.
   */
  permissionFlag?: PermissionFlag | null;
  nodeExecutable?: string;
}

interface HarnessPayload {
  outcome: 'COMPLETED' | 'COMPILE_ERROR' | 'HARNESS_ERROR';
  message?: string;
  cases: {
    name: string;
    hidden: boolean;
    passed: boolean;
    durationMs: number;
    error?: string;
    expected?: string;
    received?: string;
  }[];
  stdout: string;
  consoleCalls: number;
  outputTruncated: boolean;
}

export async function runInSandbox(
  job: SandboxJob,
  options: SandboxOptions,
): Promise<ExecutionResult> {
  const runId = randomUUID();
  const runDir = resolve(options.workDir, runId);
  const startedAt = Date.now();

  try {
    await mkdir(runDir, { recursive: true });

    // Strip types before writing. Node cannot parse TypeScript, so a valid TS
    // submission would otherwise die with "Unexpected token ':'" — which is
    // both wrong and unactionable, since the user's code was correct.
    //
    // Everything goes through the transform, TypeScript or not: TS is a
    // superset, so JavaScript passes through unchanged, and routing both
    // through one path means a syntax error is reported the same way for both.
    let source: string;
    try {
      source = stripTypes(job.code);
    } catch (error) {
      return failure('COMPILE_ERROR', job, Date.now() - startedAt, {
        stderr: error instanceof Error ? error.message : String(error),
      });
    }

    await Promise.all([
      writeFile(join(runDir, 'solution.mjs'), source, 'utf8'),
      writeFile(join(runDir, 'tests.mjs'), buildTestsModule(job.testCases), 'utf8'),
      writeFile(join(runDir, 'harness.mjs'), HARNESS_SOURCE, 'utf8'),
    ]);

    const child = await spawnHarness(runDir, options);

    if (child.timedOut) {
      return failure('TIMEOUT', job, Date.now() - startedAt, {
        stderr: `Execution exceeded ${options.timeoutMs}ms and was terminated.`,
      });
    }

    const payload = await readResult(runDir);

    if (!payload) {
      // No result file means the process died before the harness could write one:
      // an OOM kill, a hard crash, or a process-level abort.
      const memoryKilled = /heap out of memory|Allocation failed/i.test(child.stderr);
      return failure(
        memoryKilled ? 'MEMORY_EXCEEDED' : 'RUNTIME_ERROR',
        job,
        Date.now() - startedAt,
        { stderr: truncate(child.stderr, options.maxOutputBytes) },
      );
    }

    return toExecutionResult(payload, job, Date.now() - startedAt, options);
  } catch (error) {
    return failure('INTERNAL_ERROR', job, Date.now() - startedAt, {
      stderr: error instanceof Error ? error.message : String(error),
    });
  } finally {
    // Best effort: a leftover run directory is untidy, not dangerous.
    await rm(runDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

interface SpawnOutcome {
  timedOut: boolean;
  stderr: string;
  exitCode: number | null;
}

function spawnHarness(runDir: string, options: SandboxOptions): Promise<SpawnOutcome> {
  const args: string[] = [`--max-old-space-size=${options.maxMemoryMb}`];

  if (options.permissionFlag) {
    args.push(
      options.permissionFlag,
      `--allow-fs-read=${runDir}`,
      `--allow-fs-read=${join(runDir, '*')}`,
      `--allow-fs-write=${join(runDir, 'result.json')}`,
    );
  }

  args.push(join(runDir, 'harness.mjs'));

  return new Promise<SpawnOutcome>((resolvePromise) => {
    const child = spawn(options.nodeExecutable ?? process.execPath, args, {
      cwd: runDir,
      // An explicit minimal environment: no DATABASE_URL, no OPENAI_API_KEY,
      // nothing the user's code could exfiltrate.
      env: {
        NODE_ENV: 'sandbox',
        FORGE_MAX_OUTPUT: String(options.maxOutputBytes),
        PATH: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      // A detached process group lets us kill descendants too, not just the child.
      detached: process.platform !== 'win32',
      windowsHide: true,
    });

    let stderr = '';
    let settled = false;
    let timedOut = false;

    const cap = options.maxOutputBytes;
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < cap) stderr += chunk.toString('utf8');
    });
    // stdout is drained but ignored: the protocol channel is result.json.
    child.stdout.on('data', () => undefined);

    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid);
    }, options.timeoutMs);

    const settle = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({ timedOut, stderr, exitCode });
    };

    child.on('error', (error) => {
      stderr += `\n${error.message}`;
      settle(null);
    });
    child.on('close', settle);
  });
}

function killTree(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    if (process.platform === 'win32') {
      // No process groups on Windows; kill the single process. Documented in
      // docs/development.md as a known platform difference.
      process.kill(pid, 'SIGKILL');
    } else {
      process.kill(-pid, 'SIGKILL');
    }
  } catch {
    // Already gone.
  }
}

async function readResult(runDir: string): Promise<HarnessPayload | null> {
  try {
    const raw = await readFile(join(runDir, 'result.json'), 'utf8');
    return JSON.parse(raw) as HarnessPayload;
  } catch {
    return null;
  }
}

function toExecutionResult(
  payload: HarnessPayload,
  job: SandboxJob,
  durationMs: number,
  options: SandboxOptions,
): ExecutionResult {
  if (payload.outcome === 'COMPILE_ERROR') {
    return failure('COMPILE_ERROR', job, durationMs, {
      stderr: payload.message ?? 'Your code could not be loaded.',
      stdout: payload.stdout,
    });
  }

  if (payload.outcome === 'HARNESS_ERROR') {
    // Our fault, not the user's. Never counted against their skill record.
    return failure('HARNESS_ERROR', job, durationMs, {
      stderr: payload.message ?? 'The test harness failed.',
      stdout: payload.stdout,
    });
  }

  const cases: TestCaseResult[] = payload.cases.map((c) => ({
    name: c.name,
    passed: c.passed,
    durationMs: c.durationMs,
    ...(c.expected !== undefined ? { expected: c.expected } : {}),
    ...(c.received !== undefined ? { received: c.received } : {}),
    ...(c.error !== undefined ? { error: c.error } : {}),
  }));

  const testsPassed = cases.filter((c) => c.passed).length;
  const passed = cases.length > 0 && testsPassed === cases.length;

  return {
    status: payload.outputTruncated ? 'OUTPUT_EXCEEDED' : passed ? 'PASSED' : 'FAILED',
    passed,
    testsPassed,
    testsTotal: cases.length,
    cases,
    stdout: truncate(payload.stdout, options.maxOutputBytes),
    stderr: '',
    durationMs,
    truncated: payload.outputTruncated,
  };
}

function failure(
  status: ExecutionStatus,
  job: SandboxJob,
  durationMs: number,
  extra: { stderr?: string; stdout?: string } = {},
): ExecutionResult {
  return {
    status,
    passed: false,
    testsPassed: 0,
    testsTotal: job.testCases.length,
    cases: [],
    stdout: extra.stdout ?? '',
    stderr: extra.stderr ?? '',
    durationMs,
    truncated: false,
  };
}

/**
 * TypeScript to JavaScript, types removed, nothing else changed.
 *
 * esbuild is a transform only: it does no type *checking*, which is the right
 * trade here. A type error should surface as a failing test or a clear runtime
 * error, not as a parser failure the user cannot act on.
 */
function stripTypes(code: string): string {
  const result = transformSync(code, {
    loader: 'ts',
    format: 'esm',
    target: 'es2022',
    // Decorators and similar TS-only syntax are not supported; a submission
    // using them fails here with a real message rather than a cryptic one.
    sourcemap: false,
  });

  return result.code;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}\n…output truncated` : value;
}

/**
 * Which command-line flag enables Node's permission model.
 *
 * Node renamed this when the feature stabilised: `--experimental-permission`
 * through Node 22, `--permission` from 23.5 onwards, with the old spelling
 * removed. Probing only one name means the sandbox silently loses filesystem
 * isolation on half the versions people actually run — which is why this
 * returns the flag rather than a boolean.
 */
export type PermissionFlag = '--permission' | '--experimental-permission';

/** Newest spelling first, so a modern runtime is not handed the deprecated one. */
const PERMISSION_FLAGS: readonly PermissionFlag[] = ['--permission', '--experimental-permission'];

/**
 * One-time probe for Node permission-model support.
 *
 * The probe uses exactly the flag shapes `spawnHarness` uses, against a real
 * temporary directory, because a cheaper check is actively misleading: on
 * Windows, Node aborts with a native assertion (`!path_prefix.empty()`) when
 * given a drive-letter path, yet accepts `--allow-fs-read=*` happily. A probe
 * using the wildcard reports support that does not work for real paths.
 *
 * Resolved once at startup so the operator gets one clear warning instead of a
 * failure on every submission.
 *
 * @returns the flag to use, or null when no permission model is available.
 */
export async function detectPermissionFlag(
  nodeExecutable = process.execPath,
): Promise<PermissionFlag | null> {
  const probeDir = resolve(tmpdir(), `forge-permission-probe-${randomUUID()}`);

  try {
    await mkdir(probeDir, { recursive: true });
    await writeFile(join(probeDir, 'probe.mjs'), 'process.exit(0);\n', 'utf8');

    for (const flag of PERMISSION_FLAGS) {
      if (await flagWorks(nodeExecutable, flag, probeDir)) return flag;
    }

    return null;
  } catch {
    return null;
  } finally {
    await rm(probeDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function flagWorks(
  nodeExecutable: string,
  flag: PermissionFlag,
  probeDir: string,
): Promise<boolean> {
  return new Promise<boolean>((resolvePromise) => {
    const child = spawn(
      nodeExecutable,
      [
        flag,
        `--allow-fs-read=${probeDir}`,
        `--allow-fs-read=${join(probeDir, '*')}`,
        `--allow-fs-write=${join(probeDir, 'result.json')}`,
        join(probeDir, 'probe.mjs'),
      ],
      { stdio: 'ignore', windowsHide: true },
    );
    child.on('error', () => resolvePromise(false));
    child.on('close', (code) => resolvePromise(code === 0));
  });
}
