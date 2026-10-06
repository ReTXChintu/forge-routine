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
/** The review row planted by one case and settled by the next. */
let reviewItemId: string;
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
  given: {
    selectedIndex: number | null;
    correctIndex: number | null;
    correct: boolean | null;
    selfRating: number | null;
    gradeScore?: number | null;
  } | null;
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
  // Cascades to the concept, its questions, its exercise and every assignment
  // pointing at them.
  //
  // `delete` by a value that must exist, never `deleteMany` by one that might
  // not. This line used to be `deleteMany({ where: { id: technologyId } })`,
  // and when `beforeAll` failed before assigning it, `technologyId` was
  // undefined — which Prisma reads as *no filter*. It deleted every
  // technology in the database, and the cascade took the whole curriculum and
  // every user's attempts and skills with it. A cleanup step must not be able
  // to widen its own scope by failing to learn what it was cleaning up.
  if (technologyId) {
    await prisma.technology.delete({ where: { id: technologyId } }).catch(() => undefined);
  }
  await prisma.user.deleteMany({ where: { email: user.email } }).catch(() => undefined);
  await prisma.$disconnect();
  await app?.close();
});

/**
 * The server's own rule, restated once here.
 *
 * A multiple-choice pick counts; prose counts only once it has been judged,
 * because the reveal-then-rate step is where a written answer is actually
 * compared against anything.
 */
const isAnswered = (given: NonNullable<Question['given']>) =>
  given.selectedIndex !== null || given.selfRating !== null || (given.gradeScore ?? null) !== null;

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

  it('says which option was right, especially when they got it wrong', async () => {
    // Reported as "when I answer wrong the correct answer is not shown". The
    // page marked the chosen option with a cross and never said which one was
    // correct, so the explanation argued about something invisible.
    const mcq = (await practice()).questions.find(
      (question) => question.kind === 'MCQ' && question.given === null,
    )!;

    await http
      .post(`/api/v1/concepts/questions/${mcq.id}/choice`)
      .set(auth())
      .send({ selectedIndex: 2 })
      .expect(200);

    const answered = (await practice()).questions.find((question) => question.id === mcq.id)!;

    expect(answered.given!.correct).toBe(false);
    expect(answered.given!.selectedIndex).toBe(2);
    // The whole point: available from the view, not only from the reply to
    // the click, because the page re-renders from the view afterwards.
    expect(answered.given!.correctIndex).toBe(0);
  });

  it('withholds the right option until one is picked', async () => {
    const unanswered = (await practice()).questions.filter(
      (question) => question.kind === 'MCQ' && question.given === null,
    );

    // `given` is null before answering, so there is nothing to leak — which is
    // the property, stated rather than assumed.
    for (const question of unanswered) {
      expect(question.given).toBeNull();
    }
  });

  it('never claims a right option for a written question', async () => {
    // `correctIndex` defaults to 0 on a THEORY row, where it means nothing. It
    // must not travel out looking like an answer key.
    const theory = (await practice()).questions.find((question) => question.kind === 'THEORY')!;

    await http
      .post(`/api/v1/concepts/questions/${theory.id}/answer`)
      .set(auth())
      .send({ answer: 'One shared binding across the loop.' })
      .expect(200);

    const answered = (await practice()).questions.find((question) => question.id === theory.id)!;
    expect(answered.given!.correctIndex).toBeNull();
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

    // Stated as a relationship, not a total: earlier cases in this file answer
    // questions, so a magic number here breaks whenever one is added. What
    // matters is that prose with no verdict still counts as outstanding —
    // submitting an answer is not the same as having compared it to anything.
    const unjudged = view.questions.filter(
      (question) => question.given !== null && !isAnswered(question.given),
    );
    expect(unjudged.map((question) => question.id)).toContain(answered.id);
    expect(view.completion.outstanding.questions).toBeGreaterThanOrEqual(unjudged.length);
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

  // Placed after the second-user case on purpose: the review case plants two
  // more questions in the shared pool, which would change what a newcomer is
  // served first.
  it('ticks off today’s row even when an older row for the concept was already done', async () => {
    // The reported bug. "Has this concept's row been ticked off?" was answered
    // by counting DONE rows from *any* day, so a row finished last week stopped
    // today's from ever being ticked — and a concept the user had just
    // finished stayed outstanding on the routine page.
    const old = await prisma.routine.create({
      data: { userId, date: new Date('2020-01-01T00:00:00.000Z'), totalMinutes: 30 },
    });
    await prisma.routineItem.create({
      data: {
        routineId: old.id,
        kind: 'LEARN',
        status: 'DONE',
        title: 'Practice Test Concept, long ago',
        minutes: 20,
        orderIndex: 0,
        conceptId,
      },
    });

    const today = await http.get('/api/v1/routines/today').set(auth()).expect(200);
    const fresh = await prisma.routineItem.create({
      data: {
        routineId: today.body.id,
        kind: 'LEARN',
        title: 'Practice Test Concept, again today',
        minutes: 20,
        orderIndex: 950,
        conceptId,
      },
    });

    // Any answer settles the concept; it is already fully answered.
    const mcq = (await practice()).questions.find((question) => question.kind === 'MCQ')!;
    await http
      .post(`/api/v1/concepts/questions/${mcq.id}/choice`)
      .set(auth())
      .send({ selectedIndex: 0 })
      .expect(200);

    expect((await prisma.routineItem.findUnique({ where: { id: fresh.id } }))!.status).toBe('DONE');
  });

  it('does not tick off a review just because the concept was finished before', async () => {
    // A review falls due *because* the concept was finished a while ago, so
    // that cannot also be what completes it.
    const today = await http.get('/api/v1/routines/today').set(auth()).expect(200);
    const review = await prisma.routineItem.create({
      data: {
        routineId: today.body.id,
        kind: 'REVIEW',
        title: 'Review Practice Test Concept',
        minutes: 8,
        orderIndex: 960,
        conceptId,
      },
    });
    reviewItemId = review.id;

    const mcq = (await practice()).questions.find((question) => question.kind === 'MCQ')!;
    await http
      .post(`/api/v1/concepts/questions/${mcq.id}/choice`)
      .set(auth())
      .send({ selectedIndex: 0 })
      .expect(200);

    expect((await prisma.routineItem.findUnique({ where: { id: review.id } }))!.status).toBe(
      'PENDING',
    );
  });

  it('ticks off a review once a fresh batch has been answered', async () => {
    // The agreed rule: opening a review sends you to Practice, and pulling and
    // answering a new batch there is the review. Two new questions are planted
    // so the batch can be served without a model.
    const planted = await Promise.all(
      [0, 1].map((index) =>
        prisma.conceptQuestion.create({
          data: {
            conceptId,
            kind: 'MCQ',
            prompt: `A review question (${index})`,
            options: ['Right', 'Wrong', 'Also wrong'],
            correctIndex: 0,
            explanation: 'Because.',
            difficulty: 1,
          },
        }),
      ),
    );

    const pulled: View = (
      await http.post(`/api/v1/concepts/${conceptId}/practice/questions`).set(auth()).expect(200)
    ).body;
    const fresh = pulled.questions.filter((question) =>
      planted.some((row) => row.id === question.id),
    );
    expect(fresh).toHaveLength(2);

    // Half a batch is not a review.
    await http
      .post(`/api/v1/concepts/questions/${fresh[0]!.id}/choice`)
      .set(auth())
      .send({ selectedIndex: 1 })
      .expect(200);
    expect((await prisma.routineItem.findUnique({ where: { id: reviewItemId } }))!.status).toBe(
      'PENDING',
    );

    // The whole batch is — right or wrong, as everywhere else.
    await http
      .post(`/api/v1/concepts/questions/${fresh[1]!.id}/choice`)
      .set(auth())
      .send({ selectedIndex: 0 })
      .expect(200);
    expect((await prisma.routineItem.findUnique({ where: { id: reviewItemId } }))!.status).toBe(
      'DONE',
    );
  });

  it('falls back to self-rating when there is nothing to mark with', async () => {
    // This suite runs with no AI provider configured, which is the fallback
    // path: the model answer still comes back, the mark does not, and the
    // user's own verdict is what settles it. Stated so the degradation is a
    // tested property rather than a hope.
    const theory = (await practice()).questions.find(
      (question) => question.kind === 'THEORY' && question.given === null,
    );

    if (!theory) return;

    const response = await http
      .post(`/api/v1/concepts/questions/${theory.id}/answer`)
      .set(auth())
      .send({ answer: 'One binding shared by every iteration of the loop.' })
      .expect(200);

    expect(response.body.modelAnswer).not.toHaveLength(0);
    expect(response.body.grade).toBeNull();

    // And without a mark it is still outstanding, exactly as before.
    const after = (await practice()).questions.find((question) => question.id === theory.id)!;
    expect(isAnswered(after.given!)).toBe(false);
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

  it('runs a scratch snippet for its output, recording nothing', async () => {
    // The "Try it out" button beside a worked example. It must stay free of
    // consequences: optional practice that quietly becomes compulsory is
    // worse than no button at all.
    const before = await prisma.practiceAssignment.count({ where: { userId } });

    const response = await http
      .post('/api/v1/playground/run')
      .set(auth())
      .send({
        // Top-level statements and a log, with no default export — the shape
        // somebody writes to try an idea out, and the shape the harness used
        // to refuse outright.
        code: 'const a = [1, 2, 3];\na.reverse();\nconsole.log(a.join("-"));\n',
        language: 'javascript',
      })
      .expect(200);

    expect(response.body.stdout).toContain('3-2-1');
    // Nothing graded: no pass, no score, nothing to redact.
    expect(response.body.passed).toBeUndefined();

    expect(await prisma.practiceAssignment.count({ where: { userId } })).toBe(before);
    expect(
      await prisma.exerciseAttempt.count({ where: { userId, exerciseId } }),
    ).toBeLessThanOrEqual(2);
  }, 60_000);

  it('reports a scratch snippet’s own error rather than failing the request', async () => {
    const response = await http
      .post('/api/v1/playground/run')
      .set(auth())
      .send({ code: 'throw new Error(\"boom\");\n', language: 'javascript' })
      .expect(200);

    // A snippet that throws is a normal outcome here, not a server fault.
    expect(`${response.body.stderr}${response.body.status}`).toMatch(/boom|ERROR/i);
  }, 60_000);

  it('refuses an empty snippet', async () => {
    await http
      .post('/api/v1/playground/run')
      .set(auth())
      .send({ code: '', language: 'javascript' })
      .expect(400);
  });

  it('records the answers it needs to, for this user only', async () => {
    const mine = await prisma.conceptQuestionAnswer.count({ where: { userId, conceptId } });

    // Nothing recorded multiple-choice answers before, which is why a
    // concept could never tell a finished set from an untouched one.
    expect(mine).toBeGreaterThanOrEqual(5);
  });
});
