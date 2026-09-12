import { Injectable } from '@nestjs/common';
import type {
  DashboardOverview,
  IndependentCodingScore,
  NextAction,
} from '@forgeroutine/shared-types';
import {
  type AttemptEvidence,
  computeIndependentCodingScore,
  greetingFor,
  mean,
} from '@forgeroutine/utils';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';
import { SkillsService } from '../../skills/application/skills.service.js';

@Injectable()
export class ProgressService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly skills: SkillsService,
  ) {}

  /**
   * The Independent Coding Score (docs/coding-muscle.md).
   *
   * Built only from server-observed facts. Client-reported signals are read for
   * coaching but never enter the score, because a score that can be faked is
   * worse than no score at all.
   */
  async getIndependence(userId: string, windowDays = 30): Promise<IndependentCodingScore> {
    const now = new Date();
    const windowMs = windowDays * 86_400_000;
    // Two windows: the current one, and the one before it for the delta.
    const since = new Date(now.getTime() - windowMs * 2);

    const attempts = await this.prisma.exerciseAttempt.findMany({
      where: {
        userId,
        outcome: { in: ['PASSED', 'FAILED'] },
        completedAt: { not: null, gte: since },
      },
      orderBy: { completedAt: 'desc' },
      select: {
        id: true,
        assistanceLevel: true,
        outcome: true,
        aiRequestCount: true,
        solutionRevealed: true,
        timeToFirstCodeMs: true,
        completedAt: true,
        exercise: { select: { conceptId: true } },
      },
    });

    const evidence = this.toEvidence(attempts);
    const cutoff = now.getTime() - windowMs;

    const previous = computeIndependentCodingScore(
      evidence.filter((a) => a.completedAt.getTime() < cutoff),
      { now: new Date(cutoff), windowDays },
    );

    return computeIndependentCodingScore(evidence, {
      now,
      windowDays,
      previousScore: previous.score,
    });
  }

  async getOverview(userId: string): Promise<DashboardOverview> {
    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);

    const [independence, weakest, preferences, todaySessions, activeTechnologies] =
      await Promise.all([
        this.getIndependence(userId),
        this.skills.getWeakest(userId, 3),
        this.prisma.userPreferences.findUnique({ where: { userId } }),
        this.prisma.learningSession.findMany({
          where: { userId, startedAt: { gte: startOfToday } },
          select: { durationMs: true },
        }),
        this.prisma.userTechnology.findMany({
          where: { userId, status: 'ACTIVE' },
          orderBy: { priority: 'desc' },
          take: 2,
          include: { technology: { select: { name: true } } },
        }),
      ]);

    const todayMinutesDone = Math.round(
      todaySessions.reduce((sum, s) => sum + (s.durationMs ?? 0), 0) / 60_000,
    );

    return {
      greeting: greetingFor(now),
      todayMinutesDone,
      todayMinutesTarget: preferences?.dailyMinutes ?? 45,
      independence,
      interviewReadiness: await this.interviewReadiness(userId),
      currentFocus: activeTechnologies.map((t) => t.technology.name),
      weakestSkills: weakest,
      routine: null,
      nextAction: await this.nextAction(userId),
    };
  }

  private async interviewReadiness(userId: string): Promise<number | null> {
    const skills = await this.prisma.skill.findMany({
      where: { userId, attempts: { gt: 0 } },
      select: { interviewReadiness: true },
    });

    // No evidence means no number. A confident 0% for a new user is both wrong
    // and demoralising.
    if (skills.length === 0) return null;
    return mean(skills.map((s) => s.interviewReadiness));
  }

  /**
   * The single most useful thing to do next.
   *
   * Deterministic and rule-based: due review first, then the weakest concept, then
   * the first unstarted one. The AI planner (Phase 5) will replace the ordering,
   * but this must keep working when AI is unavailable.
   */
  private async nextAction(userId: string): Promise<NextAction | null> {
    const due = await this.prisma.reviewSchedule.findFirst({
      where: { userId, frozenAt: null, dueAt: { lte: new Date() } },
      orderBy: { dueAt: 'asc' },
      include: { concept: { select: { id: true, name: true } } },
    });

    if (due) {
      return {
        kind: 'REVIEW',
        title: `Review ${due.concept.name}`,
        rationale: 'This is due for review and will start to fade otherwise.',
        conceptId: due.concept.id,
        exerciseId: null,
        estimatedMinutes: 10,
      };
    }

    const weakest = await this.prisma.skill.findFirst({
      where: { userId, attempts: { gt: 0 } },
      orderBy: { codingAbility: 'asc' },
      include: {
        concept: {
          select: {
            id: true,
            name: true,
            exercises: { where: { archivedAt: null }, take: 1, select: { id: true } },
          },
        },
      },
    });

    if (weakest && weakest.codingAbility < 0.6) {
      return {
        kind: 'CODE',
        title: `Write ${weakest.concept.name} from scratch`,
        rationale: `You understand this better than you can currently implement it (${Math.round(
          weakest.conceptMastery * 100,
        )}% understanding vs ${Math.round(weakest.codingAbility * 100)}% implementation).`,
        conceptId: weakest.concept.id,
        exerciseId: weakest.concept.exercises[0]?.id ?? null,
        estimatedMinutes: 20,
      };
    }

    const unstarted = await this.prisma.concept.findFirst({
      where: {
        archivedAt: null,
        technology: { userTechnologies: { some: { userId, status: 'ACTIVE' } } },
        skills: { none: { userId } },
      },
      orderBy: [{ difficulty: 'asc' }, { orderIndex: 'asc' }],
      select: {
        id: true,
        name: true,
        exercises: { where: { archivedAt: null }, take: 1, select: { id: true } },
      },
    });

    if (unstarted) {
      return {
        kind: 'LEARN',
        title: `Start ${unstarted.name}`,
        rationale: 'Next in your active technologies, and nothing is blocking it.',
        conceptId: unstarted.id,
        exerciseId: unstarted.exercises[0]?.id ?? null,
        estimatedMinutes: 15,
      };
    }

    return null;
  }

  private toEvidence(
    attempts: {
      id: string;
      assistanceLevel: number;
      outcome: string;
      aiRequestCount: number;
      solutionRevealed: boolean;
      timeToFirstCodeMs: number | null;
      completedAt: Date | null;
      exercise: { conceptId: string };
    }[],
  ): AttemptEvidence[] {
    // A concept counts as a successful reattempt when an earlier attempt failed
    // and a later one passed unaided. Attempts arrive newest-first.
    const failedConcepts = new Set<string>();
    const evidence: AttemptEvidence[] = [];

    for (const attempt of [...attempts].reverse()) {
      const conceptId = attempt.exercise.conceptId;
      const passed = attempt.outcome === 'PASSED';
      const isSuccessfulReattempt =
        passed && failedConcepts.has(conceptId) && attempt.aiRequestCount === 0;

      if (!passed) failedConcepts.add(conceptId);

      evidence.push({
        attemptId: attempt.id,
        conceptId,
        completedAt: attempt.completedAt ?? new Date(),
        assistanceLevel: attempt.assistanceLevel as AttemptEvidence['assistanceLevel'],
        passed,
        aiRequestCount: attempt.aiRequestCount,
        solutionRevealed: attempt.solutionRevealed,
        timeToFirstCodeMs: attempt.timeToFirstCodeMs,
        isSuccessfulReattempt,
      });
    }

    return evidence;
  }
}
