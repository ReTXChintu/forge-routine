import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@forgeroutine/database';
import request from 'supertest';

import { AppModule } from '../src/app.module.js';
import { ProblemDetailsFilter } from '../src/common/filters/problem-details.filter.js';

/**
 * Work that survives leaving the page, against a real database.
 *
 * Both properties here come from the same report: code was written, the
 * tests passed, the user navigated away, and on returning the editor held
 * the starter code again and the routine still listed the exercise as
 * outstanding. Doing an exercise twice because the system forgot the first
 * time is the fastest way to lose someone's trust in a product whose whole
 * claim is that effort accumulates.
 *
 *   1. A draft is kept, and it is what the editor opens with next time.
 *   2. Passing finishes the routine item. There is no button to forget.
 */

const prisma = new PrismaClient();

let app: INestApplication;
let http: ReturnType<typeof request>;
let accessToken: string;
let userId: string;
let exerciseId: string;

const user = {
  email: `attempt-${Date.now()}@forgeroutine.test`,
  password: 'a-long-enough-password',
  displayName: 'Attempt Test',
};

const auth = () => ({ Authorization: `Bearer ${accessToken}` });

/** The correct answer to the seeded closures exercise. */
const SOLUTION =
  'export default function createCounter(start = 0) {\n  let count = start;\n  return () => ++count;\n}\n';

/**
 * Walks the course up to the closures concept.
 *
 * Two gates stand in the way — the course sequence, which wants a passed
 * attempt on every earlier concept, and the prerequisite graph, which wants
 * mastery on each HARD prerequisite — and both have to be satisfied or the
 * failure looks like a concept locked behind work the user has visibly
 * done. Written straight to the database because it is setup: neither gate
 * is what this file is about.
 */
async function clearConceptsBefore(technologyId: string, slug: string): Promise<string> {
  const concepts = await prisma.concept.findMany({
    where: { technologyId, archivedAt: null },
    orderBy: { orderIndex: 'asc' },
    include: { exercises: { where: { archivedAt: null }, select: { id: true }, take: 1 } },
  });

  const target = concepts.findIndex((concept) => concept.slug === slug);
  if (target < 0) throw new Error(`Seed data is missing the ${slug} concept`);

  // Comfortably above UNLOCK_THRESHOLD (0.6) rather than perfect.
  const mastery = 0.8;

  for (const concept of concepts.slice(0, target)) {
    await prisma.skill.upsert({
      where: { userId_conceptId: { userId, conceptId: concept.id } },
      create: {
        userId,
        conceptId: concept.id,
        attempts: 1,
        conceptMastery: mastery,
        codingAbility: mastery,
        recallStrength: mastery,
        lastPracticedAt: new Date(),
      },
      update: { conceptMastery: mastery, attempts: { increment: 0 } },
    });

    const exercise = concept.exercises[0];
    if (!exercise) continue;

    await prisma.exerciseAttempt.create({
      data: {
        userId,
        exerciseId: exercise.id,
        assistanceLevel: 3,
        openedAt: new Date(),
        completedAt: new Date(),
        outcome: 'PASSED',
      },
    });
  }

  return concepts[target]!.id;
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
  userId = (await prisma.user.findUnique({ where: { email: user.email } }))!.id;

  const catalogue = await http.get('/api/v1/technologies').set(auth()).expect(200);
  const javascript = catalogue.body.find((t: { slug: string }) => t.slug === 'javascript');
  expect(javascript).toBeDefined();

  await http
    .post('/api/v1/technologies/mine')
    .set(auth())
    .send({ technologyId: javascript.id })
    .expect(201);

  const conceptId = await clearConceptsBefore(javascript.id, 'functions-and-closures');

  const exercises = await http
    .get(`/api/v1/exercises?conceptId=${conceptId}`)
    .set(auth())
    .expect(200);
  expect(exercises.body.length).toBeGreaterThan(0);
  exerciseId = exercises.body[0].id;
}, 180_000);

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: user.email } }).catch(() => undefined);
  await prisma.$disconnect();
  await app?.close();
});

const open = async () =>
  (
    await http
      .post(`/api/v1/exercises/${exerciseId}/attempts`)
      .set(auth())
      .send({ blindMode: false })
      .expect(201)
  ).body;

describe('an attempt that outlives the page', () => {
  it('opens empty the first time', async () => {
    const attempt = await open();

    expect(attempt.draftCode).toBeNull();
    expect(attempt.draftSavedAt).toBeNull();
    expect(attempt.solvedAt).toBeNull();
  });

  it('hands back what was in the editor, not the starter code', async () => {
    const attempt = await open();
    const halfFinished = '// thinking\nexport default function createCounter() {}\n';

    await http
      .put(`/api/v1/exercises/attempts/${attempt.attemptId}/draft`)
      .set(auth())
      .send({ code: halfFinished })
      .expect(204);

    // What a reload does. The attempt is reused, so this is the same one.
    const reopened = await open();

    expect(reopened.attemptId).toBe(attempt.attemptId);
    expect(reopened.draftCode).toBe(halfFinished);
    expect(reopened.draftSavedAt).toEqual(expect.any(String));
  });

  it('accepts an emptied editor rather than resurrecting deleted code', async () => {
    const attempt = await open();

    await http
      .put(`/api/v1/exercises/attempts/${attempt.attemptId}/draft`)
      .set(auth())
      .send({ code: '' })
      .expect(204);

    expect((await open()).draftCode).toBe('');
  });

  it('refuses to save into an attempt belonging to someone else', async () => {
    const attempt = await open();
    const other = await http
      .post('/api/v1/auth/register')
      .send({
        email: `attempt-other-${Date.now()}@forgeroutine.test`,
        password: 'a-long-enough-password',
        displayName: 'Other',
      })
      .expect(201);

    // 404, not 403: confirming it exists is itself a leak.
    await http
      .put(`/api/v1/exercises/attempts/${attempt.attemptId}/draft`)
      .set({ Authorization: `Bearer ${other.body.accessToken}` })
      .send({ code: 'nice try' })
      .expect(404);

    await prisma.user
      .deleteMany({ where: { id: other.body.user?.id ?? '' } })
      .catch(() => undefined);
  });

  it('finishes the routine item when the tests pass, with nothing to press', async () => {
    // Today's plan, built the way the app builds it.
    const routine = await http.get('/api/v1/routines/today').set(auth()).expect(200);

    // Plant the exercise on today's plan. Whether the planner happened to
    // choose this one is not what is under test — what happens when it is
    // chosen and then solved is.
    const item = await prisma.routineItem.create({
      data: {
        routineId: routine.body.id,
        kind: 'CODE',
        title: 'Practise closures',
        minutes: 15,
        orderIndex: 900,
        exerciseId,
      },
    });

    const attempt = await open();
    const submitted = await http
      .post('/api/v1/submissions')
      .set(auth())
      .send({ attemptId: attempt.attemptId, language: 'javascript', code: SOLUTION })
      .expect(200);

    expect(submitted.body.execution.passed).toBe(true);

    const after = await prisma.routineItem.findUnique({ where: { id: item.id } });
    expect(after!.status).toBe('DONE');

    // And the day's total moved with it, so the dashboard agrees.
    const updated = await prisma.routine.findUnique({ where: { id: routine.body.id } });
    expect(updated!.completedMinutes).toBeGreaterThanOrEqual(15);
  }, 120_000);

  it('says the exercise is already solved when it is reopened', async () => {
    const reopened = await open();

    expect(reopened.solvedAt).toEqual(expect.any(String));
    // A new attempt, because the old one closed on passing — but opening
    // with the solution they wrote rather than the starter code.
    expect(reopened.draftCode).toBe(SOLUTION);
  });
});
