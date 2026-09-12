import { Injectable } from '@nestjs/common';

import type { LearningSession } from '@forgeroutine/shared-types';

import { Problems } from '../../../common/http/problem-details.js';
import { type PrismaService } from '../../../infrastructure/prisma/prisma.service.js';

/**
 * Learning sessions exist so "minutes practised today" is measured rather than
 * estimated. A session that is never completed contributes nothing, which is
 * correct: a tab left open overnight is not practice.
 */
@Injectable()
export class SessionsService {
  constructor(private readonly prisma: PrismaService) {}

  async start(
    userId: string,
    input: { conceptId?: string; routineItemId?: string },
  ): Promise<LearningSession> {
    const row = await this.prisma.learningSession.create({
      data: {
        userId,
        conceptId: input.conceptId ?? null,
        routineItemId: input.routineItemId ?? null,
        startedAt: new Date(),
      },
    });

    return toSession(row);
  }

  async complete(userId: string, id: string): Promise<LearningSession> {
    const existing = await this.prisma.learningSession.findUnique({ where: { id } });
    if (!existing || existing.userId !== userId) throw Problems.notFound('Session');
    if (existing.endedAt) return toSession(existing);

    const endedAt = new Date();
    const elapsedMs = endedAt.getTime() - existing.startedAt.getTime();

    // Cap at four hours. A forgotten tab must not report an eight-hour session
    // and make the daily-minutes number meaningless.
    const durationMs = Math.min(elapsedMs, 4 * 3_600_000);

    const row = await this.prisma.learningSession.update({
      where: { id },
      data: { endedAt, durationMs },
    });

    return toSession(row);
  }

  async get(userId: string, id: string): Promise<LearningSession> {
    const row = await this.prisma.learningSession.findUnique({ where: { id } });
    if (!row || row.userId !== userId) throw Problems.notFound('Session');
    return toSession(row);
  }
}

function toSession(row: {
  id: string;
  userId: string;
  routineItemId: string | null;
  conceptId: string | null;
  startedAt: Date;
  endedAt: Date | null;
  durationMs: number | null;
  createdAt: Date;
  updatedAt: Date;
}): LearningSession {
  return {
    id: row.id,
    userId: row.userId,
    routineItemId: row.routineItemId,
    conceptId: row.conceptId,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
    durationMs: row.durationMs,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
