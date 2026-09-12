import type {
  AssistanceLevel,
  IndependenceComponents,
  IndependentCodingScore,
} from '@forgeroutine/shared-types';

import { mean, median, normalise, recencyWeight, round, unit, weightedMean } from './math.js';

/**
 * Independent Coding Score (docs/coding-muscle.md).
 *
 * Only server-observed facts are inputs. Client-reported signals (keystrokes, pastes) are
 * deliberately excluded: they are trivially falsifiable, and a score that can be gamed is
 * worse than no score because the user would stop trusting it.
 */

/** One attempt's worth of evidence. Every field here is observed by the server. */
export interface AttemptEvidence {
  attemptId: string;
  conceptId: string;
  completedAt: Date;
  assistanceLevel: AssistanceLevel;
  passed: boolean;
  aiRequestCount: number;
  solutionRevealed: boolean;
  timeToFirstCodeMs: number | null;
  /** True when this concept was previously failed and is now passed unaided. */
  isSuccessfulReattempt: boolean;
}

export const INDEPENDENCE_WEIGHTS = {
  independentCompletionRate: 0.35,
  assistanceRestraint: 0.2,
  solutionAbstinence: 0.2,
  timeToFirstCode: 0.1,
  reattemptSuccess: 0.1,
  levelWeight: 0.05,
} as const satisfies Record<keyof IndependenceComponents, number>;

/** Below this many attempts the score is not reported at all. */
export const MIN_ATTEMPTS_FOR_SCORE = 5;

export const DEFAULT_WINDOW_DAYS = 30;

/** Assistance requests beyond this count contribute nothing further to the penalty. */
const AI_REQUEST_SATURATION = 6;

/** Time-to-first-code anchors, in milliseconds. */
const TTFC_BEST_MS = 30_000;
const TTFC_WORST_MS = 8 * 60_000;

export interface ComputeIndependenceOptions {
  now?: Date;
  windowDays?: number;
  halfLifeDays?: number;
  /** Score over the preceding window, to report a delta. */
  previousScore?: number | null;
}

export function computeIndependentCodingScore(
  attempts: readonly AttemptEvidence[],
  options: ComputeIndependenceOptions = {},
): IndependentCodingScore {
  const now = options.now ?? new Date();
  const windowDays = options.windowDays ?? DEFAULT_WINDOW_DAYS;
  const halfLifeDays = options.halfLifeDays ?? DEFAULT_WINDOW_DAYS;

  const cutoff = now.getTime() - windowDays * 86_400_000;
  const inWindow = attempts.filter((a) => a.completedAt.getTime() >= cutoff);

  const components = computeComponents(inWindow, now, halfLifeDays);

  if (inWindow.length < MIN_ATTEMPTS_FOR_SCORE) {
    return {
      score: null,
      status: 'INSUFFICIENT_DATA',
      attemptsConsidered: inWindow.length,
      windowDays,
      components,
      deltaFromPreviousWindow: null,
    };
  }

  const score = unit(
    (Object.keys(INDEPENDENCE_WEIGHTS) as (keyof IndependenceComponents)[]).reduce(
      (sum, key) => sum + INDEPENDENCE_WEIGHTS[key] * components[key],
      0,
    ),
  );

  const previous = options.previousScore ?? null;

  return {
    score: round(score),
    status: 'OK',
    attemptsConsidered: inWindow.length,
    windowDays,
    components,
    deltaFromPreviousWindow: previous === null ? null : round((score - previous) * 100, 1),
  };
}

function computeComponents(
  attempts: readonly AttemptEvidence[],
  now: Date,
  halfLifeDays: number,
): IndependenceComponents {
  if (attempts.length === 0) {
    return {
      independentCompletionRate: 0,
      assistanceRestraint: 0,
      solutionAbstinence: 0,
      timeToFirstCode: 0,
      reattemptSuccess: 0,
      levelWeight: 0,
    };
  }

  const ageDays = (a: AttemptEvidence) =>
    Math.max(0, (now.getTime() - a.completedAt.getTime()) / 86_400_000);

  // Interview-level attempts are the strongest available evidence and count double.
  const weighted = attempts.map((a) => ({
    attempt: a,
    weight: recencyWeight(ageDays(a), halfLifeDays) * (a.assistanceLevel === 5 ? 2 : 1),
  }));

  const independentCompletionRate = weightedMean(
    weighted.map(({ attempt, weight }) => ({
      value: attempt.passed && attempt.aiRequestCount === 0 ? 1 : 0,
      weight,
    })),
  );

  const assistanceRestraint = weightedMean(
    weighted.map(({ attempt, weight }) => ({
      value: 1 - Math.min(1, attempt.aiRequestCount / AI_REQUEST_SATURATION),
      weight,
    })),
  );

  const solutionAbstinence = weightedMean(
    weighted.map(({ attempt, weight }) => ({
      value: attempt.solutionRevealed ? 0 : 1,
      weight,
    })),
  );

  const ttfcSamples = attempts
    .map((a) => a.timeToFirstCodeMs)
    .filter((v): v is number => v !== null && v >= 0);
  const timeToFirstCode =
    ttfcSamples.length === 0
      ? 0.5 // no evidence either way; do not punish or reward
      : normalise(median(ttfcSamples), TTFC_BEST_MS, TTFC_WORST_MS);

  const reattempts = attempts.filter((a) => a.isSuccessfulReattempt);
  const previouslyFailedConcepts = new Set(
    attempts.filter((a) => !a.passed).map((a) => a.conceptId),
  );
  const reattemptSuccess =
    previouslyFailedConcepts.size === 0
      ? // Nothing was failed in this window, so there is nothing to recover from.
        // Neutral rather than zero: absence of failure is not absence of ability.
        0.5
      : unit(new Set(reattempts.map((a) => a.conceptId)).size / previouslyFailedConcepts.size);

  const levelWeight = unit(mean(attempts.map((a) => a.assistanceLevel)) / 5);

  return {
    independentCompletionRate: round(independentCompletionRate),
    assistanceRestraint: round(assistanceRestraint),
    solutionAbstinence: round(solutionAbstinence),
    timeToFirstCode: round(timeToFirstCode),
    reattemptSuccess: round(reattemptSuccess),
    levelWeight: round(levelWeight),
  };
}

// -- Assistance-level promotion and demotion --------------------------------

export interface LevelDecisionInput {
  currentLevel: AssistanceLevel;
  /** Most recent first. */
  recentAttempts: readonly AttemptEvidence[];
}

export type LevelDecision =
  | { action: 'PROMOTE'; to: AssistanceLevel; reason: string }
  | { action: 'DEMOTE'; to: AssistanceLevel; reason: string }
  | { action: 'HOLD'; reason: string };

/** Baseline time-to-first-code per level, in ms. Higher levels legitimately take longer. */
const TTFC_BASELINE_MS: Record<AssistanceLevel, number> = {
  1: 45_000,
  2: 60_000,
  3: 120_000,
  4: 180_000,
  5: 240_000,
};

/**
 * Promotion requires repeated evidence; demotion is deliberately gentler, because the
 * product's job is to rebuild confidence (§10). One bad day must not cost a level.
 */
export function decideAssistanceLevel(input: LevelDecisionInput): LevelDecision {
  const { currentLevel, recentAttempts } = input;

  const lastThree = recentAttempts.slice(0, 3);
  if (currentLevel < 5 && lastThree.length === 3) {
    const allPassed = lastThree.every((a) => a.passed);
    const restrained = mean(lastThree.map((a) => a.aiRequestCount)) <= 1;
    const noReveals = lastThree.every((a) => !a.solutionRevealed);
    const baseline = TTFC_BASELINE_MS[currentLevel];
    const ttfcOk = lastThree.every(
      (a) => a.timeToFirstCodeMs === null || a.timeToFirstCodeMs <= baseline * 1.5,
    );

    if (allPassed && restrained && noReveals && ttfcOk) {
      return {
        action: 'PROMOTE',
        to: (currentLevel + 1) as AssistanceLevel,
        reason: 'Three consecutive passes with minimal assistance.',
      };
    }
  }

  const lastTwo = recentAttempts.slice(0, 2);
  if (currentLevel > 1 && lastTwo.length === 2) {
    const bothGaveUp = lastTwo.every((a) => !a.passed && a.solutionRevealed);
    if (bothGaveUp) {
      return {
        action: 'DEMOTE',
        to: (currentLevel - 1) as AssistanceLevel,
        reason: 'Two consecutive attempts ended in a revealed solution.',
      };
    }
  }

  return { action: 'HOLD', reason: 'Not enough consistent evidence to change level.' };
}
