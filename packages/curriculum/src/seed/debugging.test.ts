import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type SandboxOptions, detectPermissionFlag, runInSandbox } from '@forgeroutine/sandbox';

import { DEBUGGING_EXERCISES } from './debugging.js';

/**
 * Debugging exercises have an invariant ordinary exercises do not:
 *
 *   the shipped broken code must actually FAIL, and a correct fix must PASS.
 *
 * A "broken" example that quietly passes is worse than no exercise at all — the
 * user stares at working code looking for a fault that is not there. These run
 * the real sandbox to prove both directions.
 */

let options: SandboxOptions;
let workDir: string;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'forge-debug-seed-'));
  options = {
    workDir,
    timeoutMs: 5_000,
    maxMemoryMb: 128,
    maxOutputBytes: 8_192,
    permissionFlag: await detectPermissionFlag(),
  };
});

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true });
});

/** A correct fix for each shipped broken exercise. */
const FIXES: Record<string, string> = {
  'debug-loop-closure': `export default function makeHandlers(items) {
  const handlers = [];
  for (let i = 0; i < items.length; i++) {
    handlers.push(() => items[i]);
  }
  return handlers;
}
`,
  'debug-splice-while-iterating': `export default function removeEvens(numbers) {
  return numbers.filter((n) => n % 2 !== 0);
}
`,
  'debug-unawaited-async-map': `export default async function notifyAll(users, sendEmail) {
  await Promise.all(users.map((user) => sendEmail(user.email)));
  return users.length;
}
`,
};

const allExercises = Object.entries(DEBUGGING_EXERCISES).flatMap(([key, exercises]) =>
  exercises.map((exercise) => ({ key, exercise })),
);

describe('debugging exercises execute as intended', () => {
  it('ships at least one', () => {
    expect(allExercises.length).toBeGreaterThan(0);
  });

  it.each(allExercises.map(({ key, exercise }) => [exercise.slug, key, exercise] as const))(
    '%s: the shipped broken code fails its tests',
    async (_slug, _key, exercise) => {
      const result = await runInSandbox(
        {
          language: 'javascript',
          code: exercise.brokenCode as string,
          testCases: exercise.testCases.map((t) => ({
            name: t.name,
            hidden: t.hidden ?? false,
            code: t.code,
          })),
        },
        options,
      );

      expect(result.passed, 'broken code must not pass — there would be nothing to find').toBe(
        false,
      );
      // It must fail by failing a test, not by refusing to load: a syntax error
      // is a different exercise from a logic bug.
      expect(result.status).toBe('FAILED');
      expect(result.testsPassed).toBeLessThan(result.testsTotal);
    },
    30_000,
  );

  it.each(allExercises.map(({ key, exercise }) => [exercise.slug, key, exercise] as const))(
    '%s: a correct fix passes every test',
    async (slug, _key, exercise) => {
      const fix = FIXES[slug];
      expect(fix, `no reference fix registered for ${slug}`).toBeDefined();

      const result = await runInSandbox(
        {
          language: 'javascript',
          code: fix as string,
          testCases: exercise.testCases.map((t) => ({
            name: t.name,
            hidden: t.hidden ?? false,
            code: t.code,
          })),
        },
        options,
      );

      const failures = result.cases.filter((c) => !c.passed);
      expect(failures.map((c) => `${c.name}: ${c.error ?? ''}`).join('; ')).toBe('');
      expect(result.passed).toBe(true);
    },
    30_000,
  );

  it('every broken exercise fails at least one *visible* test', async () => {
    // If only hidden cases fail, the user sees green and has no starting point.
    for (const { exercise } of allExercises) {
      const result = await runInSandbox(
        {
          language: 'javascript',
          code: exercise.brokenCode as string,
          testCases: exercise.testCases.map((t) => ({
            name: t.name,
            hidden: t.hidden ?? false,
            code: t.code,
          })),
        },
        options,
      );

      const visibleNames = exercise.testCases
        .filter((t) => !(t.hidden ?? false))
        .map((t) => t.name);
      const failedVisible = result.cases.filter((c) => !c.passed && visibleNames.includes(c.name));

      expect(
        failedVisible.length,
        `${exercise.slug} fails only hidden tests; the user would see green`,
      ).toBeGreaterThan(0);
    }
  }, 60_000);
});
