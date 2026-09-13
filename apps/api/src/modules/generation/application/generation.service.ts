import { Injectable, Logger } from '@nestjs/common';

import { orderTechnologies, shouldGenerateAhead } from '@forgeroutine/curriculum';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';
import { RoadmapService } from '../../roadmap/application/roadmap.service.js';

import { GENERATOR_VERSION, CurriculumGeneratorService } from './curriculum-generator.service.js';

interface PipelineEntry {
  job: { id: string; target: string; status: string; step: string; progress: number; error: string | null; kind: string };
  technology: UserTechnologyRow;
  status: string;
}

interface UserTechnologyRow {
  technologyId: string;
  slug: string;
  name: string;
  dependsOn: string[];
  learningOrder: number;
  conceptCount: number;
  /**
   * A full course exists, not just a starter set.
   *
   * The seeded JavaScript and Node.js curricula are drills for an engineer
   * filling gaps: seven concepts opening at closures, with no variables and
   * no control flow. Counting them as "built" is why asking to start with
   * JavaScript produced a course that begins in the middle. A technology is
   * only finished when the current generator has produced a full curriculum
   * for it.
   */
  complete: boolean;
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
  /** Technologies in the plan that have not been started. Costs nothing. */
  waiting: number;
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
   * Keeps the generation pipeline correct, and promotes at most one job.
   *
   * Two responsibilities, deliberately together because they must agree:
   *
   *   1. Every technology the user has chosen but does not yet have gets a
   *      PENDING row, in learning order. PENDING is visible and costs
   *      nothing — it is the plan, not the work.
   *   2. The single earliest PENDING job becomes QUEUED, but only when the
   *      user is far enough into what they already have to justify it.
   *
   * Called on sign-up, on opening the dashboard, and on planning a routine.
   * In the common case it promotes nothing and the whole thing is two
   * queries.
   */
  async enqueueNext(
    userId: string,
    options: { force?: boolean } = {},
  ): Promise<GenerationJobView[]> {
    if (!this.generator.available) {
      this.logger.warn('AI is not configured; skipping curriculum generation');
      return [];
    }

    const technologies = await this.userTechnologies(userId);
    if (technologies.length === 0) return [];

    const pipeline = await this.syncPipeline(userId, technologies);

    // Something is already building. One at a time is the whole point.
    const inFlight = pipeline.find(
      (entry) => entry.status === 'QUEUED' || entry.status === 'RUNNING',
    );
    if (inFlight) {
      void this.drain(userId);
      return [toView(inFlight.job, inFlight.technology.name)];
    }

    const next = pipeline.find((entry) => entry.status === 'PENDING');
    if (!next) return [];

    // `force` is onboarding, or the user asking outright. Otherwise the
    // threshold decides, so nobody pays for material they are nowhere near.
    if (!options.force && !(await this.readyForMore(userId, technologies))) return [];

    const promoted = await this.prisma.generationJob.update({
      where: { id: next.job.id },
      data: { status: 'QUEUED', step: `${next.technology.name} is queued` },
    });

    this.logger.log(
      `Queued ${next.technology.slug} for ${userId} ` +
        `(${technologies.filter((t) => t.complete).length}/${technologies.length} built)`,
    );

    // Kick the runner without awaiting it: the caller is an HTTP request and
    // generation takes minutes.
    void this.drain(userId);

    return [toView(promoted, next.technology.name)];
  }

  /**
   * Reconciles job rows with what the user actually needs, in order.
   *
   * Creates a PENDING row for anything unbuilt that has none, and clears
   * rows for technologies that have since been built or dropped. Reconciling
   * rather than appending matters because the pipeline is shown to the user:
   * a stale row saying "Docker is queued" for a Docker that already exists
   * is worse than no row at all.
   */
  private async syncPipeline(
    userId: string,
    technologies: readonly UserTechnologyRow[],
  ): Promise<PipelineEntry[]> {
    const order = orderTechnologies(
      technologies.map((technology) => ({
        technologyId: technology.technologyId,
        slug: technology.slug,
        dependsOn: technology.dependsOn,
        weight: -technology.learningOrder,
      })),
    );

    const byId = new Map(technologies.map((technology) => [technology.technologyId, technology]));

    const openJobs = await this.prisma.generationJob.findMany({
      where: {
        userId,
        kind: 'TECHNOLOGY_CURRICULUM',
        status: { in: ['PENDING', 'QUEUED', 'RUNNING'] },
      },
    });
    const jobByTarget = new Map(openJobs.map((job) => [job.target, job]));

    // A job for something already built, or no longer chosen, is noise.
    const obsolete = openJobs.filter((job) => byId.get(job.target)?.complete === true);
    if (obsolete.length > 0) {
      await this.prisma.generationJob.updateMany({
        where: { id: { in: obsolete.map((job) => job.id) } },
        data: { status: 'READY', progress: 100, step: 'Already built', finishedAt: new Date() },
      });
      for (const job of obsolete) jobByTarget.delete(job.target);
    }

    const entries: PipelineEntry[] = [];

    for (const technologyId of order) {
      const technology = byId.get(technologyId);
      if (!technology || technology.complete) continue;

      const existing = jobByTarget.get(technologyId);

      const job =
        existing ??
        (await this.prisma.generationJob.create({
          data: {
            userId,
            kind: 'TECHNOLOGY_CURRICULUM',
            target: technologyId,
            status: 'PENDING',
            step: `${technology.name} is waiting its turn`,
          },
        }));

      entries.push({ job, technology, status: job.status });
    }

    return entries;
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
    // Progress is measured against everything with material in it, whether
    // seeded or generated: the user is working through it either way.
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
            curriculumVersions: {
              where: { status: 'ACTIVE', generatorVersion: GENERATOR_VERSION },
              select: { id: true },
              take: 1,
            },
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
      complete: row.technology.curriculumVersions.length > 0,
    }));
  }

  async status(userId: string): Promise<GenerationStatusView> {
    // Reconcile first, so opening the progress view shows the real pipeline
    // rather than whatever was true the last time something was generated.
    const technologies = await this.userTechnologies(userId);
    if (technologies.length > 0) await this.syncPipeline(userId, technologies);

    const jobs = await this.prisma.generationJob.findMany({
      where: { userId },
      // Pending work first and in plan order, because that is the queue the
      // user is being shown; finished work after it, newest first.
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 40,
    });

    const named = await this.prisma.technology.findMany({
      where: { id: { in: jobs.map((job) => job.target) } },
      select: { id: true, name: true },
    });
    const nameById = new Map(named.map((technology) => [technology.id, technology.name]));

    const views = jobs.map((job) => toView(job, nameById.get(job.target) ?? null));

    // PENDING is not active. Nothing is running and nothing is being spent —
    // reporting it as active would leave the UI spinning forever on work
    // that is deliberately not started.
    const active = views.some((j) => j.status === 'QUEUED' || j.status === 'RUNNING');

    return {
      active,
      partial: active && views.some((j) => j.status === 'READY'),
      waiting: views.filter((j) => j.status === 'PENDING').length,
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
