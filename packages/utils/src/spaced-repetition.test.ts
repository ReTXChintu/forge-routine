import { describe, expect, it } from 'vitest';

import {
  INITIAL_REVIEW_STATE,
  estimateRetention,
  gradeFromPerformance,
  scheduleNextReview,
} from './spaced-repetition.js';

const NOW = new Date('2026-06-01T00:00:00Z');

describe('gradeFromPerformance', () => {
  it('gives the top grade for an unaided pass', () => {
    expect(
      gradeFromPerformance({
        passed: true,
        testsPassed: 5,
        testsTotal: 5,
        aiRequestCount: 0,
        solutionRevealed: false,
      }),
    ).toBe(5);
  });

  it('caps a pass bought with a revealed solution at 2', () => {
    expect(
      gradeFromPerformance({
        passed: true,
        testsPassed: 5,
        testsTotal: 5,
        aiRequestCount: 1,
        solutionRevealed: true,
      }),
    ).toBe(2);
  });

  it('grades a near-miss above a total failure', () => {
    const nearMiss = gradeFromPerformance({
      passed: false,
      testsPassed: 4,
      testsTotal: 5,
      aiRequestCount: 0,
      solutionRevealed: false,
    });
    const blackout = gradeFromPerformance({
      passed: false,
      testsPassed: 0,
      testsTotal: 5,
      aiRequestCount: 0,
      solutionRevealed: false,
    });

    expect(nearMiss).toBeGreaterThan(blackout);
  });
});

describe('scheduleNextReview', () => {
  it('starts at one day then six days on consecutive successes', () => {
    const first = scheduleNextReview(INITIAL_REVIEW_STATE, 5, { now: NOW, mastery: 1 });
    expect(first.intervalDays).toBe(1);
    expect(first.repetitions).toBe(1);

    const second = scheduleNextReview(first, 5, { now: NOW, mastery: 1 });
    expect(second.intervalDays).toBe(6);
    expect(second.repetitions).toBe(2);
  });

  it('resets the interval and records a lapse on a failing grade', () => {
    const mature = { easeFactor: 2.5, intervalDays: 30, repetitions: 5, lapses: 0 };

    const lapsed = scheduleNextReview(mature, 1, { now: NOW, mastery: 1 });

    expect(lapsed.intervalDays).toBe(1);
    expect(lapsed.repetitions).toBe(0);
    expect(lapsed.lapses).toBe(1);
    expect(lapsed.easeFactor).toBeLessThan(mature.easeFactor);
  });

  it('returns weak concepts sooner than strong ones for the same grade', () => {
    const mature = { easeFactor: 2.5, intervalDays: 20, repetitions: 4, lapses: 0 };

    const weak = scheduleNextReview(mature, 4, { now: NOW, mastery: 0 });
    const strong = scheduleNextReview(mature, 4, { now: NOW, mastery: 1 });

    expect(weak.intervalDays).toBeLessThan(strong.intervalDays);
  });

  it('never drops the ease factor below the SM-2 floor', () => {
    let state = INITIAL_REVIEW_STATE;
    for (let i = 0; i < 20; i += 1) {
      state = scheduleNextReview(state, 0, { now: NOW });
    }

    expect(state.easeFactor).toBeGreaterThanOrEqual(1.3);
  });

  it('caps the interval so nothing disappears for a year', () => {
    let state = { easeFactor: 2.5, intervalDays: 170, repetitions: 10, lapses: 0 };
    state = scheduleNextReview(state, 5, { now: NOW, mastery: 1 });

    expect(state.intervalDays).toBeLessThanOrEqual(180);
  });

  it('always schedules at least one day out', () => {
    const result = scheduleNextReview(INITIAL_REVIEW_STATE, 5, { now: NOW, mastery: 0 });

    expect(result.intervalDays).toBeGreaterThanOrEqual(1);
    expect(result.dueAt.getTime()).toBeGreaterThan(NOW.getTime());
  });
});

describe('estimateRetention', () => {
  it('is full immediately after review and decays monotonically', () => {
    expect(estimateRetention(0, 10)).toBe(1);
    expect(estimateRetention(5, 10)).toBeGreaterThan(estimateRetention(20, 10));
  });

  it('decays more slowly for a more stable memory', () => {
    expect(estimateRetention(10, 30)).toBeGreaterThan(estimateRetention(10, 3));
  });
});
