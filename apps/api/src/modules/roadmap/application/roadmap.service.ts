import { Injectable, Logger } from '@nestjs/common';

import {
  type BuiltRoadmap,
  type GraphEdge,
  type RoadmapConcept,
  type RoadmapSkill,
  type RoadmapTechnology,
  buildRoadmap,
} from '@forgeroutine/curriculum';
import type { Prisma } from '@forgeroutine/database';

import { Problems } from '../../../common/http/problem-details.js';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';

export interface RoadmapItemView {
  id: string;
  kind: string;
  status: string;
  title: string;
  rationale: string;
  estimatedMinutes: number;
  conceptId: string | null;
  exerciseId: string | null;
}

export interface RoadmapPhaseView {
  id: string;
  orderIndex: number;
  title: string;
  goal: string;
  estimatedMinutes: number;
  items: RoadmapItemView[];
  doneCount: number;
}

export interface RoadmapView {
  id: string;
  version: number;
  status: string;
  generatedBy: string;
  totalMinutes: number;
  completedMinutes: number;
  phases: RoadmapPhaseView[];
  /** The first item that is neither done nor skipped. The "you are here" marker. */
  currentItemId: string | null;
}

/**
 * Builds, stores and reads a user's roadmap (docs/learning-path.md).
 *
 * The rule that shapes this whole service: a roadmap is a *traversal* of the
 * knowledge graph, not a copy of it. Items reference concept and exercise ids.
 * Regenerating a roadmap must therefore never lose progress, which is what
 * `carryOverCompleted` is for.
 */
@Injectable()
export class RoadmapService {
  private readonly logger = new Logger(RoadmapService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Rebuilds the roadmap from the user's current universe and skills.
   *
   * Uses the rule-based builder. The AI planner will layer on top of this
   * later; until then — and whenever AI is unavailable or over budget — this
   * is what runs (docs/ai-architecture.md).
   */
  async regenerate(userId: string): Promise<RoadmapView> {
    const built = await this.build(userId);
    const roadmapId = await this.persist(userId, built);
    return this.get(userId, roadmapId);
  }

  async getActive(userId: string): Promise<RoadmapView | null> {
    const roadmap = await this.prisma.roadmap.findFirst({
      where: { userId, status: { in: ['ACTIVE', 'BUILDING'] } },
      orderBy: { version: 'desc' },
      select: { id: true },
    });

    return roadmap ? this.get(userId, roadmap.id) : null;
  }

  async setItemStatus(
    userId: string,
    itemId: string,
    status: 'PENDING' | 'IN_PROGRESS' | 'DONE' | 'SKIPPED',
  ): Promise<RoadmapItemView> {
    const item = await this.prisma.roadmapItem.findUnique({
      where: { id: itemId },
      include: { phase: { include: { roadmap: { select: { userId: true } } } } },
    });

    // 404 rather than 403: confirming someone else's item exists is a leak.
    if (!item || item.phase.roadmap.userId !== userId) throw Problems.notFound('Roadmap item');

    const updated = await this.prisma.roadmapItem.update({
      where: { id: itemId },
      data: { status, completedAt: status === 'DONE' ? new Date() : null },
    });

    return toItemView(updated);
  }

  // -- Building -------------------------------------------------------------

  private async build(userId: string): Promise<BuiltRoadmap> {
    const [userTechnologies, preferences] = await Promise.all([
      this.prisma.userTechnology.findMany({
        where: { userId, status: 'ACTIVE' },
        include: { technology: true },
      }),
      this.prisma.userPreferences.findUnique({ where: { userId } }),
    ]);

    const technologyIds = userTechnologies.map((t) => t.technologyId);

    const [concepts, edges, skills] = await Promise.all([
      this.prisma.concept.findMany({
        where: { technologyId: { in: technologyIds }, archivedAt: null },
        include: {
          exercises: {
            where: { archivedAt: null },
            select: { id: true, kind: true, difficulty: true, estimatedMinutes: true },
          },
        },
        orderBy: { orderIndex: 'asc' },
      }),
      // The whole edge set: cross-technology prerequisites are exactly what
      // decides which technology comes first.
      this.prisma.conceptPrerequisite.findMany({
        select: { conceptId: true, prerequisiteId: true, strength: true },
      }),
      this.prisma.skill.findMany({
        where: { userId },
        select: { conceptId: true, conceptMastery: true, codingAbility: true },
      }),
    ]);

    const technologies: RoadmapTechnology[] = userTechnologies.map((t) => ({
      technologyId: t.technologyId,
      slug: t.technology.slug,
      name: t.technology.name,
      priority: t.priority,
      targetProficiency: t.targetProficiency,
      interviewImportance: t.interviewImportance,
    }));

    const roadmapConcepts: RoadmapConcept[] = concepts.map((c) => ({
      id: c.id,
      technologyId: c.technologyId,
      slug: c.slug,
      name: c.name,
      difficulty: c.difficulty,
      orderIndex: c.orderIndex,
      exercises: c.exercises.map((e) => ({
        id: e.id,
        kind: e.kind,
        difficulty: e.difficulty,
        estimatedMinutes: e.estimatedMinutes,
      })),
    }));

    const graphEdges: GraphEdge[] = edges.map((e) => ({
      conceptId: e.conceptId,
      prerequisiteId: e.prerequisiteId,
      strength: e.strength,
    }));

    const skillMap = new Map<string, RoadmapSkill>(
      skills.map((s) => [
        s.conceptId,
        { conceptMastery: s.conceptMastery, codingAbility: s.codingAbility },
      ]),
    );

    return buildRoadmap({
      technologies,
      concepts: roadmapConcepts,
      edges: graphEdges,
      skills: skillMap,
      preferences: {
        dailyMinutes: preferences?.dailyMinutes ?? 45,
        primaryGoal: preferences?.primaryGoal ?? 'CODING',
        interviewTarget: preferences?.interviewTarget ?? 'MID',
        daysUntilInterview: daysUntil(preferences?.interviewDate ?? null),
      },
    });
  }

  private async persist(userId: string, built: BuiltRoadmap): Promise<string> {
    // Read the previous roadmap's finished work before replacing it, so a
    // replan never silently resets progress.
    const completed = await this.completedKeys(userId);

    return this.prisma.$transaction(async (tx) => {
      const latest = await tx.roadmap.findFirst({
        where: { userId },
        orderBy: { version: 'desc' },
        select: { version: true },
      });

      await tx.roadmap.updateMany({
        where: { userId, status: { in: ['ACTIVE', 'BUILDING'] } },
        data: { status: 'SUPERSEDED' },
      });

      const roadmap = await tx.roadmap.create({
        data: {
          userId,
          version: (latest?.version ?? 0) + 1,
          status: 'ACTIVE',
          generatedBy: built.generatedBy,
          technologyOrder: built.technologyOrder,
          totalMinutes: built.totalMinutes,
        },
      });

      for (const [phaseIndex, phase] of built.phases.entries()) {
        const created = await tx.roadmapPhase.create({
          data: {
            roadmapId: roadmap.id,
            orderIndex: phaseIndex,
            title: phase.title,
            goal: phase.goal,
            technologyId: phase.technologyId,
            estimatedMinutes: phase.estimatedMinutes,
          },
        });

        if (phase.items.length === 0) continue;

        await tx.roadmapItem.createMany({
          data: phase.items.map((item, itemIndex) => ({
            phaseId: created.id,
            orderIndex: itemIndex,
            kind: item.kind,
            status: resolveStatus(item, completed),
            conceptId: item.conceptId,
            exerciseId: item.exerciseId,
            title: item.title,
            rationale: item.rationale,
            estimatedMinutes: item.estimatedMinutes,
            completedAt: completed.has(itemKey(item)) ? new Date() : null,
          })),
        });
      }

      this.logger.log(
        `Roadmap v${roadmap.version} for ${userId}: ${built.phases.length} phases, ` +
          `${built.totalMinutes} min, ${completed.size} completed items carried over`,
      );

      return roadmap.id;
    });
  }

  /**
   * Work already finished, keyed by what the item *points at* rather than by
   * item id. Item ids change on every regeneration; concept and exercise ids
   * do not, which is what makes progress survivable across a replan.
   */
  private async completedKeys(userId: string): Promise<Set<string>> {
    const previous = await this.prisma.roadmapItem.findMany({
      where: {
        phase: { roadmap: { userId } },
        status: { in: ['DONE', 'SKIPPED'] },
      },
      select: { kind: true, conceptId: true, exerciseId: true, status: true },
    });

    return new Set(previous.map((i) => itemKey(i)));
  }

  // -- Reading --------------------------------------------------------------

  private async get(userId: string, roadmapId: string): Promise<RoadmapView> {
    const roadmap = await this.prisma.roadmap.findUnique({
      where: { id: roadmapId },
      include: {
        phases: {
          orderBy: { orderIndex: 'asc' },
          include: { items: { orderBy: { orderIndex: 'asc' } } },
        },
      },
    });

    if (!roadmap || roadmap.userId !== userId) throw Problems.notFound('Roadmap');

    const phases: RoadmapPhaseView[] = roadmap.phases.map((phase) => ({
      id: phase.id,
      orderIndex: phase.orderIndex,
      title: phase.title,
      goal: phase.goal,
      estimatedMinutes: phase.estimatedMinutes,
      items: phase.items.map(toItemView),
      doneCount: phase.items.filter((i) => i.status === 'DONE').length,
    }));

    const allItems = phases.flatMap((p) => p.items);
    const current = allItems.find((i) => i.status !== 'DONE' && i.status !== 'SKIPPED');

    return {
      id: roadmap.id,
      version: roadmap.version,
      status: roadmap.status,
      generatedBy: roadmap.generatedBy,
      totalMinutes: roadmap.totalMinutes,
      completedMinutes: allItems
        .filter((i) => i.status === 'DONE')
        .reduce((sum, i) => sum + i.estimatedMinutes, 0),
      phases,
      currentItemId: current?.id ?? null,
    };
  }
}

// -- Helpers ----------------------------------------------------------------

interface KeyableItem {
  kind: string;
  conceptId: string | null;
  exerciseId: string | null;
}

function itemKey(item: KeyableItem): string {
  return `${item.kind}:${item.conceptId ?? ''}:${item.exerciseId ?? ''}`;
}

function resolveStatus(
  item: {
    kind: string;
    conceptId: string | null;
    exerciseId: string | null;
    awaitingContent: boolean;
  },
  completed: ReadonlySet<string>,
): 'PENDING' | 'DONE' | 'AWAITING_CONTENT' {
  if (completed.has(itemKey(item))) return 'DONE';
  return item.awaitingContent ? 'AWAITING_CONTENT' : 'PENDING';
}

function toItemView(item: {
  id: string;
  kind: string;
  status: string;
  title: string;
  rationale: string;
  estimatedMinutes: number;
  conceptId: string | null;
  exerciseId: string | null;
}): RoadmapItemView {
  return {
    id: item.id,
    kind: item.kind,
    status: item.status,
    title: item.title,
    rationale: item.rationale,
    estimatedMinutes: item.estimatedMinutes,
    conceptId: item.conceptId,
    exerciseId: item.exerciseId,
  };
}

function daysUntil(date: Date | null): number | null {
  if (!date) return null;
  return Math.max(0, Math.ceil((date.getTime() - Date.now()) / 86_400_000));
}

export type { Prisma };
