import { Injectable, Logger } from '@nestjs/common';

import { nextToGenerate, shouldGenerateAhead } from '@forgeroutine/curriculum';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';
import { RoadmapService } from '../../roadmap/application/roadmap.service.js';

import { CurriculumGeneratorService } from './curriculum-generator.service.js';

interface UserTechnologyRow {
  technologyId: string;
  slug: string;
  name: string;
  dependsOn: string[];
  learningOrder: number;
  conceptCount: number;
}

export interface GenerationJobView {
  id: string;
  kind: string;
  target: string;
  technologyName: string | null;
  status: string;
  progress: number;
  step: string;
  error: string | null;
}

export interface GenerationStatusView {
  /** True while any job for this user is queued or running. */
  active: boolean;
  /**
   * Usable but incomplete. Four of six technologies generated is not
   * "not ready", and reporting it as such would be a lie.
   */
  partial: boolean;
  jobs: GenerationJobView[];
}

/**
 * Background curriculum generation (docs/learning-path.md).
 *
 * Job state lives in PostgreSQL rather than Redis so "come back shortly"
 * survives a restart (§29): Redis would carry work to a worker, but Postgres
 * is what remembers what was asked for and how far it got.
 *
 * The runner is in-process today, matching the `inline` execution driver.
 * Moving to the queue means changing `enqueue` alone — everything else already
 * reads its state from the database.
 *
 * **One technology at a time, and only when it is needed.** Generating a
 * user's whole selection on sign-up costs real money for material they may
 * never reach, at exactly the moment they are least likely to have decided
 * the product is worth it. Someone who picks six technologies and stops after
 * a week has paid for five they never opened.
 *
 * So: build the first one in learning order, then build the next only once
 * they are `GENERATE_AHEAD_AT` of the way through what they already have.
 * Generation takes minutes, so the lead time is deliberate — waiting until
 * they are actually blocked means they sit and wait.
 *
 * Curriculum is shared, not per-user. A `Concept` belongs to a `Technology`,
 * so the second person to pick Docker pays nothing: `hasContent` is already
 * true and no job is created. That is why the check below is on concept
 * count rather than on anything user-scoped.
 */
@Injectable()
export class GenerationService {
  private readonly logger = new Logger(GenerationService.name);

  /** Guards against the same technology being generated twice concurrently. */
  private readonly running = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly generator: CurriculumGeneratorService,
    private readonly roadmap: RoadmapService,
  ) {}

  /**
   * Queues the one technology this user needs next, if any.
   *
   * Called on sign-up and again whenever the roadmap is read, so the next
   * technology starts building while the user is still working through the
   * current one. Returns the queued job, or an empty list when there is
   * nothing to do — which is the common case and costs one query.
   */
  async enqueueNext(userId: string, options: { force?: boolean } = {}): Promise<
    GenerationJobView[]
  > {
    if (!this.generator.available) {
      this.logger.warn('AI is not configured; skipping curriculum generation');
      return [];
    }

    const technologies = await this.userTechnologies(userId);
    if (technologies.length === 0) return [];

    const target = nextToGenerate(
      technologies.map((technology) => ({
        technologyId: technology.technologyId,
        slug: technology.slug,
        dependsOn: technology.dependsOn,
        weight: -technology.learningOrder,
        hasContent: technology.conceptCount > 0,
      })),
    );

    if (!target) return [];

    // `force` is onboarding: there is nothing built yet, so the first
    // technology is needed immediately rather than when progress warrants it.
    if (!options.force && !(await this.readyForMore(userId, technologies))) return [];

    const technology = technologies.find((t) => t.technologyId === target);
    if (!technology) return [];

    const existing = await this.prisma.generationJob.findFirst({
      where: { userId, target, status: { in: ['QUEUED', 'RUNNING'] } },
    });

    // Already in flight. Re-queuing would build the same technology twice
    // and pay for it twice.
    if (existing) return [toView(existing, technology.name)];

    const job = await this.prisma.generationJob.create({
      data: {
        userId,
        kind: 'TECHNOLOGY_CURRICULUM',
        target,
        status: 'QUEUED',
        step: `${technology.name} is queued`,
      },
    });

    this.logger.log(
      `Queued ${technology.slug} for ${userId} ` +
        `(${technologies.filter((t) => t.conceptCount > 0).length}/${technologies.length} built)`,
    );

    // Kick the runner without awaiting it: the caller is an HTTP request and
    // generation takes minutes.
    void this.drain(userId);

    return [toView(job, technology.name)];
  }

  /**
   * Whether the user is far enough through what they have to justify paying
   * for the next thing.
   *
   * Nothing built at all always qualifies — otherwise a returning user whose
   * first technology failed would be stuck with an empty roadmap forever.
   */
  private async readyForMore(
    userId: string,
    technologies: readonly UserTechnologyRow[],
  ): Promise<boolean> {
    const built = technologies.filter((technology) => technology.conceptCount > 0);
    if (built.length === 0) return true;

    const totalConcepts = built.reduce((sum, t) => sum + t.conceptCount, 0);

    const practisedConcepts = await this.prisma.skill.count({
      where: {
        userId,
        attempts: { gt: 0 },
        concept: {
          archivedAt: null,
          technologyId: { in: built.map((technology) => technology.technologyId) },
        },
      },
    });

    return shouldGenerateAhead({ totalConcepts, practisedConcepts });
  }

  private async userTechnologies(userId: string): Promise<UserTechnologyRow[]> {
    const rows = await this.prisma.userTechnology.findMany({
      where: { userId, status: 'ACTIVE', archivedAt: null },
      include: {
        technology: {
          select: {
            id: true,
            slug: true,
            name: true,
            dependsOn: true,
            learningOrder: true,
            _count: { select: { concepts: { where: { archivedAt: null } } } },
          },
        },
      },
    });

    return rows.map((row) => ({
      technologyId: row.technologyId,
      slug: row.technology.slug,
      name: row.technology.name,
      dependsOn: row.technology.dependsOn,
      learningOrder: row.technology.learningOrder,
      conceptCount: row.technology._count.concepts,
    }));
  }

  async status(userId: string): Promise<GenerationStatusView> {
    const jobs = await this.prisma.generationJob.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    const technologyIds = jobs.map((j) => j.target);
    const technologies = await this.prisma.technology.findMany({
      where: { id: { in: technologyIds } },
      select: { id: true, name: true },
    });
    const nameById = new Map(technologies.map((t) => [t.id, t.name]));

    const views = jobs.map((job) => toView(job, nameById.get(job.target) ?? null));
    const active = views.some((j) => j.status === 'QUEUED' || j.status === 'RUNNING');

    return {
      active,
      partial: active && views.some((j) => j.status === 'READY'),
      jobs: views,
    };
  }

  // -- Runner ---------------------------------------------------------------

  /**
   * Processes this user's queued jobs one at a time.
   *
   * Sequential on purpose: parallel generation would multiply token spend at
   * exactly the moment a user is least likely to have decided the product is
   * worth it, and the roadmap only needs the first technology to be usable.
   */
  private async drain(userId: string): Promise<void> {
    // Exactly one job per call, not the whole queue.
    //
    // Draining a backlog would undo the entire point of queueing one at a
    // time: any jobs left over from an earlier version, a crash, or a
    // double-submit would all run back to back and bill for technologies the
    // user is nowhere near. A real backlog did exactly that — seventeen
    // technologies queued in one onboarding, eight built before anyone
    // noticed.
    //
    // The next one is queued by the next call, once progress warrants it.
    const job = await this.prisma.generationJob.findFirst({
      where: { userId, status: 'QUEUED' },
      orderBy: { createdAt: 'asc' },
    });

    if (job && !this.running.has(job.target)) {
      this.running.add(job.target);

      try {
        await this.runJob(job.id, job.target, userId);
      } catch (error) {
        this.logger.error({ err: error }, `Generation job ${job.id} failed`);
      } finally {
        this.running.delete(job.target);
      }
    }

    // One replan at the end rather than after each technology: the roadmap is
    // the user's stable view of the journey and should not reshuffle under
    // them repeatedly while they read it.
    await this.roadmap.regenerate(userId).catch((error: unknown) => {
      this.logger.warn({ err: error }, 'Post-generation replan failed');
    });
  }

  private async runJob(jobId: string, technologyId: string, userId: string): Promise<void> {
    await this.prisma.generationJob.update({
      where: { id: jobId },
      data: {
        status: 'RUNNING',
        startedAt: new Date(),
        attempts: { increment: 1 },
        step: 'Starting',
      },
    });

    try {
      const outcome = await this.generator.generateForTechnology(
        technologyId,
        userId,
        async (step, progress) => {
          await this.prisma.generationJob
            .update({ where: { id: jobId }, data: { step, progress } })
            .catch(() => undefined);
        },
      );

      await this.prisma.generationJob.update({
        where: { id: jobId },
        data: {
          status: 'READY',
          progress: 100,
          step:
            `Ready: ${outcome.conceptsCreated} concepts, ` +
            (outcome.exercisesCreated > 0
              ? `${outcome.exercisesCreated} exercises`
              : `${outcome.questionsCreated} questions`) +
            (outcome.projectsCreated > 0 ? `, ${outcome.projectsCreated} projects` : ''),
          finishedAt: new Date(),
        },
      });

      this.logger.log(
        `Generated ${technologyId}: ${outcome.conceptsCreated} concepts, ` +
          `${outcome.exercisesCreated} exercises, ${outcome.edgesCreated} edges, ` +
          `${outcome.questionsCreated} questions, ` +
          `${outcome.projectsCreated} projects, ` +
          `${outcome.exercisesRejected} exercises and ${outcome.projectsRejected} projects ` +
          'rejected by the sandbox',
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      await this.prisma.generationJob.update({
        where: { id: jobId },
        data: {
          status: 'FAILED',
          // Shown to the user, so it is trimmed rather than dumped.
          error: message.slice(0, 500),
          step: 'Failed',
          finishedAt: new Date(),
        },
      });

      throw error;
    }
  }
}

function toView(
  job: {
    id: string;
    kind: string;
    target: string;
    status: string;
    progress: number;
    step: string;
    error: string | null;
  },
  technologyName: string | null,
): GenerationJobView {
  return {
    id: job.id,
    kind: job.kind,
    target: job.target,
    technologyName,
    status: job.status,
    progress: job.progress,
    step: job.step,
    error: job.error,
  };
}
