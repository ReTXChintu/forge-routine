import { describe, expect, it } from 'vitest';

import { runScenario } from '../scenario.js';

import { TERMINAL_SCENARIOS, findScenario } from './index.js';

/**
 * Every curated scenario must be provably solvable.
 *
 * This is the terminal equivalent of the sandbox verifier that gates
 * generated exercises: a scenario whose checks cannot all be satisfied sends
 * the user hunting for an hour for a mistake that is in our content, and they
 * will never fully trust the product again. The difference is that these are
 * hand-written, so the proof lives here as a reference solution rather than
 * running at generation time.
 *
 * The solutions below are one way, not the only way. Checks grade the end
 * state, so any route that reaches it passes.
 */

const SOLUTIONS: Record<string, string[]> = {
  'find-the-error-window': ['grep ERROR /var/log/app/service.log > /home/forge/errors.txt'],

  'deploy-key-permissions': ['chmod 600 .ssh/id_deploy', 'chmod 700 .ssh'],

  'config-drift': ['grep TIMEOUT_MS /srv/config/production.env > /home/forge/drift.txt'],

  'reclaim-disk': ['rm service.log.1 service.log.2 service.log.3'],

  'safe-restructure': [
    'mkdir -p releases/2026-03-01',
    'cp -r current/server.js releases/2026-03-01',
    'cp -r current/package.json releases/2026-03-01',
    'cp -r current/config releases/2026-03-01',
    'rm -r current',
  ],
};

describe('every curated scenario is solvable', () => {
  it.each(TERMINAL_SCENARIOS.map((scenario) => scenario.slug))('%s', (slug) => {
    const scenario = findScenario(slug);
    expect(scenario, `no scenario named ${slug}`).toBeDefined();

    const solution = SOLUTIONS[slug];
    expect(solution, `no reference solution for ${slug}`).toBeDefined();

    const result = runScenario(scenario!, solution!);

    const failed = result.checks.filter((check) => !check.passed);
    expect(
      failed.map((check) => `${check.check.kind}: ${check.detail}`),
      `${slug} is not solvable as written`,
    ).toEqual([]);
    expect(result.passed).toBe(true);
  });
});

describe('every curated scenario actually tests something', () => {
  it.each(TERMINAL_SCENARIOS.map((scenario) => scenario.slug))(
    '%s fails when nothing is done',
    (slug) => {
      // A scenario that passes on an empty transcript is not a scenario.
      const result = runScenario(findScenario(slug)!, []);
      expect(result.passed).toBe(false);
    },
  );

  it('every scenario has a task, checks, and hints that are questions', () => {
    for (const scenario of TERMINAL_SCENARIOS) {
      expect(scenario.task.length, scenario.slug).toBeGreaterThan(40);
      expect(scenario.checks.length, scenario.slug).toBeGreaterThan(0);

      // Hints are questions, never answers — the same rule as the assistance
      // ladder. A hint containing a runnable command is a solution.
      for (const hint of scenario.hints ?? []) {
        expect(hint, `${scenario.slug}: hint gives away a command`).not.toMatch(
          /\b(chmod|grep|rm|cp|mv|mkdir)\s+-?\w/,
        );
      }
    }
  });
});

describe('the checks reject near misses', () => {
  it('config-drift rejects handing back both differing lines', () => {
    // LOG_LEVEL also differs but is not the fault. Including it means the
    // difference was found and the cause was not.
    const result = runScenario(findScenario('config-drift')!, [
      'grep -v POOL /srv/config/production.env > /home/forge/drift.txt',
    ]);
    expect(result.passed).toBe(false);
  });

  it('find-the-error-window rejects copying the whole log', () => {
    const result = runScenario(findScenario('find-the-error-window')!, [
      'cp /var/log/app/service.log /home/forge/errors.txt',
    ]);
    expect(result.passed).toBe(false);
  });

  it('deploy-key-permissions rejects locking down the public key too', () => {
    const result = runScenario(findScenario('deploy-key-permissions')!, [
      'chmod 600 .ssh/id_deploy',
      'chmod 600 .ssh/id_deploy.pub',
      'chmod 700 .ssh',
    ]);
    expect(result.passed).toBe(false);
  });

  it('reclaim-disk rejects deleting the live log', () => {
    const result = runScenario(findScenario('reclaim-disk')!, ['rm service.log*']);
    expect(result.passed).toBe(false);
  });

  it('safe-restructure rejects removing the release before copying it', () => {
    const result = runScenario(findScenario('safe-restructure')!, [
      'rm -r current',
      'mkdir -p releases/2026-03-01',
    ]);
    expect(result.passed).toBe(false);
  });
});
