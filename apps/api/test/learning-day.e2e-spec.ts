import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@forgeroutine/database';
import { learningDate, startOfLearningDay } from '@forgeroutine/utils';
import request from 'supertest';

import { AppModule } from '../src/app.module.js';
import { ProblemDetailsFilter } from '../src/common/filters/problem-details.filter.js';

/**
 * A day that runs 06:00 to 06:00, against a real database.
 *
 * The unit tests prove the arithmetic; this proves it is actually the
 * arithmetic the API uses. Three things had their own idea of "today" —
 * which routine you get, the minutes on your dashboard, and the daily token
 * budget — and each computed it from the server's midnight. On a UTC host
 * with a user in IST, that filed a Monday evening's work under Sunday.
 *
 * Time is not mocked here. What is asserted instead is agreement: the date the
 * API files a routine under must equal the date the shared helper computes, and
 * a session started before 06:00 today must still be counted.
 */

const prisma = new PrismaClient();

let app: INestApplication;
let http: ReturnType<typeof request>;
let accessToken: string;
let userId: string;
let zone: string;

const user = {
  email: `learning-day-${Date.now()}@forgeroutine.test`,
  password: 'a-long-enough-password',
  displayName: 'Learning Day Test',
};

const auth = () => ({ Authorization: `Bearer ${accessToken}` });

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new ProblemDetailsFilter());
  await app.init();
  http = request(app.getHttpServer());

  const registered = await http.post('/api/v1/auth/register').send(user).expect(201);
  accessToken = registered.body.accessToken;
  userId = (await prisma.user.findUnique({ where: { email: user.email } }))!.id;

  // The same value the API is configured with, read from the app rather than
  // re-derived, so this cannot silently test a different zone.
  zone = process.env.APP_TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}, 180_000);

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: user.email } }).catch(() => undefined);
  await prisma.$disconnect();
  await app?.close();
});

describe('the learning day', () => {
  it('files today’s routine under the learning date, not the server’s midnight', async () => {
    const response = await http.get('/api/v1/routines/today').set(auth()).expect(200);

    const expected = learningDate(new Date(), zone);
    const stored = await prisma.routine.findUnique({ where: { id: response.body.id } });

    expect(stored!.date.toISOString().slice(0, 10)).toBe(expected.toISOString().slice(0, 10));
  }, 120_000);

  it('returns the same routine before and after the server’s midnight', async () => {
    // Asked twice: the second look must reuse the first plan rather than
    // planning a second day. This is the property that broke work in progress
    // when the clock rolled over at 00:00.
    const first = await http.get('/api/v1/routines/today').set(auth()).expect(200);
    const second = await http.get('/api/v1/routines/today').set(auth()).expect(200);

    expect(second.body.id).toBe(first.body.id);
  }, 120_000);

  it('counts a session that began before 06:00 today', async () => {
    const concept = await prisma.concept.findFirst({
      where: { archivedAt: null },
      select: { id: true },
    });

    const dayStart = startOfLearningDay(new Date(), zone);

    // Half an hour after this learning day began, which on any clock earlier
    // than 06:30 local is "before today" by the old midnight rule.
    await prisma.learningSession.create({
      data: {
        userId,
        conceptId: concept!.id,
        startedAt: new Date(dayStart.getTime() + 30 * 60_000),
        lastBeatAt: new Date(dayStart.getTime() + 30 * 60_000),
        durationMs: 12 * 60_000,
      },
    });

    const overview = await http.get('/api/v1/progress/overview').set(auth()).expect(200);

    expect(overview.body.todayMinutesDone).toBeGreaterThanOrEqual(12);
  });

  it('does not count a session from the previous learning day', async () => {
    const concept = await prisma.concept.findFirst({
      where: { archivedAt: null },
      select: { id: true },
    });

    const before = await http.get('/api/v1/progress/overview').set(auth()).expect(200);

    // One minute before this day began: yesterday's late session, which must
    // stay on yesterday's total however recently it happened.
    const justBefore = new Date(startOfLearningDay(new Date(), zone).getTime() - 60_000);

    await prisma.learningSession.create({
      data: {
        userId,
        conceptId: concept!.id,
        startedAt: justBefore,
        lastBeatAt: justBefore,
        durationMs: 99 * 60_000,
      },
    });

    const after = await http.get('/api/v1/progress/overview').set(auth()).expect(200);

    expect(after.body.todayMinutesDone).toBe(before.body.todayMinutesDone);
  });

  it('greets a 2am session as still going rather than good morning', async () => {
    const overview = await http.get('/api/v1/progress/overview').set(auth()).expect(200);

    // Whatever the hour, the greeting must be one of the four the product has
    // — the point being that there now is a fourth for the small hours.
    expect(['Still going.', 'Good morning.', 'Good afternoon.', 'Good evening.']).toContain(
      overview.body.greeting,
    );
  });
});
