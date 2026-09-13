import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@forgeroutine/database';
import request from 'supertest';

import { AppModule } from '../src/app.module.js';
import { ProblemDetailsFilter } from '../src/common/filters/problem-details.filter.js';

/**
 * The daily plan, end to end, against a real database.
 *
 * Three promises are under test, and all three are ones a user would notice
 * breaking:
 *
 *   1. The plan builds itself. Asking the user to press "plan today" was
 *      asking them to make a decision the app had already made.
 *   2. DSA is on it. Every day, whether or not they chose it, and whether or
 *      not the budget is comfortable.
 *   3. It works with AI switched off. Everything here is arithmetic over a
 *      seeded curriculum, and no part of it may start needing a model.
 */

const prisma = new PrismaClient();

let app: INestApplication;
let http: ReturnType<typeof request>;
let accessToken: string;

const user = {
  email: `routine-${Date.now()}@forgeroutine.test`,
  password: 'a-long-enough-password',
  displayName: 'Routine Test',
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

  const catalogue = await http.get('/api/v1/technologies').set(auth()).expect(200);
  const javascript = catalogue.body.find((t: { slug: string }) => t.slug === 'javascript');

  await http
    .post('/api/v1/onboarding/complete')
    .set(auth())
    .send({
      // Deliberately does NOT include DSA. The point is that it arrives
      // anyway.
      technologies: [
        {
          technologyId: javascript.id,
          priority: 'HIGH',
          targetProficiency: 'PROFICIENT',
          interviewImportance: 4,
          existingKnowledge: 0,
        },
      ],
      dailyMinutes: 45,
      primaryGoal: 'CODING',
      interviewTarget: 'MID',
    })
    .expect(200);
}, 120_000);

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: user.email } }).catch(() => undefined);
  await prisma.$disconnect();
  await app?.close();
});

interface Item {
  id: string;
  kind: string;
  title: string;
  minutes: number;
  rationale: string;
  conceptId: string | null;
  exerciseId: string | null;
  questionCount: number;
}

describe("today's routine", () => {
  let items: Item[];

  it('plans the day on first look, with no explicit generate call', async () => {
    const response = await http.get('/api/v1/routines/today').set(auth()).expect(200);

    expect(response.body.id).toBeTruthy();
    expect(response.body.items.length).toBeGreaterThan(0);

    items = response.body.items;
  });

  it('adds DSA even though the user never chose it', async () => {
    const dsa = await prisma.technology.findUnique({ where: { slug: 'dsa' } });
    // Seeded, not generated. A missing row means pnpm db:seed has not run.
    expect(dsa).toBeTruthy();

    const owned = await prisma.userTechnology.findFirst({
      where: { user: { email: user.email }, technologyId: dsa!.id },
    });

    // Onboarding must add it even though the user never picked it.
    expect(owned).toBeTruthy();
    expect(owned!.status).toBe('ACTIVE');
  });

  it('puts a DSA concept and exactly one DSA problem on the plan', async () => {
    const dsaItems = items.filter((item) => item.title.startsWith('DSA'));

    expect(dsaItems.some((item) => item.kind === 'LEARN')).toBe(true);

    // Exactly one. Two problems a day is a different product, and the thing
    // that makes a daily habit survive a bad day is that it is small.
    const problems = dsaItems.filter((item) => item.kind === 'CODE');
    expect(problems).toHaveLength(1);
    expect(problems[0]!.exerciseId).toBeTruthy();
  });

  it('asks questions on the concepts it just taught', async () => {
    const recall = items.filter((item) => item.kind === 'RECALL');

    expect(recall.length).toBeGreaterThan(0);
    for (const item of recall) {
      expect(item.conceptId).toBeTruthy();
      expect(item.questionCount).toBeGreaterThan(0);
    }
  });

  it('serves the questions behind a RECALL item', async () => {
    const recall = items.find((item) => item.kind === 'RECALL')!;

    const response = await http
      .get(`/api/v1/recall/due?conceptId=${recall.conceptId}&limit=${recall.questionCount}`)
      .set(auth())
      .expect(200);

    expect(response.body.length).toBeGreaterThan(0);
    expect(response.body.length).toBeLessThanOrEqual(recall.questionCount);

    for (const prompt of response.body) {
      expect(prompt.conceptId).toBe(recall.conceptId);
      expect(prompt.options.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('explains why every item is there', async () => {
    // An opaque routine is not a trusted one, and an empty rationale on one
    // row is how that starts.
    for (const item of items) {
      expect(`${item.title}: ${item.rationale}`).not.toMatch(/: $/);
      expect(item.rationale.length).toBeGreaterThan(0);
    }
  });

  it('returns the same plan on a second look rather than replanning', async () => {
    const again = await http.get('/api/v1/routines/today').set(auth()).expect(200);

    expect(again.body.items.map((item: Item) => item.id)).toEqual(items.map((item) => item.id));
  });

  it('records progress against the plan', async () => {
    const first = items[0]!;

    await http
      .patch(`/api/v1/routines/items/${first.id}`)
      .set(auth())
      .send({ status: 'DONE' })
      .expect(200);

    const after = await http.get('/api/v1/routines/today').set(auth()).expect(200);
    expect(after.body.completedMinutes).toBe(first.minutes);
  });

  it('costs nothing — no model call is made planning a day', async () => {
    const since = new Date(Date.now() - 10 * 60_000);
    const calls = await prisma.aIInteraction.count({
      where: { user: { email: user.email }, createdAt: { gte: since } },
    });

    // Planning a day is arithmetic. If this ever fails, something in the
    // planner started asking a model a question it could answer itself.
    expect(calls).toBe(0);
  });
});
