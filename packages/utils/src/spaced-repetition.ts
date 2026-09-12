/**
 * Spaced repetition (§22).
 *
 * SM-2 derived, with two deliberate departures documented in docs/roadmap.md:
 *
 *  1. Grading is derived from measured performance (tests passed, assistance used, time),
 *     not from a user self-rating. Self-rating is the weakest signal we have available and
 *     the one most distorted by the confidence problem this product exists to fix.
 *  2. Intervals are additionally compressed by weakness, so a concept the user is weak at
 *     returns sooner than SM-2 alone would schedule it.
 */

import { clamp, unit } from './math.js';

export interface ReviewState {
  easeFactor: number;
  intervalDays: number;
  repetitions: number;
  lapses: number;
}

export const INITIAL_REVIEW_STATE: ReviewState = {
  easeFactor: 2.5,
  intervalDays: 0,
  repetitions: 0,
  lapses: 0,
};

const MIN_EASE = 1.3;
const MAX_INTERVAL_DAYS = 180;

/** SM-2 quality grade, 0 (total blackout) to 5 (perfect). */
export type ReviewGrade = 0 | 1 | 2 | 3 | 4 | 5;

export interface PerformanceInput {
  passed: boolean;
  testsPassed: number;
  testsTotal: number;
  aiRequestCount: number;
  solutionRevealed: boolean;
}

/**
 * Turn measured performance into an SM-2 grade.
 * A pass bought with a revealed solution is capped at 2 — it is a failure for
 * scheduling purposes even though it is a success for morale.
 */
export function gradeFromPerformance(perf: PerformanceInput): ReviewGrade {
  if (perf.solutionRevealed) return perf.passed ? 2 : 0;

  const ratio = perf.testsTotal === 0 ? (perf.passed ? 1 : 0) : perf.testsPassed / perf.testsTotal;

  if (!perf.passed) {
    if (ratio >= 0.6) return 2;
    if (ratio >= 0.3) return 1;
    return 0;
  }

  if (perf.aiRequestCount === 0) return 5;
  if (perf.aiRequestCount <= 2) return 4;
  return 3;
}

export interface ScheduleOptions {
  now?: Date;
  /**
   * Current mastery of the concept in [0,1]. Weak concepts return more frequently
   * regardless of grade — §22 requires that review is not uniform.
   */
  mastery?: number;
}

export interface ScheduleResult extends ReviewState {
  dueAt: Date;
}

export function scheduleNextReview(
  state: ReviewState,
  grade: ReviewGrade,
  options: ScheduleOptions = {},
): ScheduleResult {
  const now = options.now ?? new Date();
  const mastery = unit(options.mastery ?? 0.5);

  // SM-2 ease update.
  const easeFactor = Math.max(
    MIN_EASE,
    state.easeFactor + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02)),
  );

  let repetitions: number;
  let intervalDays: number;
  let lapses = state.lapses;

  if (grade < 3) {
    // Lapse: restart the ladder. The ease penalty above already applied.
    repetitions = 0;
    intervalDays = 1;
    lapses += 1;
  } else {
    repetitions = state.repetitions + 1;
    if (repetitions === 1) intervalDays = 1;
    else if (repetitions === 2) intervalDays = 6;
    else intervalDays = Math.round(state.intervalDays * easeFactor);
  }

  // Weakness compression: at mastery 0 the interval is halved, at mastery 1 it is unchanged.
  const masteryFactor = 0.5 + 0.5 * mastery;
  intervalDays = clamp(Math.round(intervalDays * masteryFactor), 1, MAX_INTERVAL_DAYS);

  return {
    easeFactor: Math.round(easeFactor * 1000) / 1000,
    intervalDays,
    repetitions,
    lapses,
    dueAt: new Date(now.getTime() + intervalDays * 86_400_000),
  };
}

/**
 * Retention estimate from an exponential forgetting curve, used to decay skill
 * values between reviews so the dashboard reflects what the user knows *now*.
 */
export function estimateRetention(
  daysSinceReview: number,
  stabilityDays: number,
): number {
  if (daysSinceReview <= 0) return 1;
  if (stabilityDays <= 0) return 0;
  return unit(Math.exp(-daysSinceReview / stabilityDays));
}

/** Stability grows with successful repetitions and shrinks with lapses. */
export function stabilityFromState(state: ReviewState): number {
  return Math.max(1, state.intervalDays * state.easeFactor - state.lapses * 2);
}
