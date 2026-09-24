import { Injectable } from '@nestjs/common';

import { computeReadiness } from '@forgeroutine/curriculum';
import type {
  AssistanceLevel,
  ExerciseView,
  StartAttemptResponse,
} from '@forgeroutine/shared-types';
import type { StartAttemptInput } from '@forgeroutine/validation';

import { Problems } from '../../../common/http/problem-details.js';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';
import { ConceptsService } from '../../concepts/application/concepts.service.js';
import { SkillsService } from '../../skills/application/skills.service.js';
import { projectExercise, type StoredExercise } from '../domain/exercise-view.js';

@Injectable()
export class ExercisesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly skills: SkillsService,
    private readonly concepts: ConceptsService,
  ) {}

  async listForConcept(userId: string, conceptId: string): Promise<ExerciseView[]> {
    const level = await this.skills.getAssistanceLevel(userId, conceptId);

    const rows = await this.prisma.exercise.findMany({
      where: { conceptId, archivedAt: null, kind: { in: CODE_EXERCISE_KINDS } },
      include: { testCases: { select: { name: true, hidden: true } } },
      orderBy: { difficulty: 'asc' },
    });

    // Filtered again in code so the row type narrows: the query guarantees
    // it, but TypeScript cannot see a Prisma `in` clause.
    return rows
      .filter(isCodeExercise)
      .map((row) => projectExercise(row, { level, blindMode: false }));
  }

  async getView(
    userId: string,
    exerciseId: string,
    overrides: { level?: AssistanceLevel; blindMode?: boolean } = {},
  ): Promise<ExerciseView> {
    const row = await this.prisma.exercise.findUnique({
      where: { id: exerciseId },
      include: { testCases: { select: { name: true, hidden: true } } },
    });

    if (!row || row.archivedAt !== null) throw Problems.notFound('Exercise');
    // A challenge reaching this projection would be shown with an assistance
    // ladder it does not have, and without the brief it does.
    if (!isCodeExercise(row)) throw Problems.notFound('Exercise');

    const level = overrides.level ?? (await this.skills.getAssistanceLevel(userId, row.conceptId));

    return projectExercise(row, { level, blindMode: overrides.blindMode ?? false });
  }

  /**
   * Opens an attempt. This starts the time-to-first-code clock, so it must happen
   * when the user actually sees the problem — not when the page loads.
   */
  async startAttempt(
    userId: string,
    exerciseId: string,
    input: StartAttemptInput,
  ): Promise<StartAttemptResponse> {
    const exercise = await this.prisma.exercise.findUnique({
      where: { id: exerciseId },
      include: { testCases: { select: { name: true, hidden: true } } },
    });

    if (!exercise || exercise.archivedAt !== null) throw Problems.notFound('Exercise');
    // Phase 9 challenges open their own attempts through ChallengesService,
    // which gives them a brief instead of an assistance level.
    if (!isCodeExercise(exercise)) throw Problems.notFound('Exercise');

    await this.assertUnlocked(userId, exercise.conceptId);

    const level =
      input.assistanceLevel ?? (await this.skills.getAssistanceLevel(userId, exercise.conceptId));

    // Reuse an open attempt rather than creating a second one: a page refresh
    // must not reset the clock or fork the assistance counters.
    const existing = await this.prisma.exerciseAttempt.findFirst({
      where: { userId, exerciseId, outcome: 'IN_PROGRESS' },
      orderBy: { createdAt: 'desc' },
    });

    // The last time they got this right, if they ever did. A solved
    // exercise reopened must say so — the alternative is a user redoing
    // work the system already knows they finished.
    const solved = await this.prisma.exerciseAttempt.findFirst({
      where: { userId, exerciseId, outcome: 'PASSED' },
      orderBy: { completedAt: 'asc' },
      select: { completedAt: true, draftCode: true },
    });

    const attempt =
      existing ??
      (await this.prisma.exerciseAttempt.create({
        data: {
          userId,
          exerciseId,
          sessionId: input.sessionId ?? null,
          assistanceLevel: level,
          blindMode: input.blindMode,
          openedAt: new Date(),
          // A new attempt on already-solved work opens with what they
          // wrote last time, not with the starter code. Starting over from
          // scratch is a choice they can make; it should not be the
          // default consequence of clicking back into something.
          draftCode: existing ? undefined : (solved?.draftCode ?? undefined),
        },
      }));

    return {
      attemptId: attempt.id,
      exercise: projectExercise(exercise, {
        level: attempt.assistanceLevel as AssistanceLevel,
        blindMode: attempt.blindMode,
      }),
      openedAt: attempt.openedAt.toISOString(),
      draftCode: attempt.draftCode,
      draftSavedAt: attempt.draftSavedAt?.toISOString() ?? null,
      solvedAt: solved?.completedAt?.toISOString() ?? null,
    };
  }

  /**
   * Saves what is in the editor, without submitting it.
   *
   * Called on a debounce as the user types. Deliberately cheap and
   * deliberately silent: it writes two columns, touches none of the
   * assistance counters or timing fields, and never fails the workspace.
   * The first keystroke is recorded by `markFirstCode`, which owns that
   * measurement — an autosave must not be able to move it.
   */
  async saveDraft(userId: string, attemptId: string, code: string): Promise<void> {
    const attempt = await this.prisma.exerciseAttempt.findUnique({
      where: { id: attemptId },
      select: { userId: true },
    });

    // 404 rather than 403: confirming someone else's attempt exists is a leak.
    if (!attempt || attempt.userId !== userId) throw Problems.notFound('Attempt');

    await this.prisma.exerciseAttempt.update({
      where: { id: attemptId },
      data: { draftCode: code, draftSavedAt: new Date() },
    });
  }

  /**
   * Records the first keystroke. Time-to-first-code is one of the few honest
   * signals of whether someone knows how to begin, so it is written once and
   * never overwritten.
   */
  async markFirstCode(userId: string, attemptId: string): Promise<void> {
    const attempt = await this.prisma.exerciseAttempt.findUnique({ where: { id: attemptId } });
    if (!attempt || attempt.userId !== userId) throw Problems.notFound('Attempt');
    if (attempt.firstCodeAt !== null) return;

    const now = new Date();
    await this.prisma.exerciseAttempt.update({
      where: { id: attemptId },
      data: {
        firstCodeAt: now,
        timeToFirstCodeMs: now.getTime() - attempt.openedAt.getTime(),
      },
    });
  }

  /** Hard prerequisites gate access; soft ones never do (docs/knowledge-graph.md). */
  private async assertUnlocked(userId: string, conceptId: string): Promise<void> {
    const detail = await this.concepts.getDetail(userId, conceptId);
    if (detail.readiness.unlocked) return;

    const blockingId = detail.readiness.blockingConceptIds[0];

    // The blocker may be the previous concept in the course rather than a
    // declared prerequisite, and that one is not in `prerequisites`. Looked
    // up by id so the message names it either way: "locked until you finish
    // a prerequisite" is not something a user can act on.
    const named = blockingId
      ? ((await this.prisma.concept.findUnique({
          where: { id: blockingId },
          select: { name: true },
        })) ?? null)
      : null;

    throw Problems.exerciseLocked(named?.name ?? 'an earlier concept');
  }
}

export { computeReadiness };

/**
 * The kinds this service serves.
 *
 * Phase 9 added SYSTEM_DESIGN, INCIDENT and TERMINAL, which are graded by
 * reading prose or replaying a shell rather than by running code. They have
 * no starter code and no reference solution, so the assistance ladder has
 * nothing to reveal — ChallengesService serves them instead.
 *
 * Typed as the projection's own kind union rather than restated, so adding a
 * kind there without deciding what it means here will not compile.
 */
const CODE_EXERCISE_KINDS: StoredExercise['kind'][] = [
  'CODING',
  'RECALL',
  'DEBUGGING',
  'BLIND_CODING',
  'EXPLANATION',
  'PROJECT',
];

/** Narrows a row to something the assistance ladder can actually project. */
function isCodeExercise<T extends { kind: string }>(
  row: T,
): row is T & { kind: StoredExercise['kind'] } {
  return (CODE_EXERCISE_KINDS as readonly string[]).includes(row.kind);
}
