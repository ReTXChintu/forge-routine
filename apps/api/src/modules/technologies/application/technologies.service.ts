import { Injectable, Logger } from '@nestjs/common';

import { getCuratedCurricula } from '@forgeroutine/curriculum';
import type { Technology, UserTechnology } from '@forgeroutine/shared-types';
import { slugify } from '@forgeroutine/utils';
import type { AddTechnologyInput, UpdateUserTechnologyInput } from '@forgeroutine/validation';

import { Problems } from '../../../common/http/problem-details.js';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';
import { CurriculumImportService } from '../../curriculum/application/curriculum-import.service.js';
import { SkillsService } from '../../skills/application/skills.service.js';

/**
 * The user's learning universe (§5).
 *
 * The central invariant: **removing a technology must never destroy learning
 * history.** Everything here is a soft delete, and re-adding restores the prior
 * skill state rather than resetting it.
 */
@Injectable()
export class TechnologiesService {
  private readonly logger = new Logger(TechnologiesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly curriculum: CurriculumImportService,
    private readonly skills: SkillsService,
  ) {}

  async listCatalogue(search?: string): Promise<Technology[]> {
    const rows = await this.prisma.technology.findMany({
      where: search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { slug: { contains: slugify(search) } },
            ],
          }
        : undefined,
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });

    return rows.map(toTechnology);
  }

  async listMine(userId: string, includeArchived = false): Promise<UserTechnology[]> {
    const rows = await this.prisma.userTechnology.findMany({
      where: { userId, ...(includeArchived ? {} : { status: { not: 'ARCHIVED' } }) },
      include: { technology: true },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    });

    return rows.map(toUserTechnology);
  }

  /**
   * Adds a technology, creating the catalogue row on demand so the user can add
   * anything — Rust today, Kubernetes next week — without a release (§25, §41).
   */
  async add(userId: string, input: AddTechnologyInput): Promise<UserTechnology> {
    const technology = await this.resolveTechnology(input);
    await this.ensureCurriculum(technology.id, technology.slug);

    const existing = await this.prisma.userTechnology.findUnique({
      where: { userId_technologyId: { userId, technologyId: technology.id } },
    });

    // Re-adding a previously archived technology restores it. The skills, attempts
    // and history were never deleted, so they simply become visible again.
    if (existing) {
      const restored = await this.prisma.userTechnology.update({
        where: { id: existing.id },
        data: {
          status: 'ACTIVE',
          archivedAt: null,
          pausedAt: null,
          priority: input.priority,
          targetProficiency: input.targetProficiency,
          interviewImportance: input.interviewImportance,
          frequency: input.frequency,
        },
        include: { technology: true },
      });
      return toUserTechnology(restored);
    }

    const created = await this.prisma.$transaction(
      async (tx) => {
        const row = await tx.userTechnology.create({
          data: {
            userId,
            technologyId: technology.id,
            priority: input.priority,
            targetProficiency: input.targetProficiency,
            interviewImportance: input.interviewImportance,
            frequency: input.frequency,
            existingKnowledge: input.existingKnowledge,
          },
          include: { technology: true },
        });

        if (input.existingKnowledge !== null && input.existingKnowledge > 0) {
          const concepts = await tx.concept.findMany({
            where: { technologyId: technology.id, archivedAt: null },
            select: { id: true },
          });
          await this.skills.seedInitialEstimates(
            tx,
            userId,
            concepts.map((c) => c.id),
            input.existingKnowledge,
          );
        }

        return row;
      },
      // Headroom for a remote database. Seeding is bulk now, but a large
      // curriculum still means real network latency per statement, and the
      // 5s default is tuned for a local Postgres.
      { timeout: 20_000 },
    );

    return toUserTechnology(created);
  }

  async update(
    userId: string,
    id: string,
    input: UpdateUserTechnologyInput,
  ): Promise<UserTechnology> {
    await this.assertOwned(userId, id);

    const row = await this.prisma.userTechnology.update({
      where: { id },
      data: input,
      include: { technology: true },
    });

    return toUserTechnology(row);
  }

  async pause(userId: string, id: string): Promise<UserTechnology> {
    await this.assertOwned(userId, id);

    // Review schedules freeze rather than accumulate. Coming back from a pause to
    // forty overdue reviews is how people quit.
    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.userTechnology.update({
        where: { id },
        data: { status: 'PAUSED', pausedAt: new Date() },
        include: { technology: true },
      });

      await tx.reviewSchedule.updateMany({
        where: { userId, concept: { technologyId: updated.technologyId }, frozenAt: null },
        data: { frozenAt: new Date() },
      });

      return updated;
    });

    return toUserTechnology(row);
  }

  async resume(userId: string, id: string): Promise<UserTechnology> {
    const existing = await this.assertOwned(userId, id);

    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.userTechnology.update({
        where: { id },
        data: { status: 'ACTIVE', pausedAt: null },
        include: { technology: true },
      });

      // Push due dates forward by the paused duration so the user is not
      // immediately buried in reviews that came due while they were away.
      const pausedMs = existing.pausedAt ? Date.now() - existing.pausedAt.getTime() : 0;
      const frozen = await tx.reviewSchedule.findMany({
        where: { userId, concept: { technologyId: updated.technologyId }, frozenAt: { not: null } },
        select: { id: true, dueAt: true },
      });

      for (const schedule of frozen) {
        await tx.reviewSchedule.update({
          where: { id: schedule.id },
          data: { frozenAt: null, dueAt: new Date(schedule.dueAt.getTime() + pausedMs) },
        });
      }

      return updated;
    });

    return toUserTechnology(row);
  }

  /** Soft delete. History is retained (§5). */
  async archive(userId: string, id: string): Promise<void> {
    await this.assertOwned(userId, id);

    await this.prisma.userTechnology.update({
      where: { id },
      data: { status: 'ARCHIVED', archivedAt: new Date() },
    });
  }

  private async assertOwned(userId: string, id: string) {
    const row = await this.prisma.userTechnology.findUnique({ where: { id } });
    if (!row || row.userId !== userId) throw Problems.notFound('Technology');
    return row;
  }

  private async resolveTechnology(input: AddTechnologyInput) {
    if (input.technologyId) {
      const found = await this.prisma.technology.findUnique({ where: { id: input.technologyId } });
      if (!found) throw Problems.notFound('Technology');
      return found;
    }

    const name = input.name as string;
    const slug = slugify(name);

    return this.prisma.technology.upsert({
      where: { slug },
      create: { slug, name, category: 'user-added' },
      update: {},
    });
  }

  /**
   * Imports the curated curriculum on first use.
   *
   * Technologies without a curated graph are left empty for now: the AI curriculum
   * generator (Phase 2) fills them asynchronously, and an empty concept list is a
   * visible "generating" state rather than a broken one.
   */
  private async ensureCurriculum(technologyId: string, slug: string): Promise<void> {
    const active = await this.prisma.curriculumVersion.findFirst({
      where: { technologyId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (active) return;

    const curated = getCuratedCurricula().find((c) => c.slug === slug);
    if (!curated) {
      this.logger.log(`No curated curriculum for ${slug}; awaiting generation`);
      return;
    }

    await this.prisma.$transaction((tx) => this.curriculum.importTechnology(tx, curated), {
      timeout: 30_000,
    });
  }
}

function toTechnology(row: {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  curatedCurriculum: boolean;
  createdAt: Date;
  updatedAt: Date;
}): Technology {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    category: row.category,
    curatedCurriculum: row.curatedCurriculum,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toUserTechnology(row: {
  id: string;
  technologyId: string;
  technology: Parameters<typeof toTechnology>[0];
  status: string;
  priority: string;
  targetProficiency: string;
  interviewImportance: number;
  frequency: string;
  existingKnowledge: number | null;
  archivedAt: Date | null;
  pausedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): UserTechnology {
  return {
    id: row.id,
    technologyId: row.technologyId,
    technology: toTechnology(row.technology),
    status: row.status as UserTechnology['status'],
    priority: row.priority as UserTechnology['priority'],
    targetProficiency: row.targetProficiency as UserTechnology['targetProficiency'],
    interviewImportance: row.interviewImportance,
    frequency: row.frequency as UserTechnology['frequency'],
    existingKnowledge: row.existingKnowledge,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    pausedAt: row.pausedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
