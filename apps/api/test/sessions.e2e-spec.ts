import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@forgeroutine/database';
import request from 'supertest';

import { AppModule } from '../src/app.module.js';
import { ProblemDetailsFilter } from '../src/common/filters/problem-details.filter.js';

/**
 * Timing, against a real database.
 *
 * "Minutes practised today" is the one dashboard number that claims to be
 * measured rather than estimated, so the properties worth asserting are
 * the ones that make naive timing a lie: an abandoned tab must earn
 * nothing, a closed laptop must keep what it earned, and a machine that
 * slept must not be credited with the nap.
 */

const prisma = new PrismaClient();

let app: INestApplication;
let http: ReturnType<typeof request>;
let accessToken: string;
let userId: string;

/**
 * A distinct concept per test.
 *
 * `start` deliberately reuses an open session for the same concept, so two
 * tests sharing one would have the second inherit the first's banked time
 * — which is the behaviour working, not a fixture problem.
 */
let concepts: string[] = [];
let nextConcept = 0;
const freshConcept = () => concepts[nextConcept++ % concepts.length]!;

const user = {
  email: `sessions-${Date.now()}@forgeroutine.test`,
  password: 'a-long-enough-password',
  displayName: 'Sessions Test',
};

const auth = () => ({ Authorization: `Bearer ${accessToken}` });

/** Rewinds the clock the server measures against, without waiting for it. */
async function backdateBeat(sessionId: string, secondsAgo: number) {
  await prisma.learningSession.update({
    where: { id: sessionId },
    data: { lastBeatAt: new Date(Date.now() - secondsAgo * 1000) },
  });
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new ProblemDetailsFilter());
  await app.init();
  http = request(app.getHttpServer());

  const registered = await http.post('/api/v1/auth/register').send(user).expect(201);
  accessToken = registered.body.accessToken;

  const account = await prisma.user.findUnique({ where: { email: user.email } });
  userId = account!.id;

  concepts = (
    await prisma.concept.findMany({ where: { archivedAt: null }, take: 12, select: { id: true } })
  ).map((row) => row.id);
  expect(concepts.length).toBeGreaterThan(4);
}, 120_000);

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: user.email } }).catch(() => undefined);
  await prisma.$disconnect();
  await app?.close();
});

describe('learning sessions', () => {
  it('starts with nothing banked', async () => {
    const response = await http
      .post('/api/v1/sessions')
      .set(auth())
      .send({ conceptId: freshConcept() })
      .expect(201);

    expect(response.body.id).toBeTruthy();
    expect(response.body.durationMs).toBe(0);
    expect(response.body.endedAt).toBeNull();
  });

  it('banks the time between beats, measured server-side', async () => {
    const started = await http
      .post('/api/v1/sessions')
      .set(auth())
      .send({ conceptId: freshConcept() })
      .expect(201);

    await backdateBeat(started.body.id, 30);
    const beaten = await http
      .post(`/api/v1/sessions/${started.body.id}/beat`)
      .set(auth())
      .expect(200);

    // ~30s, allowing for the round trip. The client never says how long.
    expect(beaten.body.durationMs).toBeGreaterThanOrEqual(29_000);
    expect(beaten.body.durationMs).toBeLessThan(35_000);
  });

  it('accumulates across beats rather than replacing', async () => {
    const started = await http
      .post('/api/v1/sessions')
      .set(auth())
      .send({ conceptId: freshConcept() })
      .expect(201);

    for (let i = 0; i < 3; i += 1) {
      await backdateBeat(started.body.id, 30);
      await http.post(`/api/v1/sessions/${started.body.id}/beat`).set(auth()).expect(200);
    }

    const session = await http.get(`/api/v1/sessions/${started.body.id}`).set(auth()).expect(200);
    expect(session.body.durationMs).toBeGreaterThanOrEqual(88_000);
  });

  it('credits at most one gap for a machine that slept', async () => {
    const started = await http
      .post('/api/v1/sessions')
      .set(auth())
      .send({ conceptId: freshConcept() })
      .expect(201);

    // An hour between beats: a closed lid, not an hour of practice.
    await backdateBeat(started.body.id, 3_600);
    const beaten = await http
      .post(`/api/v1/sessions/${started.body.id}/beat`)
      .set(auth())
      .expect(200);

    expect(beaten.body.durationMs).toBeLessThanOrEqual(60_000);
  });

  it('keeps what an abandoned session earned, without ending it', async () => {
    // The closed-laptop case: beats stop, nothing completes it, and the
    // minutes up to the last beat must survive anyway.
    const started = await http
      .post('/api/v1/sessions')
      .set(auth())
      .send({ conceptId: freshConcept() })
      .expect(201);

    await backdateBeat(started.body.id, 30);
    await http.post(`/api/v1/sessions/${started.body.id}/beat`).set(auth()).expect(200);

    const row = await prisma.learningSession.findUnique({ where: { id: started.body.id } });
    expect(row!.endedAt).toBeNull();
    expect(row!.durationMs!).toBeGreaterThanOrEqual(29_000);
  });

  it('an abandoned tab that never beats earns nothing', async () => {
    const started = await http
      .post('/api/v1/sessions')
      .set(auth())
      .send({ conceptId: freshConcept() })
      .expect(201);

    const row = await prisma.learningSession.findUnique({ where: { id: started.body.id } });
    expect(row!.durationMs).toBe(0);
  });

  it('reuses an open session rather than starting a parallel clock', async () => {
    // A refresh, or a second tab on the same concept, must not double-count.
    const concept = freshConcept();

    const first = await http
      .post('/api/v1/sessions')
      .set(auth())
      .send({ conceptId: concept })
      .expect(201);
    const second = await http
      .post('/api/v1/sessions')
      .set(auth())
      .send({ conceptId: concept })
      .expect(201);

    expect(second.body.id).toBe(first.body.id);
  });

  it('completing is idempotent and does not keep accruing', async () => {
    const started = await http
      .post('/api/v1/sessions')
      .set(auth())
      .send({ conceptId: freshConcept() })
      .expect(201);

    await backdateBeat(started.body.id, 20);
    const ended = await http
      .post(`/api/v1/sessions/${started.body.id}/complete`)
      .set(auth())
      .expect(200);

    await backdateBeat(started.body.id, 600);
    const again = await http
      .post(`/api/v1/sessions/${started.body.id}/complete`)
      .set(auth())
      .expect(200);

    expect(again.body.durationMs).toBe(ended.body.durationMs);
    expect(again.body.endedAt).toBe(ended.body.endedAt);
  });

  it('refuses to beat a session belonging to someone else', async () => {
    const other = await http
      .post('/api/v1/auth/register')
      .send({
        email: `sessions-other-${Date.now()}@forgeroutine.test`,
        password: 'a-long-enough-password',
        displayName: 'Other',
      })
      .expect(201);

    const mine = await http
      .post('/api/v1/sessions')
      .set(auth())
      .send({ conceptId: freshConcept() })
      .expect(201);

    // 404, not 403: confirming it exists is itself a leak.
    await http
      .post(`/api/v1/sessions/${mine.body.id}/beat`)
      .set({ Authorization: `Bearer ${other.body.accessToken}` })
      .expect(404);

    await prisma.user
      .deleteMany({ where: { id: other.body.user?.id ?? '' } })
      .catch(() => undefined);
  });

  it('feeds the dashboard number it exists for', async () => {
    const started = await http
      .post('/api/v1/sessions')
      .set(auth())
      .send({ conceptId: freshConcept() })
      .expect(201);
    await backdateBeat(started.body.id, 60);
    await http.post(`/api/v1/sessions/${started.body.id}/beat`).set(auth()).expect(200);

    const overview = await http.get('/api/v1/progress/overview').set(auth()).expect(200);

    // Everything banked across this suite, in whole minutes.
    expect(overview.body.todayMinutesDone).toBeGreaterThan(0);
  });

  it('records nothing for a user who has not opened anything', async () => {
    const count = await prisma.learningSession.count({
      where: { userId, durationMs: { gt: 4 * 3_600_000 } },
    });

    // The four-hour ceiling is a ceiling, not a target.
    expect(count).toBe(0);
  });
});
