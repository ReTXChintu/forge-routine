import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';

import type { GeneratedExerciseOutput, GeneratedProjectOutput } from '@forgeroutine/ai';
import type { AppConfig } from '@forgeroutine/config';
import { type PermissionFlag, detectPermissionFlag, runInSandbox } from '@forgeroutine/sandbox';

import { APP_CONFIG } from '../../../infrastructure/config/config.module.js';

export interface VerificationResult {
  accepted: boolean;
  reason: string | null;
  testsPassed: number;
  testsTotal: number;
}

/**
 * Executes a generated exercise's reference solution against its own generated
 * tests, in the real sandbox, before anything is persisted.
 *
 * This is the gate that makes AI-generated curriculum usable rather than a
 * liability. A model will confidently produce an exercise whose tests cannot
 * be satisfied — a typo in an assertion, a test that contradicts the stated
 * requirements, a reference solution that does not match its own signature.
 * Shipping one of those sends the user hunting for an hour for a mistake that
 * is in *our* content, and they will never fully trust the product again.
 *
 * Curated exercises get the same guarantee statically, in
 * packages/curriculum's reference-solutions.test.ts. This is the runtime
 * equivalent for content nobody reviewed.
 */
@Injectable()
export class ExerciseVerifier implements OnModuleInit {
  private readonly logger = new Logger(ExerciseVerifier.name);
  private permissionFlag: PermissionFlag | null = null;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async onModuleInit(): Promise<void> {
    this.permissionFlag = await detectPermissionFlag();
  }

  async verify(exercise: GeneratedExerciseOutput): Promise<VerificationResult> {
    const { env } = this.config;

    // A DEBUGGING exercise is verified against its repaired code, which is
    // what `referenceSolution` holds; `starterCode` is the broken version and
    // is expected to fail.
    const result = await runInSandbox(
      {
        code: exercise.referenceSolution,
        language: 'javascript',
        testCases: exercise.testCases.map((t) => ({
          name: t.name,
          hidden: t.hidden,
          code: t.code,
        })),
      },
      {
        workDir: env.EXECUTION_WORK_DIR,
        // Generated tests can be slower than curated ones and a false
        // rejection is expensive, so this is more generous than a submission.
        timeoutMs: Math.max(env.EXECUTION_TIMEOUT_MS, 10_000),
        maxMemoryMb: env.EXECUTION_MAX_MEMORY_MB,
        maxOutputBytes: env.EXECUTION_MAX_OUTPUT_BYTES,
        permissionFlag: this.permissionFlag,
      },
    );

    if (result.status === 'PASSED') {
      return {
        accepted: true,
        reason: null,
        testsPassed: result.testsPassed,
        testsTotal: result.testsTotal,
      };
    }

    const failing = result.cases
      .filter((c) => !c.passed)
      .map((c) => `${c.name}: ${c.error ?? 'failed'}`)
      .join('; ');

    const reason =
      result.status === 'COMPILE_ERROR'
        ? `reference solution would not load: ${result.stderr.slice(0, 200)}`
        : result.status === 'TIMEOUT'
          ? 'reference solution did not terminate'
          : failing || `${result.status}: ${result.stderr.slice(0, 200)}`;

    this.logger.warn(`Rejected generated exercise "${exercise.slug}": ${reason}`);

    return {
      accepted: false,
      reason,
      testsPassed: result.testsPassed,
      testsTotal: result.testsTotal,
    };
  }

  /**
   * Additionally confirms a debugging exercise's broken code actually fails.
   * Broken code that quietly passes is worse than no exercise: the user stares
   * at working code looking for a fault that is not there.
   */
  async verifyBrokenCodeFails(exercise: GeneratedExerciseOutput): Promise<boolean> {
    if (exercise.kind !== 'DEBUGGING' || !exercise.starterCode) return true;

    const { env } = this.config;

    const result = await runInSandbox(
      {
        code: exercise.starterCode,
        language: 'javascript',
        testCases: exercise.testCases.map((t) => ({
          name: t.name,
          hidden: t.hidden,
          code: t.code,
        })),
      },
      {
        workDir: env.EXECUTION_WORK_DIR,
        timeoutMs: Math.max(env.EXECUTION_TIMEOUT_MS, 10_000),
        maxMemoryMb: env.EXECUTION_MAX_MEMORY_MB,
        maxOutputBytes: env.EXECUTION_MAX_OUTPUT_BYTES,
        permissionFlag: this.permissionFlag,
      },
    );

    // It must fail by failing a test, not by refusing to load: a syntax error
    // is a different exercise from a logic bug.
    return result.status === 'FAILED';
  }

  /**
   * Verifies a whole project, step by step.
   *
   * Each step's reference solution is run against that step's tests **and
   * every earlier step's**, which is exactly what the user will be held to
   * when they submit. A project where step three quietly breaks step one is
   * unwinnable, and the user would spend the evening hunting for a fault in
   * their own code that is actually in ours.
   *
   * All or nothing. A partially valid project cannot be trimmed to its
   * working prefix, because the steps that remain were written to lead
   * somewhere the project no longer goes.
   */
  async verifyProject(project: GeneratedProjectOutput): Promise<VerificationResult> {
    const { env } = this.config;

    for (const [index, step] of project.steps.entries()) {
      const testCases = project.steps.slice(0, index + 1).flatMap((earlier, earlierIndex) =>
        earlier.testCases.map((testCase) => ({
          name:
            earlierIndex < index ? `[step ${earlierIndex + 1}] ${testCase.name}` : testCase.name,
          hidden: testCase.hidden,
          code: testCase.code,
        })),
      );

      const result = await runInSandbox(
        { code: step.referenceSolution, language: 'javascript', testCases },
        {
          workDir: env.EXECUTION_WORK_DIR,
          // A project step is larger than a drill, and rejecting a whole
          // project over an impatient timeout is expensive.
          timeoutMs: Math.max(env.EXECUTION_TIMEOUT_MS, 15_000),
          maxMemoryMb: env.EXECUTION_MAX_MEMORY_MB,
          maxOutputBytes: env.EXECUTION_MAX_OUTPUT_BYTES,
          permissionFlag: this.permissionFlag,
        },
      );

      if (result.status !== 'PASSED') {
        const failing = result.cases
          .filter((testCase) => !testCase.passed)
          .map((testCase) => `${testCase.name}: ${testCase.error ?? 'failed'}`)
          .join('; ');

        const reason =
          `step ${index + 1} (${step.title}): ` +
          (result.status === 'COMPILE_ERROR'
            ? `solution would not load: ${result.stderr.slice(0, 200)}`
            : result.status === 'TIMEOUT'
              ? 'solution did not terminate'
              : failing || `${result.status}: ${result.stderr.slice(0, 200)}`);

        this.logger.warn(`Rejected generated project "${project.slug}": ${reason}`);

        return {
          accepted: false,
          reason,
          testsPassed: result.testsPassed,
          testsTotal: result.testsTotal,
        };
      }
    }

    const total = project.steps.reduce((sum, step) => sum + step.testCases.length, 0);
    return { accepted: true, reason: null, testsPassed: total, testsTotal: total };
  }
}
