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
import { projectExercise } from '../domain/exercise-view.js';

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
      where: { conceptId, archivedAt: null },
      include: { testCases: { select: { name: true, hidden: true } } },
      orderBy: { difficulty: 'asc' },
    });

    return rows.map((row) => projectExercise(row, { level, blindMode: false }));
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

    await this.assertUnlocked(userId, exercise.conceptId);

    const level =
      input.assistanceLevel ?? (await this.skills.getAssistanceLevel(userId, exercise.conceptId));

    // Reuse an open attempt rather than creating a second one: a page refresh
    // must not reset the clock or fork the assistance counters.
    const existing = await this.prisma.exerciseAttempt.findFirst({
      where: { userId, exerciseId, outcome: 'IN_PROGRESS' },
      orderBy: { createdAt: 'desc' },
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
        },
      }));

    return {
      attemptId: attempt.id,
      exercise: projectExercise(exercise, {
        level: attempt.assistanceLevel as AssistanceLevel,
        blindMode: attempt.blindMode,
      }),
      openedAt: attempt.openedAt.toISOString(),
    };
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
    const blocking = detail.prerequisites.find((p) => p.conceptId === blockingId);

    throw Problems.exerciseLocked(blocking?.name ?? 'a prerequisite');
  }
}

export { computeReadiness };
