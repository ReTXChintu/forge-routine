import { Injectable, Logger } from '@nestjs/common';

import { currentConcept } from '@forgeroutine/curriculum';
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
  ) {}

  /**
   * Today's plan, built on first look.
   *
   * It used to return null until the user pressed "Plan today", which asked
   * them to make a decision the app had already made: the budget is in their
   * preferences, the order is in the roadmap, and the due dates are in the
   * schedule. There was nothing left for the button to ask.
   */
  async today(userId: string): Promise<RoutineView> {
    const existing = await this.find(userId, startOfToday());
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

    const date = startOfToday();
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
    const questionCounts = await this.questionCounts(
      roadmapItems.map((item) => item.conceptId).filter((id): id is string => id !== null),
    );
    const recalled = new Set<string>();

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

      planned.push({
        kind,
        minutes: item.estimatedMinutes,
        title: item.title,
        rationale: item.rationale,
        conceptId: item.conceptId,
        exerciseId: item.exerciseId,
        questionCount: 0,
        carriedFrom: null,
      });
      used += item.estimatedMinutes;

      // Reading a concept and then being asked about it is the whole
      // difference between studying and revising, so the questions follow
      // the concept immediately rather than waiting for the review to fall
      // due days later.
      const count = item.conceptId ? (questionCounts.get(item.conceptId) ?? 0) : 0;
      if (item.kind === 'LEARN' && count > 0 && !recalled.has(item.conceptId!)) {
        recalled.add(item.conceptId!);
        planned.push({
          kind: 'RECALL',
          minutes: QUESTION_MINUTES,
          title: `${Math.min(count, QUESTIONS_PER_ITEM)} questions on ${stripPrefix(item.title)}`,
          rationale: 'Answering beats rereading. This is what fixes it.',
          conceptId: item.conceptId,
          exerciseId: null,
          questionCount: Math.min(count, QUESTIONS_PER_ITEM),
          carriedFrom: null,
        });
        used += QUESTION_MINUTES;
      }
    }

    const routine = await this.persist(userId, date, planned, existing?.id);

    this.logger.log(
      `Routine for ${userId} on ${dayKey(date)}: ${planned.length} items, ${used}/${budget} min`,
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
          orderBy: [{ difficulty: 'asc' }, { createdAt: 'asc' }],
          select: { id: true, title: true, estimatedMinutes: true },
        },
        _count: { select: { questions: { where: { archivedAt: null } } } },
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

    const items: PlannedItem[] = [
      {
        kind: 'LEARN',
        minutes: DSA_LEARN_MINUTES,
        title: `DSA: ${concept.name}`,
        rationale: 'Today’s technique. Read it, then use it on the problem below.',
        conceptId: concept.id,
        exerciseId: null,
        questionCount: 0,
        carriedFrom: null,
      },
    ];

    if (concept._count.questions > 0) {
      items.push({
        kind: 'RECALL',
        minutes: QUESTION_MINUTES,
        title: `${Math.min(concept._count.questions, QUESTIONS_PER_ITEM)} questions on ${concept.name}`,
        rationale: 'Checks you can state it, not just recognise it.',
        conceptId: concept.id,
        exerciseId: null,
        questionCount: Math.min(concept._count.questions, QUESTIONS_PER_ITEM),
        carriedFrom: null,
      });
    }

    // Exactly one. Two problems is a different product, and the thing that
    // makes this work is that it is small enough to do on a bad day.
    const exercise = await this.unsolvedExercise(userId, concept.exercises);
    if (exercise) {
      items.push({
        kind: 'CODE',
        minutes: exercise.estimatedMinutes,
        title: `DSA problem: ${exercise.title}`,
        rationale: 'One problem, every day. This is the part that compounds.',
        conceptId: concept.id,
        exerciseId: exercise.id,
        questionCount: 0,
        carriedFrom: null,
      });
    }

    return items;
  }

  /** The easiest exercise the user has not already passed, else the easiest. */
  private async unsolvedExercise(
    userId: string,
    exercises: readonly { id: string; title: string; estimatedMinutes: number }[],
  ) {
    if (exercises.length === 0) return null;

    const passed = await this.prisma.exerciseAttempt.findMany({
      where: {
        userId,
        outcome: 'PASSED',
        exerciseId: { in: exercises.map((exercise) => exercise.id) },
      },
      select: { exerciseId: true },
    });

    const solved = new Set(passed.map((attempt) => attempt.exerciseId));

    // Falling back to the first rather than returning nothing: re-solving a
    // problem you have done before is a worse day than a new one, and a
    // better day than no problem at all.
    return exercises.find((exercise) => !solved.has(exercise.id)) ?? exercises[0]!;
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

  private async questionCounts(conceptIds: readonly string[]): Promise<Map<string, number>> {
    if (conceptIds.length === 0) return new Map();

    const grouped = await this.prisma.conceptQuestion.groupBy({
      by: ['conceptId'],
      where: { conceptId: { in: [...conceptIds] }, archivedAt: null },
      _count: { _all: true },
    });

    return new Map(grouped.map((row) => [row.conceptId, row._count._all]));
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
const QUESTION_MINUTES = 5;
const DSA_LEARN_MINUTES = 8;
const QUESTIONS_PER_ITEM = 3;

/** Roadmap titles arrive as "Learn closures"; the verb is already in the row. */
function stripPrefix(title: string): string {
  return title.replace(/^(Learn|Practise|Practice|Study)\s+/i, '');
}

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
