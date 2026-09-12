import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';
import { RoadmapService } from '../../roadmap/application/roadmap.service.js';

import { CurriculumGeneratorService } from './curriculum-generator.service.js';

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
   * Queues generation for every active technology of this user that has no
   * concepts yet. Returns immediately; the work runs in the background.
   */
  async enqueueMissing(userId: string): Promise<GenerationJobView[]> {
    if (!this.generator.available) {
      this.logger.warn('AI is not configured; skipping curriculum generation');
      return [];
    }

    const technologies = await this.prisma.userTechnology.findMany({
      where: { userId, status: 'ACTIVE' },
      include: {
        technology: {
          select: {
            id: true,
            name: true,
            _count: { select: { concepts: { where: { archivedAt: null } } } },
          },
        },
      },
      // Priority order, so the technology the roadmap reaches first is the
      // one that generates first.
      orderBy: { priority: 'desc' },
    });

    const missing = technologies.filter((t) => t.technology._count.concepts === 0);
    const jobs: GenerationJobView[] = [];

    for (const technology of missing) {
      const existing = await this.prisma.generationJob.findFirst({
        where: {
          userId,
          target: technology.technologyId,
          status: { in: ['QUEUED', 'RUNNING'] },
        },
      });

      // Already in flight. Re-queuing would generate the same technology twice
      // and pay for it twice.
      if (existing) {
        jobs.push(toView(existing, technology.technology.name));
        continue;
      }

      const job = await this.prisma.generationJob.create({
        data: {
          userId,
          kind: 'TECHNOLOGY_CURRICULUM',
          target: technology.technologyId,
          status: 'QUEUED',
          step: `${technology.technology.name} is queued`,
        },
      });

      jobs.push(toView(job, technology.technology.name));
    }

    // Kick the runner without awaiting it: the caller is an HTTP request and
    // generation takes minutes.
    if (jobs.length > 0) void this.drain(userId);

    return jobs;
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
    for (;;) {
      const job = await this.prisma.generationJob.findFirst({
        where: { userId, status: 'QUEUED' },
        orderBy: { createdAt: 'asc' },
      });
      if (!job) break;

      if (this.running.has(job.target)) break;
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
              : `${outcome.questionsCreated} questions`),
          finishedAt: new Date(),
        },
      });

      this.logger.log(
        `Generated ${technologyId}: ${outcome.conceptsCreated} concepts, ` +
          `${outcome.exercisesCreated} exercises, ${outcome.edgesCreated} edges, ` +
          `${outcome.questionsCreated} questions, ` +
          `${outcome.exercisesRejected} exercises rejected by the sandbox`,
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
