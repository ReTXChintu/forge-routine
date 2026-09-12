import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type SandboxOptions, detectPermissionFlag, runInSandbox } from '@forgeroutine/sandbox';

import { REFERENCE_SOLUTIONS } from './reference-solutions.js';

import { getCuratedCurricula } from './index.js';

/**
 * The single most valuable test in the curriculum package.
 *
 * Every shipped exercise is executed against its own tests using its reference
 * solution. If this fails, an exercise is unsolvable as written — and the user
 * would spend an hour hunting for a mistake that is in *our* code, which is the
 * fastest way to lose their trust in the whole product.
 *
 * It also guarantees `SHOW_SOLUTION` has something real to serve at the last
 * rung of the assistance ladder.
 */

let options: SandboxOptions;
let workDir: string;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'forge-reference-'));
  options = {
    workDir,
    timeoutMs: 8_000,
    maxMemoryMb: 128,
    maxOutputBytes: 8_192,
    permissionFlag: await detectPermissionFlag(),
  };
}, 30_000);

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true });
});

const exercises = getCuratedCurricula().flatMap((tech) =>
  tech.concepts.flatMap((concept) =>
    concept.exercises.map((exercise) => ({
      slug: exercise.slug,
      concept: `${tech.slug}:${concept.slug}`,
      testCases: exercise.testCases,
    })),
  ),
);

describe('reference solutions', () => {
  it('ships exercises to check', () => {
    expect(exercises.length).toBeGreaterThan(0);
  });

  it('has a reference solution for every exercise', () => {
    const missing = exercises
      .filter((e) => !REFERENCE_SOLUTIONS[e.slug])
      .map((e) => `${e.concept}/${e.slug}`);

    // Without one, SHOW_SOLUTION has nothing to show and this suite cannot
    // prove the exercise is solvable.
    expect(missing).toEqual([]);
  });

  it('has no reference solution for an exercise that does not exist', () => {
    const slugs = new Set(exercises.map((e) => e.slug));
    const orphans = Object.keys(REFERENCE_SOLUTIONS).filter((slug) => !slugs.has(slug));

    expect(orphans).toEqual([]);
  });

  it.each(exercises.map((e) => [e.slug, e] as const))(
    '%s is solvable: its reference solution passes every test',
    async (slug, exercise) => {
      const solution = REFERENCE_SOLUTIONS[slug];
      expect(solution, `no reference solution for ${slug}`).toBeDefined();

      const result = await runInSandbox(
        {
          language: 'javascript',
          code: solution as string,
          testCases: exercise.testCases.map((t) => ({
            name: t.name,
            hidden: t.hidden,
            code: t.code,
          })),
        },
        options,
      );

      // Report every failure at once rather than stopping at the first.
      const failures = result.cases
        .filter((c) => !c.passed)
        .map((c) => `  ✗ ${c.name}: ${c.error ?? 'failed'}`)
        .join('\n');

      expect(
        failures === '' ? '' : `\n${slug} (${exercise.concept}):\n${failures}\n${result.stderr}`,
      ).toBe('');

      expect(result.status).toBe('PASSED');
      expect(result.testsPassed).toBe(result.testsTotal);
    },
    45_000,
  );
});
