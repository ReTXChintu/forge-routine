import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@forgeroutine/database';
import request from 'supertest';

import { AppModule } from '../src/app.module.js';
import { ProblemDetailsFilter } from '../src/common/filters/problem-details.filter.js';

/**
 * Practice on a concept, end to end, against a real database.
 *
 * Three properties, and each is a bug that was actually reported:
 *
 *   The pool is shared, the assignment is not. Questions anyone has
 *   generated are there for everyone, so a second user works the existing
 *   ones instead of paying for near-duplicates — but completion is measured
 *   against the batches *you* pulled, or a concept that grows behind you
 *   could never be finished and somebody else's question could un-finish
 *   yours.
 *
 *   The concept finishes itself. Every question answered and every served
 *   exercise passed ticks off the routine row, with no button to forget.
 *
 *   The model answer is withheld until the user's own is stored. Reading a
 *   good answer and then judging yours against it measures nothing.
 *
 * No AI here. The pool is planted directly, because what is under test is
 * the serving and completion contract rather than the writing of questions —
 * and a suite that needed a vendor key would not run.
 */

const prisma = new PrismaClient();

let app: INestApplication;
let http: ReturnType<typeof request>;
let accessToken: string;
let userId: string;
let technologyId: string;
let conceptId: string;
let exerciseId: string;
const questionIds: string[] = [];

const user = {
  email: `practice-${Date.now()}@forgeroutine.test`,
  password: 'a-long-enough-password',
  displayName: 'Practice Test',
};

const auth = () => ({ Authorization: `Bearer ${accessToken}` });

const MODEL_ANSWER = 'A closure captures the binding, not a copy of the value.';

interface Question {
  id: string;
  kind: 'MCQ' | 'THEORY';
  options: string[];
  given: { selectedIndex: number | null; selfRating: number | null } | null;
}

interface View {
  questions: Question[];
  exercises: { id: string; passed: boolean }[];
  completion: { complete: boolean; outstanding: { questions: number; exercises: number } };
  routineDone: boolean;
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

  // A technology of its own, holding exactly one concept.
  //
  // Not a concept bolted onto JavaScript: courses are strictly sequential, so
  // one appended at the end is locked behind every concept before it, and
  // clearing fourteen of those has nothing to do with what this suite tests.
  // One concept at the front of its own course is unlocked from a standing
  // start, and its question pool cannot drift under the assertions either.
  const technology = await prisma.technology.create({
    data: {
      slug: `practice-test-${Date.now()}`,
      name: 'Practice Test Technology',
      description: 'Exists only for this suite.',
      exerciseLanguage: 'javascript',
      learningOrder: 9_000,
    },
  });
  technologyId = technology.id;

  const version = await prisma.curriculumVersion.create({
    data: {
      technologyId: technology.id,
      version: 1,
      generatorVersion: 'test',
      status: 'ACTIVE',
      conceptCount: 1,
    },
  });

  const concept = await prisma.concept.create({
    data: {
      technologyId: technology.id,
      curriculumVersionId: version.id,
      slug: 'practice-test-concept',
      name: 'Practice Test Concept',
      description: 'A concept that exists only for this suite.',
      difficulty: 2,
      orderIndex: 0,
    },
  });
  conceptId = concept.id;

  await http
    .post('/api/v1/technologies/mine')
    .set(auth())
    .send({ technologyId: technology.id })
    .expect(201);

  // Three multiple choice and two written: exactly one batch, so the first
  // visit is served entirely from the pool and never calls a model.
  for (let index = 0; index < 3; index += 1) {
    const row = await prisma.conceptQuestion.create({
      data: {
        conceptId,
        kind: 'MCQ',
        prompt: `What does a closure capture? (${index})`,
        options: ['The binding', 'A copy of the value', 'Nothing'],
        correctIndex: 0,
        explanation: 'It captures the binding, which is why a later write is visible.',
        difficulty: index + 1,
      },
    });
    questionIds.push(row.id);
  }

  for (let index = 0; index < 2; index += 1) {
    const row = await prisma.conceptQuestion.create({
      data: {
        conceptId,
        kind: 'THEORY',
        prompt: `Why does a var loop print the same number? (${index})`,
        modelAnswer: MODEL_ANSWER,
        keyPoints: ['One shared binding', 'The callbacks run after the loop'],
        difficulty: index + 2,
      },
    });
    questionIds.push(row.id);
  }

  const exercise = await prisma.exercise.create({
    data: {
      conceptId,
      slug: 'practice-test-exercise',
      title: 'Practice test exercise',
      kind: 'CODING',
      difficulty: 2,
      language: 'javascript',
      objective: 'Return the number 42.',
      requirements: 'Export a default function returning 42.',
      starterCode: 'export default function answer() {}\n',
      referenceSolution: 'export default function answer() {\n  return 42;\n}\n',
      estimatedMinutes: 5,
      testCases: {
        create: [
          {
            name: 'returns 42',
            hidden: false,
            orderIndex: 0,
            code: 'assert.equal(solution(), 42);',
          },
        ],
      },
    },
  });
  exerciseId = exercise.id;
}, 180_000);

afterAll(async () => {
  // Cascades to the concept, its questions, its exercise and every
  // assignment pointing at them.
  await prisma.technology.deleteMany({ where: { id: technologyId } }).catch(() => undefined);
  await prisma.user.deleteMany({ where: { email: user.email } }).catch(() => undefined);
  await prisma.$disconnect();
  await app?.close();
});

const practice = async (): Promise<View> =>
  (await http.get(`/api/v1/concepts/${conceptId}/practice`).set(auth()).expect(200)).body;

describe('practice on a concept', () => {
  it('opens with a batch already served, from the pool', async () => {
    const view = await practice();

    expect(view.questions).toHaveLength(5);
    expect(view.questions.filter((q) => q.kind === 'MCQ')).toHaveLength(3);
    expect(view.questions.filter((q) => q.kind === 'THEORY')).toHaveLength(2);
    expect(view.exercises).toHaveLength(1);
    expect(view.completion.complete).toBe(false);
  });

  it('serves the same batch again rather than a new one', async () => {
    // Reloading the page must not hand out five more questions.
    const first = await practice();
    const second = await practice();

    expect(second.questions.map((q) => q.id)).toEqual(first.questions.map((q) => q.id));
  });

  it('never ships an unanswered question’s answer', async () => {
    const view = await practice();
    const serialised = JSON.stringify(view);

    expect(serialised).not.toContain(MODEL_ANSWER);
    expect(serialised).not.toContain('correctIndex');
    expect(view.questions.every((q) => q.given === null)).toBe(true);
  });

  it('marks multiple choice and explains it either way', async () => {
    const view = await practice();
    const mcq = view.questions.find((q) => q.kind === 'MCQ')!;

    const wrong = await http
      .post(`/api/v1/concepts/questions/${mcq.id}/choice`)
      .set(auth())
      .send({ selectedIndex: 1 })
      .expect(200);

    expect(wrong.body.correct).toBe(false);
    expect(wrong.body.correctIndex).toBe(0);
    expect(wrong.body.explanation).not.toHaveLength(0);
    // A wrong answer still counts as answered: the explanation is where the
    // learning is, and blocking on it would make it an obstacle.
    expect(wrong.body.completion.outstanding.questions).toBe(4);
  });

  it('reveals the model answer only once theirs is in', async () => {
    const view = await practice();
    const theory = view.questions.find((q) => q.kind === 'THEORY')!;

    const response = await http
      .post(`/api/v1/concepts/questions/${theory.id}/answer`)
      .set(auth())
      .send({ answer: 'Because var has one binding for the whole loop.' })
      .expect(200);

    expect(response.body.modelAnswer).toBe(MODEL_ANSWER);
    expect(response.body.keyPoints).toHaveLength(2);
  });

  it('does not count a written answer until it has been judged', async () => {
    const view = await practice();
    const answered = view.questions.find((q) => q.kind === 'THEORY' && q.given !== null)!;

    expect(answered.given!.selfRating).toBeNull();
    // Four outstanding: two multiple choice and the two written ones, one of
    // which has prose but no verdict yet.
    expect(view.completion.outstanding.questions).toBe(4);
  });

  it('finishes the concept once everything served is done, with nothing to press', async () => {
    const routine = await http.get('/api/v1/routines/today').set(auth()).expect(200);
    const item = await prisma.routineItem.create({
      data: {
        routineId: routine.body.id,
        kind: 'LEARN',
        title: 'Practice Test Concept',
        minutes: 20,
        orderIndex: 900,
        conceptId,
      },
    });

    // Everything still outstanding, answered however.
    for (const question of (await practice()).questions) {
      if (question.kind === 'MCQ') {
        await http
          .post(`/api/v1/concepts/questions/${question.id}/choice`)
          .set(auth())
          .send({ selectedIndex: 0 })
          .expect(200);
        continue;
      }

      await http
        .post(`/api/v1/concepts/questions/${question.id}/answer`)
        .set(auth())
        .send({ answer: 'One shared binding, and the callbacks run later.' })
        .expect(200);
      await http
        .post(`/api/v1/concepts/questions/${question.id}/rating`)
        .set(auth())
        .send({ selfRating: 2 })
        .expect(200);
    }

    // Questions done, code not: still outstanding. This is the case that
    // used to complete too early.
    const midway = await practice();
    expect(midway.completion.outstanding.questions).toBe(0);
    expect(midway.completion.complete).toBe(false);
    expect((await prisma.routineItem.findUnique({ where: { id: item.id } }))!.status).not.toBe(
      'DONE',
    );

    const attempt = await http
      .post(`/api/v1/exercises/${exerciseId}/attempts`)
      .set(auth())
      .send({ blindMode: false })
      .expect(201);

    await http
      .post('/api/v1/submissions')
      .set(auth())
      .send({
        attemptId: attempt.body.attemptId,
        language: 'javascript',
        code: 'export default function answer() {\n  return 42;\n}\n',
      })
      .expect(200);

    const done = await practice();
    expect(done.completion.complete).toBe(true);
    expect(done.routineDone).toBe(true);
    expect((await prisma.routineItem.findUnique({ where: { id: item.id } }))!.status).toBe('DONE');
  }, 180_000);

  it('stays finished when more questions are pulled afterwards', async () => {
    // A completed concept is revisitable, and extra practice must never
    // un-finish it. Nothing is left in the pool, so this also proves a
    // failed top-up degrades rather than throwing.
    await http.post(`/api/v1/concepts/${conceptId}/practice/questions`).set(auth()).expect(200);

    const after = await practice();
    expect(after.routineDone).toBe(true);
  });

  it('hands a second user the same pool, without calling a model', async () => {
    const other = await http
      .post('/api/v1/auth/register')
      .send({
        email: `practice-other-${Date.now()}@forgeroutine.test`,
        password: 'a-long-enough-password',
        displayName: 'Other',
      })
      .expect(201);

    const theirs: View = (
      await http
        .get(`/api/v1/concepts/${conceptId}/practice`)
        .set({ Authorization: `Bearer ${other.body.accessToken}` })
        .expect(200)
    ).body;

    // The same five questions the first user worked, and none of their answers.
    expect(theirs.questions.map((q) => q.id).sort()).toEqual([...questionIds].sort());
    expect(theirs.questions.every((q) => q.given === null)).toBe(true);
    expect(theirs.completion.complete).toBe(false);

    await prisma.user
      .deleteMany({ where: { id: other.body.user?.id ?? '' } })
      .catch(() => undefined);
  });

  it('will not rate a question that was never answered', async () => {
    const fresh = await prisma.conceptQuestion.create({
      data: {
        conceptId,
        kind: 'THEORY',
        prompt: 'Never answered.',
        modelAnswer: 'Nor revealed.',
        keyPoints: ['a', 'b'],
      },
    });

    await http
      .post(`/api/v1/concepts/questions/${fresh.id}/rating`)
      .set(auth())
      .send({ selfRating: 2 })
      .expect(400);
  });

  it('refuses to mark a written question by index', async () => {
    // correctIndex defaults to 0 on a THEORY row, so an unguarded answer of
    // "0" would come back correct for a question with no options.
    const theory = (await practice()).questions.find((q) => q.kind === 'THEORY')!;

    await http
      .post(`/api/v1/concepts/questions/${theory.id}/choice`)
      .set(auth())
      .send({ selectedIndex: 0 })
      .expect(400);
  });

  it('records the answers it needs to, for this user only', async () => {
    const mine = await prisma.conceptQuestionAnswer.count({ where: { userId, conceptId } });

    // Nothing recorded multiple-choice answers before, which is why a
    // concept could never tell a finished set from an untouched one.
    expect(mine).toBeGreaterThanOrEqual(5);
  });
});
