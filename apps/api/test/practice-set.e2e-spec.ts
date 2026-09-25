import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@forgeroutine/database';
import request from 'supertest';

import { AppModule } from '../src/app.module.js';
import { ProblemDetailsFilter } from '../src/common/filters/problem-details.filter.js';

/**
 * Practice on a concept, end to end, against a real database.
 *
 * Practice used to be whatever coding exercises a concept happened to ship
 * — often one. A set now mixes multiple choice with written answers, and
 * the property that makes the written half worth anything is an ordering
 * one: the model answer must not exist anywhere in the response until the
 * user's own answer is stored. An endpoint that hands over both at once
 * turns every written question into reading comprehension.
 *
 * No AI here. The questions are planted directly, because what is under
 * test is the answering contract rather than the writing of them — and a
 * suite that needed a vendor key would not run.
 */

const prisma = new PrismaClient();

let app: INestApplication;
let http: ReturnType<typeof request>;
let accessToken: string;
let conceptId: string;
let mcqId: string;
let theoryId: string;

const user = {
  email: `practice-${Date.now()}@forgeroutine.test`,
  password: 'a-long-enough-password',
  displayName: 'Practice Test',
};

const auth = () => ({ Authorization: `Bearer ${accessToken}` });

const MODEL_ANSWER =
  'A closure keeps a reference to the variable, not a copy of its value, so the ' +
  'function sees whatever the variable holds when it finally runs.';

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new ProblemDetailsFilter());
  await app.init();
  http = request(app.getHttpServer());

  const registered = await http.post('/api/v1/auth/register').send(user).expect(201);
  accessToken = registered.body.accessToken;

  const concept = await prisma.concept.findFirst({
    where: { archivedAt: null },
    select: { id: true },
  });
  if (!concept) throw new Error('Seed data has no concepts');
  conceptId = concept.id;

  const mcq = await prisma.conceptQuestion.create({
    data: {
      conceptId,
      kind: 'MCQ',
      prompt: 'What does a closure capture?',
      options: ['The variable', 'A copy of its value', 'Nothing'],
      correctIndex: 0,
      explanation: 'It captures the binding, which is why a later reassignment is visible.',
      difficulty: 2,
    },
  });
  mcqId = mcq.id;

  const theory = await prisma.conceptQuestion.create({
    data: {
      conceptId,
      kind: 'THEORY',
      prompt: 'Why does a loop with var print the same number every time?',
      modelAnswer: MODEL_ANSWER,
      keyPoints: ['One shared binding', 'The callbacks run after the loop'],
      difficulty: 3,
    },
  });
  theoryId = theory.id;
}, 180_000);

afterAll(async () => {
  await prisma.conceptQuestion
    .deleteMany({ where: { id: { in: [mcqId, theoryId] } } })
    .catch(() => undefined);
  await prisma.user.deleteMany({ where: { email: user.email } }).catch(() => undefined);
  await prisma.$disconnect();
  await app?.close();
});

const fetchSet = async () =>
  (await http.get(`/api/v1/concepts/${conceptId}/practice-set`).set(auth()).expect(200)).body;

describe('a practice set', () => {
  it('asks more than one question, and in more than one way', async () => {
    const set = await fetchSet();

    expect(set.available).toBe(true);
    expect(set.questions.length).toBeGreaterThan(1);
    expect(set.questions.map((q: { kind: string }) => q.kind)).toEqual(
      expect.arrayContaining(['MCQ', 'THEORY']),
    );
  });

  it('never ships the answers to the client', async () => {
    const set = await fetchSet();
    const serialised = JSON.stringify(set);

    // The whole response, not just the fields: a correctIndex leaking
    // through some nested shape would be just as fatal.
    expect(serialised).not.toContain(MODEL_ANSWER);
    expect(serialised).not.toContain('correctIndex');
    expect(serialised).not.toContain('keyPoints');

    const theory = set.questions.find((q: { id: string }) => q.id === theoryId);
    expect(theory.options).toEqual([]);
  });

  it('reveals the model answer only once theirs is in', async () => {
    const written = 'Because var has one binding for the whole loop.';

    const response = await http
      .post(`/api/v1/concepts/questions/${theoryId}/answer`)
      .set(auth())
      .send({ answer: written })
      .expect(200);

    expect(response.body.modelAnswer).toBe(MODEL_ANSWER);
    expect(response.body.keyPoints).toHaveLength(2);

    // And what they wrote is kept, so the written half leaves a trace.
    const stored = await prisma.conceptTheoryAnswer.findFirst({
      where: { questionId: theoryId },
      orderBy: { createdAt: 'desc' },
    });
    expect(stored!.answer).toBe(written);
    expect(stored!.selfRating).toBeNull();
  });

  it('refuses an empty answer rather than revealing for nothing', async () => {
    await http
      .post(`/api/v1/concepts/questions/${theoryId}/answer`)
      .set(auth())
      .send({ answer: '   ' })
      .expect(400);
  });

  it('records their verdict and reschedules the concept', async () => {
    const response = await http
      .post(`/api/v1/concepts/questions/${theoryId}/rating`)
      .set(auth())
      .send({ selfRating: 2 })
      .expect(200);

    expect(response.body.nextDueAt).toEqual(expect.any(String));
    expect(new Date(response.body.nextDueAt).getTime()).toBeGreaterThan(Date.now());

    const stored = await prisma.conceptTheoryAnswer.findFirst({
      where: { questionId: theoryId },
      orderBy: { createdAt: 'desc' },
    });
    expect(stored!.selfRating).toBe(2);
  });

  it('shows them what they wrote last time', async () => {
    const set = await fetchSet();
    const theory = set.questions.find((q: { id: string }) => q.id === theoryId);

    expect(theory.previousAnswer).toBe('Because var has one binding for the whole loop.');
  });

  it('will not rate a question that was never answered', async () => {
    const unanswered = await prisma.conceptQuestion.create({
      data: {
        conceptId,
        kind: 'THEORY',
        prompt: 'Never answered.',
        modelAnswer: 'Nor revealed.',
        keyPoints: ['a', 'b'],
      },
    });

    await http
      .post(`/api/v1/concepts/questions/${unanswered.id}/rating`)
      .set(auth())
      .send({ selfRating: 2 })
      .expect(400);

    await prisma.conceptQuestion.delete({ where: { id: unanswered.id } });
  });

  it('marks multiple choice, and explains it either way', async () => {
    const wrong = await http
      .post('/api/v1/recall/answer')
      .set(auth())
      .send({ questionId: mcqId, selectedIndex: 1 })
      .expect(200);

    expect(wrong.body.correct).toBe(false);
    expect(wrong.body.correctIndex).toBe(0);
    expect(wrong.body.explanation).not.toHaveLength(0);
  });

  it('refuses to mark a written question by index', async () => {
    // correctIndex defaults to 0 on a THEORY row, so an unguarded recall
    // answer of "0" would come back correct for a question with no options.
    await http
      .post('/api/v1/recall/answer')
      .set(auth())
      .send({ questionId: theoryId, selectedIndex: 0 })
      .expect(400);
  });

  it('keeps written questions out of the between-activity prompts', async () => {
    const due = await http
      .get(`/api/v1/recall/due?conceptId=${conceptId}&limit=10`)
      .set(auth())
      .expect(200);

    expect(due.body.every((prompt: { options: string[] }) => prompt.options.length > 0)).toBe(true);
    expect(due.body.map((prompt: { id: string }) => prompt.id)).not.toContain(theoryId);
  });
});
