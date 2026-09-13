import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@forgeroutine/database';
import request from 'supertest';

import { AppModule } from '../src/app.module.js';
import { ProblemDetailsFilter } from '../src/common/filters/problem-details.filter.js';

/**
 * The §48 vertical slice, end to end against a real database and a real sandbox.
 *
 *   register → add technology → browse concepts → start session → get exercise
 *   → open attempt → write code → execute → submit → AI evaluation
 *   → skill progress recorded → next action recommended
 *
 * This is the test that answers the milestone question. Nothing here is mocked
 * except the AI provider, which is absent (no key in CI), so the evaluator
 * exercises its documented degraded path.
 *
 * Requires DATABASE_URL to point at a database that can be migrated.
 */

const prisma = new PrismaClient();

let app: INestApplication;
let http: ReturnType<typeof request>;

const user = {
  email: `slice-${Date.now()}@forgeroutine.test`,
  password: 'a-long-enough-password',
  displayName: 'Slice Test',
};

let accessToken: string;

const auth = () => ({ Authorization: `Bearer ${accessToken}` });

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new ProblemDetailsFilter());
  await app.init();

  http = request(app.getHttpServer());
}, 60_000);

afterAll(async () => {
  // Cascades clear every attempt, submission, skill and event for this user.
  await prisma.user.deleteMany({ where: { email: user.email } }).catch(() => undefined);
  await prisma.$disconnect();
  await app?.close();
});

/**
 * Brings the user to `slug`, the way working through the course would.
 *
 * Two gates gate an exercise and both have to be open:
 *
 *   - the **sequence**, which needs one passed attempt on each earlier
 *     concept, and
 *   - the **prerequisite graph**, which needs mastery above
 *     `UNLOCK_THRESHOLD` on each HARD prerequisite.
 *
 * So this records both a passed attempt and the skill that attempt would
 * have produced. Recording only the attempt leaves the graph gate shut, and
 * the failure looks identical — a 409 from a concept that says it is locked
 * behind something the user has visibly done.
 *
 * Written straight to the database because it is setup, not behaviour.
 * Reaching the third concept through the API would mean solving two
 * unrelated exercises first. The gates themselves are asserted in step 16.
 */
async function clearConceptsBefore(technologyId: string, slug: string): Promise<void> {
  const account = await prisma.user.findUnique({ where: { email: user.email } });
  if (!account) throw new Error('test user is missing');

  const concepts = await prisma.concept.findMany({
    where: { technologyId, archivedAt: null },
    orderBy: { orderIndex: 'asc' },
    include: { exercises: { where: { archivedAt: null }, select: { id: true }, take: 1 } },
  });

  const target = concepts.findIndex((concept) => concept.slug === slug);
  if (target < 0) throw new Error(`no concept ${slug}`);

  // Comfortably above UNLOCK_THRESHOLD (0.6), not 1: a test that only
  // passes at perfect mastery would hide a threshold that had crept up.
  const mastery = 0.8;

  for (const concept of concepts.slice(0, target)) {
    await prisma.skill.upsert({
      where: { userId_conceptId: { userId: account.id, conceptId: concept.id } },
      create: {
        userId: account.id,
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

    const existing = await prisma.exerciseAttempt.findFirst({
      where: { userId: account.id, exerciseId: exercise.id, outcome: 'PASSED' },
    });
    if (existing) continue;

    await prisma.exerciseAttempt.create({
      data: {
        userId: account.id,
        exerciseId: exercise.id,
        assistanceLevel: 3,
        openedAt: new Date(),
        completedAt: new Date(),
        outcome: 'PASSED',
      },
    });
  }
}

describe('vertical slice', () => {
  let technologyId: string;
  let conceptId: string;
  let exerciseId: string;
  let attemptId: string;

  it('1. registers a user and returns tokens', async () => {
    const response = await http.post('/api/v1/auth/register').send(user).expect(201);

    expect(response.body.accessToken).toEqual(expect.any(String));
    expect(response.body.refreshToken).toEqual(expect.any(String));
    accessToken = response.body.accessToken;
  });

  it('2. rejects a duplicate email with a problem document', async () => {
    const response = await http.post('/api/v1/auth/register').send(user).expect(409);

    expect(response.body.type).toContain('email-taken');
    expect(response.body.status).toBe(409);
  });

  it('3. adds JavaScript, importing its curriculum', async () => {
    const catalogue = await http.get('/api/v1/technologies').set(auth()).expect(200);
    const javascript = catalogue.body.find((t: { slug: string }) => t.slug === 'javascript');
    // Seed data must include JavaScript; everything below depends on it.
    expect(javascript).toBeDefined();

    const response = await http
      .post('/api/v1/technologies/mine')
      .set(auth())
      .send({ technologyId: javascript.id })
      .expect(201);

    expect(response.body.status).toBe('ACTIVE');
    technologyId = javascript.id;
  }, 60_000);

  it('4. lists concepts in learning order', async () => {
    const response = await http
      .get(`/api/v1/concepts?technologyId=${technologyId}`)
      .set(auth())
      .expect(200);

    expect(response.body.length).toBeGreaterThan(0);

    const orders = response.body.map((c: { orderIndex: number }) => c.orderIndex);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));

    const closures = response.body.find(
      (c: { slug: string }) => c.slug === 'functions-and-closures',
    );
    expect(closures).toBeDefined();
    conceptId = closures.id;

    // Everything from here to step 15 is about exercise mechanics — the
    // assistance ladder, execution, scoring — and none of it is about where
    // the concept sits in the course. So the course is walked up to this
    // point first.
    //
    // This used to be unnecessary: closures was the first concept in the
    // seeded set, and the only gate was the prerequisite graph, which it
    // cleared from a standing start. It is now the third concept of a
    // basics-to-advanced course, and a course is strictly sequential. The
    // gate itself is asserted once, in step 16, rather than tripped over
    // fifteen times here.
    await clearConceptsBefore(technologyId, 'functions-and-closures');
  });

  it('5. returns concept detail with readiness and prerequisites', async () => {
    const response = await http.get(`/api/v1/concepts/${conceptId}`).set(auth()).expect(200);

    expect(response.body.readiness.unlocked).toBe(true);
    expect(response.body.technologyName).toBe('JavaScript');
    expect(response.body.exerciseCount).toBeGreaterThan(0);
  });

  it('6. starts a learning session', async () => {
    const response = await http
      .post('/api/v1/sessions')
      .set(auth())
      .send({ conceptId })
      .expect(201);

    expect(response.body.startedAt).toEqual(expect.any(String));
  });

  it('7. serves an exercise at the user’s assistance level', async () => {
    const response = await http
      .get(`/api/v1/exercises?conceptId=${conceptId}`)
      .set(auth())
      .expect(200);

    expect(response.body.length).toBeGreaterThan(0);
    const exercise = response.body[0];

    // A new user starts at level 1 (Guided) and gets the full scaffolding.
    expect(exercise.assistanceLevel).toBe(1);
    expect(exercise.starterCode).not.toBeNull();
    expect(exercise.requirements).not.toBeNull();

    exerciseId = exercise.id;
  });

  it('8. opens an attempt', async () => {
    const response = await http
      .post(`/api/v1/exercises/${exerciseId}/attempts`)
      .set(auth())
      .send({ blindMode: false })
      .expect(201);

    expect(response.body.attemptId).toEqual(expect.any(String));
    attemptId = response.body.attemptId;
  });

  it('9. executes a wrong solution and reports which cases failed', async () => {
    const response = await http
      .post('/api/v1/submissions')
      .set(auth())
      .send({
        attemptId,
        language: 'javascript',
        // Returns the count without incrementing: a real, plausible mistake.
        code: 'export default function createCounter(start = 0) {\n  let count = start;\n  return () => count;\n}\n',
      })
      .expect(200);

    expect(response.body.execution.passed).toBe(false);
    expect(response.body.execution.testsTotal).toBeGreaterThan(0);
    expect(response.body.execution.testsPassed).toBeLessThan(response.body.execution.testsTotal);
    expect(response.body.attemptOutcome).toBe('FAILED');
    expect(response.body.nextActionHint).toEqual(expect.any(String));
  }, 60_000);

  it('10. executes a correct solution, passes, and records skill progress', async () => {
    const response = await http
      .post('/api/v1/submissions')
      .set(auth())
      .send({
        attemptId,
        language: 'javascript',
        code: 'export default function createCounter(start = 0) {\n  let count = start;\n  return () => ++count;\n}\n',
      })
      .expect(200);

    expect(response.body.execution.status).toBe('PASSED');
    expect(response.body.execution.passed).toBe(true);
    expect(response.body.attemptOutcome).toBe('PASSED');

    // Without an OPENAI_API_KEY the evaluator degrades to execution facts and
    // marks every subjective dimension unscored rather than zero.
    expect(response.body.evaluation).not.toBeNull();
    expect(response.body.evaluation.quality.correctness).toBe(1);
    if (response.body.evaluation.degraded) {
      expect(response.body.evaluation.quality.readability).toBeNull();
    }

    // The system remembered what the user actually did.
    expect(response.body.skillDeltas.length).toBeGreaterThan(0);
    const coding = response.body.skillDeltas.find(
      (d: { dimension: string }) => d.dimension === 'codingAbility',
    );
    expect(coding.after).toBeGreaterThan(coding.before);
  }, 60_000);

  it('11. persisted the skill to the database, not just the response', async () => {
    const account = await prisma.user.findUnique({ where: { email: user.email } });
    const skill = await prisma.skill.findUnique({
      where: { userId_conceptId: { userId: account!.id, conceptId } },
    });

    expect(skill).not.toBeNull();
    expect(skill!.codingAbility).toBeGreaterThan(0);
    expect(skill!.attempts).toBeGreaterThan(0);

    // The append-only ledger explains how the value got there.
    const events = await prisma.skillEvent.findMany({ where: { skillId: skill!.id } });
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]!.cause).toBe('EXERCISE_ATTEMPT');
  });

  it('12. scheduled a spaced-repetition review', async () => {
    const account = await prisma.user.findUnique({ where: { email: user.email } });
    const schedule = await prisma.reviewSchedule.findUnique({
      where: { userId_conceptId: { userId: account!.id, conceptId } },
    });

    expect(schedule).not.toBeNull();
    expect(schedule!.dueAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('13. recommends the next activity and withholds a premature score', async () => {
    const response = await http.get('/api/v1/progress/overview').set(auth()).expect(200);

    expect(response.body.greeting).toEqual(expect.any(String));
    expect(response.body.currentFocus).toContain('JavaScript');
    expect(response.body.nextAction).not.toBeNull();
    expect(response.body.nextAction.rationale).toEqual(expect.any(String));

    // One attempt is not five: the score must stay withheld rather than
    // showing a new user a demoralising number.
    expect(response.body.independence.status).toBe('INSUFFICIENT_DATA');
    expect(response.body.independence.score).toBeNull();
  });

  it('14. refuses a closed attempt', async () => {
    const response = await http
      .post('/api/v1/submissions')
      .set(auth())
      .send({ attemptId, language: 'javascript', code: 'export default () => 1;' })
      .expect(409);

    expect(response.body.type).toContain('attempt-closed');
  });

  it('15. refuses another user’s attempt without revealing it exists', async () => {
    const other = await http
      .post('/api/v1/auth/register')
      .send({
        email: `other-${Date.now()}@forgeroutine.test`,
        password: 'another-long-password',
        displayName: 'Other',
      })
      .expect(201);

    // 404, not 403: confirming the attempt exists would itself be a leak.
    await http
      .post('/api/v1/submissions')
      .set({ Authorization: `Bearer ${other.body.accessToken}` })
      .send({ attemptId, language: 'javascript', code: 'export default () => 1;' })
      .expect(404);
  });

  it('16. debugging: shows the broken code and grades diagnosis apart from the fix', async () => {
    const concepts = await http
      .get(`/api/v1/concepts?technologyId=${technologyId}`)
      .set(auth())
      .expect(200);

    const objects = concepts.body.find(
      (c: { slug: string }) => c.slug === 'objects-and-references',
    );
    expect(objects).toBeDefined();

    const exercises = await http
      .get(`/api/v1/exercises?conceptId=${objects.id}`)
      .set(auth())
      .expect(200);

    // By slug, not by kind. A concept can hold several debugging exercises —
    // the seeded one plus whatever generation added — and `find` would take
    // whichever sorted first, leaving the fix below matched against a
    // different bug. The test needs the exercise it has an answer for.
    const debugging = exercises.body.find(
      (e: { slug: string }) => e.slug === 'debug-splice-while-iterating',
    );
    expect(debugging).toBeDefined();

    // The bug is the problem statement, so it is served at every level (§13).
    expect(debugging.brokenCode).toEqual(expect.any(String));
    expect(debugging.requiresDiagnosis).toBe(true);

    // Readiness and the attempt endpoint must agree.
    //
    // Asserted as an invariant rather than as a fixed status code, because
    // how far into the course this concept sits depends on the curriculum —
    // fifth in the seeded set, fourth once generation fills in the basics.
    // A test hard-coding 409 here passes against one seed and fails against
    // the other, which says nothing about whether the gate works.
    //
    // What must always hold is that a concept the API reports as locked
    // cannot be started, and one it reports as open can.
    const before = await http.get(`/api/v1/concepts/${objects.id}`).set(auth()).expect(200);

    await http
      .post(`/api/v1/exercises/${debugging.id}/attempts`)
      .set(auth())
      .send({ blindMode: false })
      .expect(before.body.readiness.unlocked ? 201 : 409);

    await clearConceptsBefore(technologyId, 'objects-and-references');

    const after = await http.get(`/api/v1/concepts/${objects.id}`).set(auth()).expect(200);
    expect(after.body.readiness.unlocked).toBe(true);

    const attempt = await http
      .post(`/api/v1/exercises/${debugging.id}/attempts`)
      .set(auth())
      .send({ blindMode: false })
      .expect(201);

    const fixed = await http
      .post('/api/v1/submissions')
      .set(auth())
      .send({
        attemptId: attempt.body.attemptId,
        language: 'javascript',
        diagnosis:
          'splice shifts later elements down while the index still advances, so the ' +
          'element after a removed one is skipped.',
        code: [
          'export default function removeEvens(numbers) {',
          '  return numbers.filter((n) => n % 2 !== 0);',
          '}',
        ].join('\n'),
      })
      .expect(200);

    expect(fixed.body.execution.passed).toBe(true);

    // The diagnosis is graded on its own, so a lucky fix cannot claim the
    // debugging skill. Without an AI key it is recorded but unscored.
    expect(fixed.body.diagnosis).not.toBeNull();
    expect(fixed.body.diagnosis.feedback).toEqual(expect.any(String));
  }, 60_000);

  it('17. debugging: a missing diagnosis scores zero rather than being ignored', async () => {
    const concepts = await http
      .get(`/api/v1/concepts?technologyId=${technologyId}`)
      .set(auth())
      .expect(200);
    const closures = concepts.body.find(
      (c: { slug: string }) => c.slug === 'functions-and-closures',
    );

    const exercises = await http
      .get(`/api/v1/exercises?conceptId=${closures.id}`)
      .set(auth())
      .expect(200);
    // By slug, for the same reason as step 16.
    const debugging = exercises.body.find((e: { slug: string }) => e.slug === 'debug-loop-closure');
    expect(debugging).toBeDefined();

    const attempt = await http
      .post(`/api/v1/exercises/${debugging.id}/attempts`)
      .set(auth())
      .send({ blindMode: false })
      .expect(201);

    const response = await http
      .post('/api/v1/submissions')
      .set(auth())
      .send({
        attemptId: attempt.body.attemptId,
        language: 'javascript',
        code: [
          'export default function makeHandlers(items) {',
          '  return items.map((item) => () => item);',
          '}',
        ].join('\n'),
      })
      .expect(200);

    expect(response.body.execution.passed).toBe(true);
    expect(response.body.diagnosis.accuracy).toBe(0);
  }, 60_000);

  it('18. rejects an unauthenticated request', async () => {
    await http.get('/api/v1/progress/overview').expect(401);
  });

  it('19. validates input before it reaches a use-case', async () => {
    const response = await http
      .post('/api/v1/auth/register')
      // Comfortably under the minimum, so the test keeps its meaning if the
      // floor moves again.
      .send({ email: 'not-an-email', password: 'ab', displayName: '' })
      .expect(400);

    expect(response.body.type).toContain('validation-failed');
    expect(Object.keys(response.body.errors)).toEqual(
      expect.arrayContaining(['email', 'password']),
    );
  });
});
