import { Injectable, Logger } from '@nestjs/common';

import type { LearningSession } from '@forgeroutine/shared-types';

import { Problems } from '../../../common/http/problem-details.js';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';

/**
 * How long was actually spent working, as opposed to how long a tab was open.
 *
 * "Minutes practised today" is the one number on the dashboard that claims
 * to be measured rather than estimated, so it has to survive the three
 * things that make naive timing a lie:
 *
 *   A tab left open overnight. The client only beats while the user is
 *   active and visible, so an abandoned tab stops banking within one
 *   interval and the eight-hour session never happens.
 *
 *   A closed laptop. Time is banked as it passes rather than computed from
 *   `endedAt - startedAt`, so a session that never gets a clean ending
 *   keeps everything up to the last beat instead of counting zero.
 *
 *   A gap. Each beat can only add `MAX_GAP_MS`, so a machine that slept
 *   for an hour and then beat once adds a minute, not an hour.
 *
 * The client is trusted to say *whether* it is working, never *how long* —
 * every duration here is measured server-side between two beats.
 */
@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async start(
    userId: string,
    input: { conceptId?: string; routineItemId?: string },
  ): Promise<LearningSession> {
    // Reuse an open session on the same concept rather than opening a
    // second one. A refresh, or a second tab, should not start a parallel
    // clock that double-counts the same minutes.
    const open = await this.prisma.learningSession.findFirst({
      where: {
        userId,
        endedAt: null,
        conceptId: input.conceptId ?? null,
        startedAt: { gt: new Date(Date.now() - MAX_SESSION_MS) },
      },
      orderBy: { startedAt: 'desc' },
    });

    if (open) return toSession(open);

    const now = new Date();
    const row = await this.prisma.learningSession.create({
      data: {
        userId,
        conceptId: input.conceptId ?? null,
        routineItemId: input.routineItemId ?? null,
        startedAt: now,
        // Set at the start so the first beat measures from here rather
        // than banking nothing.
        lastBeatAt: now,
        durationMs: 0,
      },
    });

    return toSession(row);
  }

  /**
   * "Still working." Banks the time since the previous beat.
   *
   * Idempotent in the way that matters: two beats a second apart add a
   * second, not two intervals, because the amount comes from the clock
   * rather than from being asked.
   */
  async beat(userId: string, id: string): Promise<LearningSession> {
    const existing = await this.load(userId, id);
    if (existing.endedAt) return toSession(existing);

    const now = new Date();
    const banked = this.bankable(existing, now);

    const row = await this.prisma.learningSession.update({
      where: { id },
      data: {
        lastBeatAt: now,
        durationMs: Math.min((existing.durationMs ?? 0) + banked, MAX_SESSION_MS),
        // A session that has run past the ceiling is closed rather than
        // left to accumulate nothing for ever.
        ...((existing.durationMs ?? 0) + banked >= MAX_SESSION_MS ? { endedAt: now } : {}),
      },
    });

    return toSession(row);
  }

  async complete(userId: string, id: string): Promise<LearningSession> {
    const existing = await this.load(userId, id);
    if (existing.endedAt) return toSession(existing);

    const now = new Date();

    const row = await this.prisma.learningSession.update({
      where: { id },
      data: {
        endedAt: now,
        lastBeatAt: now,
        durationMs: Math.min(
          (existing.durationMs ?? 0) + this.bankable(existing, now),
          MAX_SESSION_MS,
        ),
      },
    });

    this.logger.debug(`Session ${id} ended after ${Math.round((row.durationMs ?? 0) / 1000)}s`);

    return toSession(row);
  }

  async get(userId: string, id: string): Promise<LearningSession> {
    return toSession(await this.load(userId, id));
  }

  /**
   * Time to credit for the interval that just ended.
   *
   * Clamped to `MAX_GAP_MS`, which is what makes a sleeping machine and a
   * dropped request cost the same small amount. Slightly over one beat
   * interval, so a single lost request is forgiven rather than deducted.
   */
  private bankable(session: { lastBeatAt: Date | null; startedAt: Date }, now: Date): number {
    const since = (session.lastBeatAt ?? session.startedAt).getTime();
    return Math.max(0, Math.min(now.getTime() - since, MAX_GAP_MS));
  }

  private async load(userId: string, id: string) {
    const row = await this.prisma.learningSession.findUnique({ where: { id } });
    // 404 rather than 403: confirming someone else's session exists is a leak.
    if (!row || row.userId !== userId) throw Problems.notFound('Session');
    return row;
  }
}

/**
 * Twice the client's beat interval, so one dropped request is forgiven and
 * a longer silence is not. See `useLearningSession` in the web app.
 */
const MAX_GAP_MS = 60_000;

/** Nobody practises one concept for four hours without a break. */
const MAX_SESSION_MS = 4 * 3_600_000;

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
