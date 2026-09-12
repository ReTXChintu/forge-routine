import { describe, expect, it } from 'vitest';

import {
  type AttemptEvidence,
  MIN_ATTEMPTS_FOR_SCORE,
  computeIndependentCodingScore,
  decideAssistanceLevel,
} from './independence.js';

const NOW = new Date('2026-06-01T12:00:00Z');

function attempt(overrides: Partial<AttemptEvidence> = {}): AttemptEvidence {
  return {
    attemptId: 'a1',
    conceptId: 'c1',
    completedAt: NOW,
    assistanceLevel: 3,
    passed: true,
    aiRequestCount: 0,
    solutionRevealed: false,
    timeToFirstCodeMs: 40_000,
    isSuccessfulReattempt: false,
    ...overrides,
  };
}

function attempts(count: number, overrides: Partial<AttemptEvidence> = {}): AttemptEvidence[] {
  return Array.from({ length: count }, (_, i) =>
    attempt({ attemptId: `a${i}`, conceptId: `c${i}`, ...overrides }),
  );
}

describe('computeIndependentCodingScore', () => {
  it('reports INSUFFICIENT_DATA rather than a low score for a new user', () => {
    const result = computeIndependentCodingScore(attempts(MIN_ATTEMPTS_FOR_SCORE - 1), {
      now: NOW,
    });

    expect(result.status).toBe('INSUFFICIENT_DATA');
    expect(result.score).toBeNull();
  });

  it('scores a fully independent user near the top', () => {
    const result = computeIndependentCodingScore(
      attempts(10, { assistanceLevel: 5, timeToFirstCodeMs: 30_000 }),
      { now: NOW },
    );

    expect(result.status).toBe('OK');
    expect(result.score).not.toBeNull();
    expect(result.score!).toBeGreaterThan(0.85);
    expect(result.components.independentCompletionRate).toBe(1);
    expect(result.components.solutionAbstinence).toBe(1);
  });

  it('scores a fully AI-dependent user low', () => {
    const result = computeIndependentCodingScore(
      attempts(10, {
        assistanceLevel: 1,
        aiRequestCount: 8,
        solutionRevealed: true,
        timeToFirstCodeMs: 8 * 60_000,
      }),
      { now: NOW },
    );

    expect(result.score!).toBeLessThan(0.15);
    expect(result.components.assistanceRestraint).toBe(0);
    expect(result.components.solutionAbstinence).toBe(0);
  });

  it('ignores attempts outside the window', () => {
    const old = attempts(20, { completedAt: new Date('2026-01-01T00:00:00Z') });
    const recent = attempts(6, { attemptId: 'recent' });

    const result = computeIndependentCodingScore([...old, ...recent], { now: NOW });

    expect(result.attemptsConsidered).toBe(6);
  });

  it('weights recent evidence above older evidence', () => {
    const improving = [
      ...attempts(6, { completedAt: NOW, aiRequestCount: 0 }),
      ...attempts(6, {
        completedAt: new Date(NOW.getTime() - 28 * 86_400_000),
        aiRequestCount: 6,
        solutionRevealed: true,
        passed: false,
      }),
    ];
    const declining = [
      ...attempts(6, { completedAt: NOW, aiRequestCount: 6, solutionRevealed: true, passed: false }),
      ...attempts(6, { completedAt: new Date(NOW.getTime() - 28 * 86_400_000), aiRequestCount: 0 }),
    ];

    const improved = computeIndependentCodingScore(improving, { now: NOW });
    const declined = computeIndependentCodingScore(declining, { now: NOW });

    expect(improved.score!).toBeGreaterThan(declined.score!);
  });

  it('counts interview-level attempts double toward independent completion', () => {
    const mixed = [
      ...attempts(3, { assistanceLevel: 5, passed: true, aiRequestCount: 0 }),
      ...attempts(3, { assistanceLevel: 1, passed: false, aiRequestCount: 1 }),
    ];

    const result = computeIndependentCodingScore(mixed, { now: NOW });

    // 3 level-5 passes weigh 6; 3 level-1 failures weigh 3 → 6/9 ≈ 0.667
    expect(result.components.independentCompletionRate).toBeCloseTo(0.667, 2);
  });

  it('reports a delta against the previous window in score points', () => {
    const result = computeIndependentCodingScore(attempts(10), {
      now: NOW,
      previousScore: 0.6,
    });

    expect(result.deltaFromPreviousWindow).not.toBeNull();
    expect(result.deltaFromPreviousWindow!).toBeGreaterThan(0);
  });

  it('stays within [0,1] for adversarial inputs', () => {
    const weird = attempts(8, {
      aiRequestCount: 10_000,
      timeToFirstCodeMs: -5,
      assistanceLevel: 5,
    });

    const result = computeIndependentCodingScore(weird, { now: NOW });

    expect(result.score!).toBeGreaterThanOrEqual(0);
    expect(result.score!).toBeLessThanOrEqual(1);
  });
});

describe('decideAssistanceLevel', () => {
  it('promotes after three clean consecutive passes', () => {
    const decision = decideAssistanceLevel({
      currentLevel: 2,
      recentAttempts: attempts(3, { assistanceLevel: 2, timeToFirstCodeMs: 50_000 }),
    });

    expect(decision.action).toBe('PROMOTE');
    expect(decision).toMatchObject({ to: 3 });
  });

  it('does not promote when assistance was used heavily', () => {
    const decision = decideAssistanceLevel({
      currentLevel: 2,
      recentAttempts: attempts(3, { assistanceLevel: 2, aiRequestCount: 4 }),
    });

    expect(decision.action).toBe('HOLD');
  });

  it('does not promote past level 5', () => {
    const decision = decideAssistanceLevel({
      currentLevel: 5,
      recentAttempts: attempts(3, { assistanceLevel: 5, timeToFirstCodeMs: 60_000 }),
    });

    expect(decision.action).toBe('HOLD');
  });

  it('does not demote after a single bad attempt', () => {
    const decision = decideAssistanceLevel({
      currentLevel: 3,
      recentAttempts: [
        attempt({ passed: false, solutionRevealed: true }),
        attempt({ passed: true }),
      ],
    });

    expect(decision.action).toBe('HOLD');
  });

  it('demotes after two consecutive revealed solutions', () => {
    const decision = decideAssistanceLevel({
      currentLevel: 3,
      recentAttempts: attempts(2, { passed: false, solutionRevealed: true }),
    });

    expect(decision.action).toBe('DEMOTE');
    expect(decision).toMatchObject({ to: 2 });
  });

  it('never demotes below level 1', () => {
    const decision = decideAssistanceLevel({
      currentLevel: 1,
      recentAttempts: attempts(2, { passed: false, solutionRevealed: true }),
    });

    expect(decision.action).toBe('HOLD');
  });
});
