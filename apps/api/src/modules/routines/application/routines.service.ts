import { Inject, Injectable, Logger } from '@nestjs/common';

import type { AppConfig } from '@forgeroutine/config';
import { currentConcept } from '@forgeroutine/curriculum';
import type { Prisma } from '@forgeroutine/database';
import { learningDate, learningDayKey } from '@forgeroutine/utils';

import { Problems } from '../../../common/http/problem-details.js';
import { APP_CONFIG } from '../../../infrastructure/config/config.module.js';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';
import { GenerationService } from '../../generation/application/generation.service.js';
import { RoadmapService } from '../../roadmap/application/roadmap.service.js';

/** What to offer after a concept is finished. */
export interface NextUpView {
  /** Where it came from, so the panel can say why it is being offered. */
  source: 'routine' | 'course';
  title: string;
  rationale: string;
  conceptId: string | null;
  exerciseId: string | null;
  kind: string;
}

export interface RoutineItemView {
  id: string;
  kind: string;
  status: string;
  minutes: number;
  title: string;
  rationale: string;
  conceptId: string | null;
  exerciseId: string | null;
  /** RECALL items: how many questions are waiting on that concept. */
  questionCount: number;
  /** The day this was first planned for, when it has been carried forward. */
  carriedFrom: string | null;
}

export interface RoutineView {
  id: string;
  date: string;
  totalMinutes: number;
  completedMinutes: number;
  items: RoutineItemView[];
  /** Prompts due today. Surfaced between items, never during one. */
  recallDue: number;
  /** How many of today's items are unfinished work from an earlier day. */
  carriedCount: number;
}

/**
 * Today's routine (§20).
 *
 * A slice of the roadmap, not an independent plan. The roadmap answers "where
 * am I going"; this answers "what do I do now", and generating the second
 * without reference to the first produces two planners that quietly disagree
 * (docs/learning-path.md).
 *
 * Entirely rule-based. There is no model call anywhere in this file and
 * there should never be one: the inputs are a time budget, an ordered
 * roadmap and a set of due dates, and arithmetic answers that question
 * exactly. Asking a model to do it would cost money to introduce variance
 * into a plan whose whole value is that it is predictable.
 *
 * Composition, in priority order:
 *   1. Whatever was not finished on an earlier day. Nothing is ever
 *      dropped, so this comes first and can fill the day on its own.
 *   2. Reviews that are due — decay undoes everything else.
 *   3. DSA — one concept and one problem, every single day.
 *   4. The next roadmap concept, its questions, then its exercises.
 *   5. Nothing else. A routine padded to fill the time is busywork.
 *
 * The backlog throttles new material rather than stacking on top of it: a
 * user three days behind gets three days of unfinished work and no new
 * ground until it is cleared. That is the point — the alternative is a
 * plan that quietly forgives, which is the habit this exists to replace.
 */
@Injectable()
export class RoutinesService {
  private readonly logger = new Logger(RoutinesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly roadmap: RoadmapService,
    private readonly generation: GenerationService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** The zone every "today" here is measured in. */
  private get zone(): string {
    return this.config.env.APP_TIMEZONE;
  }

  /**
   * Which day it is, for planning purposes.
   *
   * A learning day runs 06:00 to 06:00, so work at 01:00 belongs to the
   * evening it started in. Midnight is the middle of a session, not the gap
   * between two: rolling over there marked a session half finished, carried
   * its own second half forward as a backlog, and reset the day's minutes
   * while the user was still typing.
   */
  private learningToday(): Date {
    return learningDate(new Date(), this.zone);
  }

  /**
   * Today's plan, built on first look.
   *
   * It used to return null until the user pressed "Plan today", which asked
   * them to make a decision the app had already made: the budget is in their
   * preferences, the order is in the roadmap, and the due dates are in the
   * schedule. There was nothing left for the button to ask.
   */
  async today(userId: string): Promise<RoutineView> {
    const existing = await this.find(userId, this.learningToday());
    if (existing) return this.toView(userId, existing.id);

    return this.generate(userId);
  }

  async generate(userId: string, force = false): Promise<RoutineView> {
    // Planning the day is the natural moment to look ahead: if the user is
    // well into what has been built, start building the next technology now
    // so it is ready before they reach it. Deliberately not awaited —
    // generation takes minutes and the user wants their day. Does nothing
    // at all when AI is switched off.
    void this.generation.enqueueNext(userId).catch(() => undefined);

    const date = this.learningToday();
    const existing = await this.find(userId, date);

    // Regenerating mid-day would discard work already marked done, so an
    // existing routine is returned untouched unless explicitly replaced.
    if (existing && !force) return this.toView(userId, existing.id);

    const preferences = await this.prisma.userPreferences.findUnique({ where: { userId } });
    const budget = preferences?.dailyMinutes ?? 45;

    const planned: PlannedItem[] = [];
    const claimed = new Set<string>();

    const [carried, dueReviews, dsa, roadmapItems] = await Promise.all([
      this.unfinishedBefore(userId, date),
      this.dueReviews(userId),
      this.dsaBlock(userId),
      this.nextRoadmapItems(userId),
    ]);

    // -- 0. Yesterday, and every day before it ----------------------------
    // Ahead of the budget check and never dropped. This is what makes the
    // work compulsory: an unfinished day pushes forward, so falling behind
    // costs new ground rather than costing the material itself.
    let used = 0;
    for (const item of carried) {
      planned.push(item);
      used += item.minutes;
      if (item.conceptId) claimed.add(item.conceptId);
      if (item.exerciseId) claimed.add(item.exerciseId);
    }

    // -- 1. Reviews -------------------------------------------------------
    // A concept that decays takes the work that built it with it, so review
    // outranks new ground even when new ground is more interesting.
    for (const review of dueReviews) {
      if (claimed.has(review.conceptId)) continue;
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
        questionCount: 0,
        carriedFrom: null,
      });
      used += REVIEW_MINUTES;
    }

    // -- 2. DSA -----------------------------------------------------------
    // Added before the budget check and never dropped for want of minutes.
    // The point of a daily problem is that it is daily; a plan that skips it
    // on a busy day is a plan that skips it most days.
    for (const item of dsa) {
      // Already carried from an earlier day; planning it twice would show
      // the same problem in two rows.
      if (item.exerciseId && claimed.has(item.exerciseId)) continue;
      if (item.conceptId && item.kind === 'LEARN' && claimed.has(item.conceptId)) continue;

      planned.push(item);
      used += item.minutes;
      if (item.conceptId) claimed.add(item.conceptId);
      if (item.exerciseId) claimed.add(item.exerciseId);
    }

    // -- 3. The roadmap ---------------------------------------------------
    for (const item of roadmapItems) {
      if (used >= budget) break;
      if (item.exerciseId && claimed.has(item.exerciseId)) continue;

      // Include an item that overruns only if nothing has been planned yet:
      // a 60-minute project against a 45-minute budget is better offered
      // than silently withheld, but it must not crowd out a shorter day.
      const fits = used + item.estimatedMinutes <= budget;
      if (!fits && planned.length > 0) continue;

      // Narrowed rather than cast. The two enums match today, and the cast
      // that used to sit here claimed every roadmap kind was LEARN — which
      // is how PROJECT items reached the database and failed on insert.
      const kind = toRoutineKind(item.kind);
      if (!kind) {
        this.logger.warn(`Unknown roadmap item kind "${item.kind}"; leaving it out of today`);
        continue;
      }

      // A concept is one row covering both halves of its page — read it,
      // then answer questions and write code about it. It used to be up to
      // three rows, and a routine listing "5 questions on closures" as its
      // own line was showing the user the inside of a task rather than the
      // task. Practice minutes are folded in here for the same reason.
      const practising = kind === 'LEARN' && item.conceptId !== null;
      const minutes = item.estimatedMinutes + (practising ? PRACTICE_MINUTES : 0);

      planned.push({
        kind,
        minutes,
        title: item.title,
        rationale: practising
          ? `${item.rationale} Read it, then answer the questions and write the code.`
          : item.rationale,
        conceptId: item.conceptId,
        exerciseId: item.exerciseId,
        questionCount: 0,
        carriedFrom: null,
      });
      used += minutes;
    }

    const routine = await this.persist(userId, date, planned, existing?.id);

    this.logger.log(
      `Routine for ${userId} on ${learningDayKey(date, this.zone)}: ${planned.length} items, ${used}/${budget} min`,
    );

    return this.toView(userId, routine);
  }

  /**
   * Marks an item started or finished. There is no third option.
   *
   * Skipping used to be one. It was removed because a plan you can skip is
   * a plan you skip: the item vanished, the concept behind it stayed
   * unlearned, and nothing downstream noticed. Unfinished work now carries
   * to the next day instead, which is slower to escape and honest about
   * what is outstanding.
   */
  async setItemStatus(
    userId: string,
    itemId: string,
    status: 'IN_PROGRESS' | 'DONE',
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

  /**
   * Finishing work by doing it, rather than by saying so.
   *
   * Asking someone to press "done" on an exercise whose tests just went green
   * is asking them to tell the system something it already watched happen —
   * and the one time they forget, the row carries to tomorrow and they do it
   * again. So passing *is* finishing.
   *
   * A concept row covers reading, questions and code, so it is ticked off by
   * `PracticeSetService` once the whole of its practice is done; an exercise
   * row — a project, a standalone problem — is ticked off by passing it.
   */
  /**
   * What to do after finishing a concept.
   *
   * Offered rather than navigated to. Being moved off a page you may still be
   * reading is worse than one extra click, and the click is what makes it
   * clear the last thing actually finished.
   *
   * Today's plan first, because that is the order the user agreed to. Only
   * when the plan is clear does it fall back to the course, so somebody
   * working ahead is not told they are finished for the day when they have
   * chosen not to be.
   */
  async nextAfter(userId: string, conceptId: string): Promise<NextUpView | null> {
    const date = this.learningToday();
    const routine = await this.find(userId, date);

    if (routine) {
      const pending = await this.prisma.routineItem.findFirst({
        where: {
          routineId: routine.id,
          status: { in: ['PENDING', 'IN_PROGRESS'] },
          // Not the one they just finished. Its row may not be ticked off
          // yet — a project row, say — and offering it back would be a loop.
          NOT: { conceptId },
        },
        orderBy: { orderIndex: 'asc' },
      });

      if (pending) {
        return {
          source: 'routine',
          title: pending.title,
          rationale: pending.rationale,
          conceptId: pending.conceptId,
          exerciseId: pending.exerciseId,
          kind: pending.kind,
        };
      }
    }

    // Nothing left today. The next concept in the course, for somebody who
    // wants to keep going.
    const current = await this.prisma.concept.findUnique({
      where: { id: conceptId },
      select: { technologyId: true, orderIndex: true, curriculumVersionId: true },
    });
    if (!current) return null;

    const next = await this.prisma.concept.findFirst({
      where: {
        technologyId: current.technologyId,
        curriculumVersionId: current.curriculumVersionId,
        archivedAt: null,
        orderIndex: { gt: current.orderIndex },
      },
      orderBy: { orderIndex: 'asc' },
      select: { id: true, name: true },
    });

    if (!next) return null;

    return {
      source: 'course',
      title: next.name,
      rationale: 'Today’s plan is clear. This is what comes next in the course.',
      conceptId: next.id,
      exerciseId: null,
      kind: 'LEARN',
    };
  }

  async markConceptDone(userId: string, conceptId: string): Promise<void> {
    await this.finish({ conceptId, routine: { userId } });
  }

  async markExerciseDone(userId: string, exerciseId: string): Promise<void> {
    await this.finish({ exerciseId, routine: { userId } });
  }

  /**
   * Ticks off every outstanding row matching a filter, and fixes the totals.
   *
   * Every outstanding row, not just today's: work carried forward from
   * earlier days is where doing it twice hurts most, and the same concept can
   * sit on three days at once after a backlog.
   *
   * Nothing here may fail the thing that triggered it — the caller treats it
   * as bookkeeping, because losing a passing submission or an answer over a
   * routine write would be the worse bug.
   */
  private async finish(where: Prisma.RoutineItemWhereInput): Promise<void> {
    const outstanding = await this.prisma.routineItem.findMany({
      where: { ...where, status: { in: ['PENDING', 'IN_PROGRESS'] } },
      select: { id: true, routineId: true },
    });

    if (outstanding.length === 0) return;

    await this.prisma.routineItem.updateMany({
      where: { id: { in: outstanding.map((item) => item.id) } },
      data: { status: 'DONE' },
    });

    // Sequential and de-duplicated: two rows of the same routine would
    // otherwise recompute the same total twice, racing each other.
    for (const routineId of new Set(outstanding.map((item) => item.routineId))) {
      await this.recomputeCompleted(routineId);
    }
  }

  // -- Composition ----------------------------------------------------------

  /**
   * Everything still outstanding from any earlier day.
   *
   * Marked CARRIED at the source rather than left PENDING, so the same
   * item cannot be picked up twice and yesterday's routine reads
   * truthfully — it was not finished, and it was not skipped either.
   *
   * Oldest first: the thing that has been waiting longest goes at the top
   * of today, which is both fair and the order that clears a backlog.
   */
  private async unfinishedBefore(userId: string, today: Date): Promise<PlannedItem[]> {
    const stale = await this.prisma.routineItem.findMany({
      where: {
        routine: { userId, date: { lt: today } },
        status: { in: ['PENDING', 'IN_PROGRESS'] },
      },
      orderBy: [{ routine: { date: 'asc' } }, { orderIndex: 'asc' }],
      include: { routine: { select: { date: true } } },
    });

    if (stale.length === 0) return [];

    await this.prisma.routineItem.updateMany({
      where: { id: { in: stale.map((item) => item.id) } },
      data: { status: 'CARRIED' },
    });

    const seen = new Set<string>();

    return stale.flatMap((item) => {
      // The same concept can be outstanding from several days. Carrying
      // every copy would show one task three times; carrying the oldest
      // keeps the age honest.
      const key = `${item.kind}:${item.conceptId ?? ''}:${item.exerciseId ?? ''}`;
      if (seen.has(key)) return [];
      seen.add(key);

      const kind = toRoutineKind(item.kind);
      if (!kind) return [];

      return [
        {
          kind,
          minutes: item.minutes,
          title: item.title,
          rationale: item.rationale,
          conceptId: item.conceptId,
          exerciseId: item.exerciseId,
          questionCount: item.questionCount,
          // Preserved across repeated carries, so a task late by a week
          // still says a week rather than resetting to yesterday.
          carriedFrom: item.carriedFrom ?? item.routine.date,
        },
      ];
    });
  }

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

  /**
   * The daily DSA block: where you are in the sequence, and one problem.
   *
   * Selected outside the roadmap on purpose. DSA sorts first in the
   * learning order, so a roadmap-driven plan would front-load the whole
   * subject and finish it before touching anything else — which is exactly
   * the cramming this is meant to replace. One concept and one problem a
   * day, alongside whatever else is being learned.
   */
  private async dsaBlock(userId: string): Promise<PlannedItem[]> {
    const owned = await this.prisma.userTechnology.findFirst({
      where: {
        userId,
        status: 'ACTIVE',
        archivedAt: null,
        technology: { slug: DSA_SLUG },
      },
      select: { technologyId: true },
    });

    // Archived, or never added. Either way the user has decided, and the
    // planner does not argue with it.
    if (!owned) return [];

    const concepts = await this.prisma.concept.findMany({
      where: { technologyId: owned.technologyId, archivedAt: null },
      orderBy: { orderIndex: 'asc' },
      select: {
        id: true,
        name: true,
        orderIndex: true,
        exercises: {
          where: { archivedAt: null, kind: { in: ['CODING', 'DEBUGGING'] } },
          select: { id: true },
        },
      },
    });

    if (concepts.length === 0) return [];

    const cleared = await this.clearedConceptIds(
      userId,
      concepts.map((concept) => concept.id),
    );

    const currentId =
      currentConcept(
        concepts.map((concept) => ({
          conceptId: concept.id,
          orderIndex: concept.orderIndex,
          hasPractice: concept.exercises.length > 0,
        })),
        { clearedConceptIds: cleared },
      ) ?? concepts[concepts.length - 1]!.id;

    const concept = concepts.find((candidate) => candidate.id === currentId);
    if (!concept) return [];

    // One row, like every other concept: the technique, the questions on it
    // and the day's problem all live on the concept's own page. It used to be
    // three rows, which put the inside of the task in the routine.
    return [
      {
        kind: 'LEARN',
        minutes: DSA_LEARN_MINUTES + PRACTICE_MINUTES,
        title: `DSA: ${concept.name}`,
        rationale:
          'Today’s technique. Read it, then answer the questions and solve the problem. ' +
          'One problem a day is the part that compounds.',
        conceptId: concept.id,
        exerciseId: null,
        questionCount: 0,
        carriedFrom: null,
      },
    ];
  }

  private async clearedConceptIds(
    userId: string,
    conceptIds: readonly string[],
  ): Promise<Set<string>> {
    const passed = await this.prisma.exerciseAttempt.findMany({
      where: { userId, outcome: 'PASSED', exercise: { conceptId: { in: [...conceptIds] } } },
      select: { exercise: { select: { conceptId: true } } },
    });

    return new Set(passed.map((attempt) => attempt.exercise.conceptId));
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
            kind: item.kind,
            minutes: item.minutes,
            orderIndex: index,
            title: item.title,
            rationale: item.rationale,
            conceptId: item.conceptId,
            exerciseId: item.exerciseId,
            questionCount: item.questionCount,
            carriedFrom: item.carriedFrom,
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
      carriedCount: routine.items.filter((item) => item.carriedFrom !== null).length,
    };
  }
}

interface PlannedItem {
  kind: RoutineKind;
  minutes: number;
  title: string;
  rationale: string;
  conceptId: string | null;
  exerciseId: string | null;
  questionCount: number;
  /** Set only on work moved forward from an earlier day. */
  carriedFrom: Date | null;
}

type RoutineKind =
  | 'LEARN'
  | 'RECALL'
  | 'CODE'
  | 'BLIND_CODE'
  | 'DEBUG'
  | 'EXPLAIN'
  | 'PROJECT'
  | 'CHECKPOINT'
  | 'REVIEW'
  | 'INTERVIEW';

const ROUTINE_KINDS = [
  'LEARN',
  'RECALL',
  'CODE',
  'BLIND_CODE',
  'DEBUG',
  'EXPLAIN',
  'PROJECT',
  'CHECKPOINT',
  'REVIEW',
  'INTERVIEW',
] as const satisfies readonly RoutineKind[];

function toRoutineKind(kind: string): RoutineKind | null {
  return (ROUTINE_KINDS as readonly string[]).includes(kind) ? (kind as RoutineKind) : null;
}

const DSA_SLUG = 'dsa';
const REVIEW_MINUTES = 8;
const DSA_LEARN_MINUTES = 8;

/**
 * The practice half of a concept row: a batch of questions and one exercise.
 *
 * An estimate, and the only part of a row's minutes that is. Questions can be
 * generated without limit, so the honest number is what the first batch costs
 * rather than what somebody might choose to do.
 */
const PRACTICE_MINUTES = 15;

function toItemView(item: {
  id: string;
  kind: string;
  status: string;
  minutes: number;
  title: string;
  rationale: string;
  conceptId: string | null;
  exerciseId: string | null;
  questionCount: number;
  carriedFrom: Date | null;
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
    questionCount: item.questionCount,
    carriedFrom: item.carriedFrom?.toISOString() ?? null,
  };
}
