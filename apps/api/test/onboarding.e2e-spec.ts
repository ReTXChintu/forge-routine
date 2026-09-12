import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@forgeroutine/database';
import request from 'supertest';

import { AppModule } from '../src/app.module.js';
import { ProblemDetailsFilter } from '../src/common/filters/problem-details.filter.js';

/**
 * Onboarding through to a persisted roadmap, against a real database.
 *
 * The assertions that matter are the ordering ones: a roadmap that schedules
 * Node.js before JavaScript, or loses finished work on a replan, is worse than
 * no roadmap at all.
 */

const prisma = new PrismaClient();

let app: INestApplication;
let http: ReturnType<typeof request>;
let accessToken: string;

const user = {
  email: `onboard-${Date.now()}@forgeroutine.test`,
  password: 'a-long-enough-password',
  displayName: 'Onboarding Test',
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
}, 60_000);

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: user.email } }).catch(() => undefined);
  await prisma.$disconnect();
  await app?.close();
});

describe('onboarding and roadmap', () => {
  let javascriptId: string;
  let nodeId: string;

  it('reports onboarding as incomplete for a new account', async () => {
    const response = await http.get('/api/v1/onboarding/status').set(auth()).expect(200);

    expect(response.body.completed).toBe(false);
    expect(response.body.hasRoadmap).toBe(false);
    expect(response.body.technologyCount).toBe(0);
  });

  it('completes onboarding and returns an ordered roadmap', async () => {
    const catalogue = await http.get('/api/v1/technologies').set(auth()).expect(200);
    javascriptId = catalogue.body.find((t: { slug: string }) => t.slug === 'javascript').id;
    nodeId = catalogue.body.find((t: { slug: string }) => t.slug === 'nodejs').id;

    const response = await http
      .post('/api/v1/onboarding/complete')
      .set(auth())
      .send({
        // Node listed FIRST and ranked CRITICAL, to prove dependency beats
        // preference: JavaScript must still come first.
        technologies: [
          { technologyId: nodeId, priority: 'CRITICAL', interviewImportance: 5 },
          {
            technologyId: javascriptId,
            priority: 'LOW',
            interviewImportance: 1,
            // Non-null on purpose: this is what triggers skill seeding, and
            // seeding used to blow the transaction timeout on a remote
            // database by issuing three round-trips per concept.
            existingKnowledge: 0.25,
          },
        ],
        dailyMinutes: 60,
        primaryGoal: 'INTERVIEW',
        interviewTarget: 'SENIOR',
      })
      .expect(200);

    const { roadmap } = response.body;
    expect(roadmap.phases.length).toBeGreaterThan(0);
    expect(roadmap.totalMinutes).toBeGreaterThan(0);
    expect(roadmap.generatedBy).toBe('rules');
  }, 120_000);

  it('seeded skills from the declared existing knowledge', async () => {
    const account = await prisma.user.findUnique({ where: { email: user.email } });
    const skills = await prisma.skill.findMany({
      where: { userId: account!.id, concept: { technologyId: javascriptId } },
    });

    expect(skills.length).toBeGreaterThan(0);
    for (const skill of skills) {
      expect(skill.conceptMastery).toBeCloseTo(0.25, 2);
      // Coding ability is seeded lower than mastery: self-assessment is
      // systematically overconfident about implementation.
      expect(skill.codingAbility).toBeLessThan(skill.conceptMastery);
    }

    // The ledger explains where those numbers came from.
    const events = await prisma.skillEvent.findMany({
      where: { userId: account!.id, cause: 'INITIAL_ESTIMATE' },
    });
    expect(events.length).toBe(skills.length);
  });

  it('scheduled JavaScript before Node.js, despite Node being ranked higher', async () => {
    const response = await http.get('/api/v1/roadmap').set(auth()).expect(200);

    const titles = response.body.phases.map((p: { title: string }) => p.title);
    const firstJs = titles.findIndex((t: string) => t.startsWith('JavaScript'));
    const firstNode = titles.findIndex((t: string) => t.startsWith('Node.js'));

    expect(firstJs).toBeGreaterThanOrEqual(0);
    expect(firstNode).toBeGreaterThanOrEqual(0);
    expect(firstJs).toBeLessThan(firstNode);
  });

  it('gives every item a rationale and closes phases with a project or checkpoint', async () => {
    const response = await http.get('/api/v1/roadmap').set(auth()).expect(200);

    for (const phase of response.body.phases) {
      if (phase.items.length === 0) continue;
      for (const item of phase.items) {
        expect(item.rationale.length).toBeGreaterThan(10);
      }
      const last = phase.items[phase.items.length - 1];
      expect(['PROJECT', 'CHECKPOINT', 'INTERVIEW']).toContain(last.kind);
    }
  });

  it('adds interview checkpoints, because the goal was INTERVIEW', async () => {
    const response = await http.get('/api/v1/roadmap').set(auth()).expect(200);

    const kinds = response.body.phases.flatMap((p: { items: { kind: string }[] }) =>
      p.items.map((i) => i.kind),
    );

    expect(kinds).toContain('INTERVIEW');
  });

  it('marks the first actionable item as current', async () => {
    const response = await http.get('/api/v1/roadmap').set(auth()).expect(200);

    expect(response.body.currentItemId).toEqual(expect.any(String));
  });

  it('records progress on an item', async () => {
    const before = await http.get('/api/v1/roadmap').set(auth()).expect(200);
    const itemId = before.body.currentItemId;

    const updated = await http
      .patch(`/api/v1/roadmap/items/${itemId}`)
      .set(auth())
      .send({ status: 'DONE' })
      .expect(200);

    expect(updated.body.status).toBe('DONE');

    const after = await http.get('/api/v1/roadmap').set(auth()).expect(200);
    expect(after.body.completedMinutes).toBeGreaterThan(0);
    expect(after.body.currentItemId).not.toBe(itemId);
  });

  it('carries completed work across a replan', async () => {
    const before = await http.get('/api/v1/roadmap').set(auth()).expect(200);
    const doneBefore = before.body.phases
      .flatMap((p: { items: { status: string }[] }) => p.items)
      .filter((i: { status: string }) => i.status === 'DONE').length;

    expect(doneBefore).toBeGreaterThan(0);

    const replanned = await http.post('/api/v1/roadmap/regenerate').set(auth()).expect(200);

    // Item ids change on a replan; progress must not, because it is carried
    // over by what the item points at rather than by item id.
    expect(replanned.body.version).toBe(before.body.version + 1);

    const doneAfter = replanned.body.phases
      .flatMap((p: { items: { status: string }[] }) => p.items)
      .filter((i: { status: string }) => i.status === 'DONE').length;

    expect(doneAfter).toBe(doneBefore);
  }, 60_000);

  it('supersedes the previous roadmap rather than leaving two active', async () => {
    const account = await prisma.user.findUnique({ where: { email: user.email } });
    const active = await prisma.roadmap.count({
      where: { userId: account!.id, status: 'ACTIVE' },
    });

    expect(active).toBe(1);
  });

  it('reports onboarding complete afterwards', async () => {
    const response = await http.get('/api/v1/onboarding/status').set(auth()).expect(200);

    expect(response.body.completed).toBe(true);
    expect(response.body.hasRoadmap).toBe(true);
    expect(response.body.technologyCount).toBe(2);
  });

  it('refuses a roadmap item belonging to someone else, without revealing it exists', async () => {
    const roadmap = await http.get('/api/v1/roadmap').set(auth()).expect(200);
    const itemId = roadmap.body.currentItemId;

    const other = await http
      .post('/api/v1/auth/register')
      .send({
        email: `other-onboard-${Date.now()}@forgeroutine.test`,
        password: 'another-long-password',
        displayName: 'Other',
      })
      .expect(201);

    // 404, not 403.
    await http
      .patch(`/api/v1/roadmap/items/${itemId}`)
      .set({ Authorization: `Bearer ${other.body.accessToken}` })
      .send({ status: 'DONE' })
      .expect(404);
  });

  it('rejects onboarding with no technologies', async () => {
    const response = await http
      .post('/api/v1/onboarding/complete')
      .set(auth())
      .send({ technologies: [] })
      .expect(400);

    expect(response.body.type).toContain('validation-failed');
  });
});
