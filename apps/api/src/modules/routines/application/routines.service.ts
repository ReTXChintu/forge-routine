import { Injectable, Logger } from '@nestjs/common';

import { dayKey } from '@forgeroutine/utils';

import { Problems } from '../../../common/http/problem-details.js';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';
import { GenerationService } from '../../generation/application/generation.service.js';
import { RoadmapService } from '../../roadmap/application/roadmap.service.js';

export interface RoutineItemView {
  id: string;
  kind: string;
  status: string;
  minutes: number;
  title: string;
  rationale: string;
  conceptId: string | null;
  exerciseId: string | null;
}

export interface RoutineView {
  id: string;
  date: string;
  totalMinutes: number;
  completedMinutes: number;
  items: RoutineItemView[];
  /** Prompts due today. Surfaced between items, never during one. */
  recallDue: number;
}

/**
 * Today's routine (§20).
 *
 * A slice of the roadmap, not an independent plan. The roadmap answers "where
 * am I going"; this answers "what do I do now", and generating the second
 * without reference to the first produces two planners that quietly disagree
 * (docs/learning-path.md).
 *
 * Composition, in priority order:
 *   1. Reviews that are due — decay is the thing that undoes everything else.
 *   2. The next roadmap items, in order.
 *   3. Nothing else. A routine padded to fill the time is busywork.
 */
@Injectable()
export class RoutinesService {
  private readonly logger = new Logger(RoutinesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly roadmap: RoadmapService,
    private readonly generation: GenerationService,
  ) {}

  async today(userId: string): Promise<RoutineView | null> {
    const existing = await this.find(userId, startOfToday());
    return existing ? this.toView(userId, existing.id) : null;
  }

  async generate(userId: string, force = false): Promise<RoutineView> {
    // Planning the day is the natural moment to look ahead: if the user is
    // well into what has been built, start building the next technology now
    // so it is ready before they reach it. Deliberately not awaited —
    // generation takes minutes and the user wants their day.
    void this.generation.enqueueNext(userId).catch(() => undefined);

    const date = startOfToday();
    const existing = await this.find(userId, date);

    // Regenerating mid-day would discard work already marked done, so an
    // existing routine is returned untouched unless explicitly replaced.
    if (existing && !force) return this.toView(userId, existing.id);

    const preferences = await this.prisma.userPreferences.findUnique({ where: { userId } });
    const budget = preferences?.dailyMinutes ?? 45;

    const [dueReviews, roadmapItems] = await Promise.all([
      this.dueReviews(userId),
      this.nextRoadmapItems(userId),
    ]);

    const planned: PlannedItem[] = [];
    let used = 0;

    // Reviews first. A concept that decays takes the work that built it with
    // it, so review outranks new ground even when new ground is more fun.
    for (const review of dueReviews) {
      if (used + REVIEW_MINUTES > budget) break;
      planned.push({
        kind: 'REVIEW',
        minutes: REVIEW_MINUTES,
        title: `Review ${review.conceptName}`,
        rationale:
          review.overdueDays > 0
            ? `${review.overdueDays} ${review.overdueDays === 1 ? 'day' : 'days'} overdue — it will start to fade.`
            : 'Due today.',
        conceptId: review.conceptId,
        exerciseId: null,
      });
      used += REVIEW_MINUTES;
    }

    for (const item of roadmapItems) {
      if (used >= budget) break;

      // Include an item that overruns only if nothing has been planned yet:
      // a 60-minute project against a 45-minute budget is better offered than
      // silently withheld, but it must not crowd out a shorter day's work.
      const fits = used + item.estimatedMinutes <= budget;
      if (!fits && planned.length > 0) continue;

      planned.push({
        kind: item.kind,
        minutes: item.estimatedMinutes,
        title: item.title,
        rationale: item.rationale,
        conceptId: item.conceptId,
        exerciseId: item.exerciseId,
      });
      used += item.estimatedMinutes;
    }

    const routine = await this.persist(userId, date, planned, existing?.id);

    this.logger.log(
      `Routine for ${userId} on ${dayKey(date)}: ${planned.length} items, ${used}/${budget} min`,
    );

    return this.toView(userId, routine);
  }

  async setItemStatus(
    userId: string,
    itemId: string,
    status: 'IN_PROGRESS' | 'DONE' | 'SKIPPED',
  ): Promise<RoutineItemView> {
    const item = await this.prisma.routineItem.findUnique({
      where: { id: itemId },
      include: { routine: { select: { userId: true, id: true } } },
    });

    // 404 rather than 403: confirming someone else's item exists is a leak.
    if (!item || item.routine.userId !== userId) throw Problems.notFound('Routine item');

    const updated = await this.prisma.routineItem.update({
      where: { id: itemId },
      data: { status },
    });

    await this.recomputeCompleted(item.routine.id);

    return toItemView(updated);
  }

  // -- Composition ----------------------------------------------------------

  private async dueReviews(userId: string) {
    const schedules = await this.prisma.reviewSchedule.findMany({
      where: { userId, frozenAt: null, dueAt: { lte: new Date() } },
      orderBy: { dueAt: 'asc' },
      take: 4,
      include: { concept: { select: { id: true, name: true } } },
    });

    const now = Date.now();
    return schedules.map((s) => ({
      conceptId: s.concept.id,
      conceptName: s.concept.name,
      overdueDays: Math.max(0, Math.floor((now - s.dueAt.getTime()) / 86_400_000)),
    }));
  }

  private async nextRoadmapItems(userId: string) {
    const roadmap = await this.roadmap.getActive(userId);
    if (!roadmap) return [];

    return roadmap.phases
      .flatMap((phase) => phase.items)
      .filter((item) => item.status === 'PENDING' || item.status === 'IN_PROGRESS')
      .slice(0, 8);
  }

  private async persist(
    userId: string,
    date: Date,
    planned: readonly PlannedItem[],
    replaceId?: string,
  ): Promise<string> {
    return this.prisma.$transaction(async (tx) => {
      if (replaceId) await tx.routine.delete({ where: { id: replaceId } });

      const routine = await tx.routine.create({
        data: {
          userId,
          date,
          totalMinutes: planned.reduce((sum, i) => sum + i.minutes, 0),
          generatedBy: 'rules',
        },
      });

      if (planned.length > 0) {
        await tx.routineItem.createMany({
          data: planned.map((item, index) => ({
            routineId: routine.id,
            kind: item.kind as 'LEARN',
            minutes: item.minutes,
            orderIndex: index,
            title: item.title,
            rationale: item.rationale,
            conceptId: item.conceptId,
            exerciseId: item.exerciseId,
          })),
        });
      }

      return routine.id;
    });
  }

  private async recomputeCompleted(routineId: string): Promise<void> {
    const items = await this.prisma.routineItem.findMany({
      where: { routineId },
      select: { minutes: true, status: true },
    });

    await this.prisma.routine.update({
      where: { id: routineId },
      data: {
        completedMinutes: items
          .filter((i) => i.status === 'DONE')
          .reduce((sum, i) => sum + i.minutes, 0),
      },
    });
  }

  private async find(userId: string, date: Date) {
    return this.prisma.routine.findUnique({
      where: { userId_date: { userId, date } },
      select: { id: true },
    });
  }

  private async toView(userId: string, routineId: string): Promise<RoutineView> {
    const [routine, recallDue] = await Promise.all([
      this.prisma.routine.findUnique({
        where: { id: routineId },
        include: { items: { orderBy: { orderIndex: 'asc' } } },
      }),
      this.prisma.reviewSchedule.count({
        where: { userId, frozenAt: null, dueAt: { lte: new Date() } },
      }),
    ]);

    if (!routine) throw Problems.notFound('Routine');

    return {
      id: routine.id,
      date: routine.date.toISOString(),
      totalMinutes: routine.totalMinutes,
      completedMinutes: routine.completedMinutes,
      items: routine.items.map(toItemView),
      recallDue,
    };
  }
}

interface PlannedItem {
  kind: string;
  minutes: number;
  title: string;
  rationale: string;
  conceptId: string | null;
  exerciseId: string | null;
}

const REVIEW_MINUTES = 8;

function startOfToday(): Date {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function toItemView(item: {
  id: string;
  kind: string;
  status: string;
  minutes: number;
  title: string;
  rationale: string;
  conceptId: string | null;
  exerciseId: string | null;
}): RoutineItemView {
  return {
    id: item.id,
    kind: item.kind,
    status: item.status,
    minutes: item.minutes,
    title: item.title,
    rationale: item.rationale,
    conceptId: item.conceptId,
    exerciseId: item.exerciseId,
  };
}
