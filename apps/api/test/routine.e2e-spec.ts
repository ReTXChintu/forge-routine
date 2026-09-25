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

  it('puts DSA on the plan as a single row', async () => {
    const dsaItems = items.filter((item) => item.title.startsWith('DSA'));

    // One row, not three. The technique, the questions on it and the day's
    // problem all live on the concept's own page — a routine that listed
    // them separately was showing the inside of a task rather than the task.
    expect(dsaItems).toHaveLength(1);
    expect(dsaItems[0]!.kind).toBe('LEARN');
    expect(dsaItems[0]!.conceptId).toBeTruthy();
    // And it is budgeted for both halves, or the day's minutes would
    // under-count every concept on it.
    expect(dsaItems[0]!.minutes).toBeGreaterThan(10);
  });

  it('never shows the inside of a task as its own row', async () => {
    // The rule the routine tab turns on: a row is a thing to open, never a
    // step within one. Question batches and individual exercises used to get
    // their own rows, which is what made the plan unreadable.
    expect(items.filter((item) => item.kind === 'RECALL')).toHaveLength(0);

    for (const item of items) {
      expect(item.title).not.toMatch(/\d+ questions on /i);
    }
  });

  it('points a concept row at the concept, not at one exercise', async () => {
    // What makes a row openable onto the whole concept page — both halves of
    // it — rather than straight into one exercise. Deliberately asserted from
    // the row's shape rather than by fetching the practice set: opening a set
    // for the first time generates questions, and this suite's last test
    // proves that planning a day spends nothing.
    const concepts = items.filter((item) => item.kind === 'LEARN');

    expect(concepts.length).toBeGreaterThan(0);
    for (const item of concepts) {
      expect(item.conceptId).toBeTruthy();
      expect(item.exerciseId).toBeNull();
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

  it('carries unfinished work forward instead of dropping it', async () => {
    // Backdate today's routine so the next plan sees it as yesterday's,
    // then leave one item unfinished and replan.
    const account = await prisma.user.findUnique({ where: { email: user.email } });
    const yesterday = new Date();
    yesterday.setHours(0, 0, 0, 0);
    yesterday.setDate(yesterday.getDate() - 1);

    const todays = await prisma.routine.findFirst({
      where: { userId: account!.id },
      orderBy: { date: 'desc' },
      include: { items: true },
    });

    const unfinished = todays!.items.filter((item) => item.status === 'PENDING');
    expect(unfinished.length).toBeGreaterThan(0);

    await prisma.routine.update({ where: { id: todays!.id }, data: { date: yesterday } });

    const replanned = await http.get('/api/v1/routines/today').set(auth()).expect(200);

    expect(replanned.body.carriedCount).toBeGreaterThan(0);

    const carried = replanned.body.items.filter(
      (item: Item & { carriedFrom: string | null }) => item.carriedFrom !== null,
    );
    // The same titles, on a new day, marked with where they came from.
    expect(carried.map((item: Item) => item.title)).toEqual(
      expect.arrayContaining([unfinished[0]!.title]),
    );

    // And yesterday's copies are CARRIED, so they cannot be picked up twice.
    const after = await prisma.routineItem.findMany({ where: { routineId: todays!.id } });
    expect(after.filter((item) => item.status === 'PENDING')).toHaveLength(0);
    expect(after.some((item) => item.status === 'CARRIED')).toBe(true);
  });

  it('refuses to skip an item', async () => {
    const latest = await http.get('/api/v1/routines/today').set(auth()).expect(200);
    const item = latest.body.items[0];

    // Skipping is not a transition any more: unfinished work carries.
    await http
      .patch(`/api/v1/routines/items/${item.id}`)
      .set(auth())
      .send({ status: 'SKIPPED' })
      .expect(400);
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
