/**
 * Strict sequential progression within a technology.
 *
 * The knowledge graph in `graph.ts` answers "do you know enough to attempt
 * this", which is a different and looser question: it only blocks a concept
 * when something it directly depends on is weak, so most concepts are
 * unlocked from day one and a course can be taken in almost any order.
 *
 * That is right for a returning engineer filling gaps, and wrong for someone
 * working a course from basics to advanced. This adds the stricter rule: the
 * next concept opens when the one before it is cleared, and not before.
 *
 * Both apply. The graph can still block a concept whose cross-technology
 * prerequisite is weak even when the one before it in this course is done.
 */

export interface SequenceConcept {
  conceptId: string;
  /** Position within its technology. Basics first. */
  orderIndex: number;
  /** False when the concept has no exercises and no questions. */
  hasPractice: boolean;
}

export interface SequenceProgress {
  /** Concepts the user has cleared. */
  clearedConceptIds: ReadonlySet<string>;
}

export interface SequenceGate {
  conceptId: string;
  unlocked: boolean;
  /** The concept standing in the way, when one is. */
  blockedByConceptId: string | null;
}

/**
 * What counts as cleared.
 *
 * A passed attempt, not a mastery score. Mastery decays and is estimated
 * from several signals, so gating on it would re-lock material the user has
 * genuinely finished — which is the single most frustrating thing a course
 * can do. Clearing is a historical fact: you solved it once, so the door
 * stays open.
 */
export const CLEARED_BY = 'one passed attempt, or one correct answer where there is no exercise';

/**
 * Gates every concept in one technology.
 *
 * A concept with no practice at all cannot be cleared, so it never blocks:
 * otherwise a technology whose generation produced a reading-only concept
 * would wall the user in permanently with nothing they could do about it.
 */
export function gateSequence(
  concepts: readonly SequenceConcept[],
  progress: SequenceProgress,
): SequenceGate[] {
  const ordered = [...concepts].sort((a, b) => a.orderIndex - b.orderIndex);

  let blocker: string | null = null;

  return ordered.map((concept) => {
    const gate: SequenceGate = {
      conceptId: concept.conceptId,
      unlocked: blocker === null,
      blockedByConceptId: blocker,
    };

    // The first unfinished concept that *can* be finished closes the door on
    // everything after it.
    if (
      blocker === null &&
      concept.hasPractice &&
      !progress.clearedConceptIds.has(concept.conceptId)
    ) {
      blocker = concept.conceptId;
    }

    return gate;
  });
}

/** The concept the user should be working on, or null when the course is done. */
export function currentConcept(
  concepts: readonly SequenceConcept[],
  progress: SequenceProgress,
): string | null {
  const ordered = [...concepts].sort((a, b) => a.orderIndex - b.orderIndex);

  for (const concept of ordered) {
    if (concept.hasPractice && !progress.clearedConceptIds.has(concept.conceptId)) {
      return concept.conceptId;
    }
  }

  return null;
}

/** 0-1. How far through a technology the user has worked. */
export function sequenceProgress(
  concepts: readonly SequenceConcept[],
  progress: SequenceProgress,
): number {
  const clearable = concepts.filter((concept) => concept.hasPractice);
  if (clearable.length === 0) return 0;

  const cleared = clearable.filter((concept) => progress.clearedConceptIds.has(concept.conceptId));

  return cleared.length / clearable.length;
}
