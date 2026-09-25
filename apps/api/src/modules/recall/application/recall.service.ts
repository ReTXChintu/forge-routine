import { Injectable } from '@nestjs/common';

import {
  INITIAL_REVIEW_STATE,
  gradeFromPerformance,
  scheduleNextReview,
} from '@forgeroutine/utils';

import { Problems } from '../../../common/http/problem-details.js';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';
import { SkillsService } from '../../skills/application/skills.service.js';

export interface RecallPromptView {
  id: string;
  conceptId: string;
  conceptName: string;
  technologyName: string;
  prompt: string;
  options: string[];
  /** Never includes the answer. The client cannot mark its own homework. */
}

export interface RecallAnswerResult {
  correct: boolean;
  correctIndex: number;
  explanation: string;
  /** When the concept will next come round. */
  nextDueAt: string;
}

/**
 * Recall prompts (docs/learning-path.md).
 *
 * Short questions surfaced between activities, never during coding. An
 * interruption mid-problem destroys the exact state this product exists to
 * build, and teaches the user to dismiss prompts unread — enforcing that is
 * the client's job, but this service never surfaces one unprompted either.
 *
 * Selection comes from the spaced-repetition schedule, so prompts are *due*
 * rather than random. They are the only evidence `recallStrength` and
 * `retention` ever receive.
 */
@Injectable()
export class RecallService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly skills: SkillsService,
  ) {}

  /**
   * Prompts the user is due for, most overdue first.
   *
   * Falls back to concepts they have practised but never had a question on,
   * so a new user is not told there is nothing to review when in fact nothing
   * has been scheduled yet.
   */
  async due(userId: string, limit = 3, conceptId?: string): Promise<RecallPromptView[]> {
    // A routine RECALL item asks for one concept's questions specifically,
    // and wants several of them rather than the one-per-concept spread the
    // between-items prompt uses. That is a different question, so it takes a
    // different path rather than being squeezed through the scheduler.
    if (conceptId) return this.forConcept(conceptId, limit);

    const dueSchedules = await this.prisma.reviewSchedule.findMany({
      where: { userId, frozenAt: null, dueAt: { lte: new Date() } },
      orderBy: { dueAt: 'asc' },
      take: limit * 3,
      select: { conceptId: true },
    });

    let conceptIds = dueSchedules.map((s) => s.conceptId);

    if (conceptIds.length === 0) {
      const practised = await this.prisma.skill.findMany({
        where: { userId, attempts: { gt: 0 } },
        orderBy: { recallStrength: 'asc' },
        take: limit * 3,
        select: { conceptId: true },
      });
      conceptIds = practised.map((s) => s.conceptId);
    }

    if (conceptIds.length === 0) return [];

    const questions = await this.prisma.conceptQuestion.findMany({
      // Multiple choice only. A recall prompt is answered in fifteen
      // seconds between activities; a written question needs a page and a
      // model answer, and belongs in the practice set rather than here.
      where: { conceptId: { in: conceptIds }, kind: 'MCQ', archivedAt: null },
      include: {
        concept: {
          select: { id: true, name: true, technology: { select: { name: true } } },
        },
      },
    });

    // One question per concept: three prompts about the same idea is an
    // interrogation, not a check.
    const byConcept = new Map<string, (typeof questions)[number]>();
    for (const question of questions) {
      if (!byConcept.has(question.conceptId)) byConcept.set(question.conceptId, question);
    }

    return [...byConcept.values()].slice(0, limit).map((question) => ({
      id: question.id,
      conceptId: question.conceptId,
      conceptName: question.concept.name,
      technologyName: question.concept.technology.name,
      prompt: question.prompt,
      options: question.options,
    }));
  }

  /**
   * Every question on one concept, up to `limit`.
   *
   * No scheduling filter: the user chose this concept by opening the item,
   * and refusing to show questions because the spaced-repetition clock says
   * "not yet" would be the product overruling a deliberate request.
   */
  private async forConcept(conceptId: string, limit: number): Promise<RecallPromptView[]> {
    const questions = await this.prisma.conceptQuestion.findMany({
      where: { conceptId, kind: 'MCQ', archivedAt: null },
      orderBy: { difficulty: 'asc' },
      take: limit,
      include: {
        concept: {
          select: { id: true, name: true, technology: { select: { name: true } } },
        },
      },
    });

    return questions.map((question) => ({
      id: question.id,
      conceptId: question.conceptId,
      conceptName: question.concept.name,
      technologyName: question.concept.technology.name,
      prompt: question.prompt,
      options: question.options,
    }));
  }

  async answer(
    userId: string,
    questionId: string,
    selectedIndex: number,
  ): Promise<RecallAnswerResult> {
    const question = await this.prisma.conceptQuestion.findUnique({
      where: { id: questionId },
      select: {
        id: true,
        conceptId: true,
        kind: true,
        correctIndex: true,
        explanation: true,
        options: true,
      },
    });

    if (!question) throw Problems.notFound('Question');
    // A written question has no options, so an index into them means
    // nothing — and defaulting to correctIndex 0 would mark it right.
    if (question.kind !== 'MCQ') {
      throw Problems.badRequest('That question is answered in writing, not by picking an option.');
    }

    const correct = selectedIndex === question.correctIndex;

    const nextDueAt = await this.recordAnswer(userId, question.conceptId, correct);

    return {
      correct,
      correctIndex: question.correctIndex,
      // Shown either way. Being right for the wrong reason is still worth
      // correcting, and the explanation is where the learning is.
      explanation: question.explanation,
      nextDueAt: nextDueAt.toISOString(),
    };
  }

  private async recordAnswer(userId: string, conceptId: string, correct: boolean): Promise<Date> {
    const [existing, skill] = await Promise.all([
      this.prisma.reviewSchedule.findUnique({
        where: { userId_conceptId: { userId, conceptId } },
      }),
      this.prisma.skill.findUnique({
        where: { userId_conceptId: { userId, conceptId } },
        select: { conceptMastery: true },
      }),
    ]);

    const grade = gradeFromPerformance({
      passed: correct,
      testsPassed: correct ? 1 : 0,
      testsTotal: 1,
      aiRequestCount: 0,
      solutionRevealed: false,
    });

    const next = scheduleNextReview(
      existing
        ? {
            easeFactor: existing.easeFactor,
            intervalDays: existing.intervalDays,
            repetitions: existing.repetitions,
            lapses: existing.lapses,
          }
        : INITIAL_REVIEW_STATE,
      grade,
      { mastery: skill?.conceptMastery ?? 0.5 },
    );

    await this.prisma.reviewSchedule.upsert({
      where: { userId_conceptId: { userId, conceptId } },
      create: {
        userId,
        conceptId,
        easeFactor: next.easeFactor,
        intervalDays: next.intervalDays,
        repetitions: next.repetitions,
        lapses: next.lapses,
        dueAt: next.dueAt,
        lastReviewedAt: new Date(),
      },
      update: {
        easeFactor: next.easeFactor,
        intervalDays: next.intervalDays,
        repetitions: next.repetitions,
        lapses: next.lapses,
        dueAt: next.dueAt,
        lastReviewedAt: new Date(),
      },
    });

    // A wrong answer schedules, it does not punish. The evidence is real but
    // one question is weak evidence, so the learning rate is low.
    await this.skills.applyEvidence({
      userId,
      conceptId,
      cause: 'REVIEW',
      note: correct ? 'Recall prompt answered correctly' : 'Recall prompt missed',
      learningRate: 0.15,
      evidence: {
        recallStrength: correct ? 1 : 0,
        retention: correct ? 1 : 0,
      },
    });

    return next.dueAt;
  }
}
