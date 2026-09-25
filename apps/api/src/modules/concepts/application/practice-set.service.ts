import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  describeAIFailure,
  exerciseAgent,
  practiceSetAgent,
  PRACTICE_SET_VERSION,
  type GeneratedExerciseOutput,
} from '@forgeroutine/ai';
import {
  INITIAL_REVIEW_STATE,
  gradeFromPerformance,
  scheduleNextReview,
} from '@forgeroutine/utils';

import { Problems } from '../../../common/http/problem-details.js';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';
import { AI_PROVIDER, type OptionalAIProvider } from '../../ai/ai.tokens.js';
import { ExerciseVerifier } from '../../generation/application/exercise-verifier.js';
import { RoutinesService } from '../../routines/application/routines.service.js';
import { SkillsService } from '../../skills/application/skills.service.js';
import {
  completionState,
  isAnswered,
  type CompletionState,
} from '../domain/practice-completion.js';
import { interleave } from '../domain/practice-order.js';

export interface GivenAnswer {
  selectedIndex: number | null;
  correct: boolean | null;
  answer: string | null;
  selfRating: number | null;
  /** Revealed here only because they have already answered. */
  explanation: string | null;
  modelAnswer: string | null;
  keyPoints: string[];
}

export interface PracticeQuestionView {
  id: string;
  kind: 'MCQ' | 'THEORY';
  prompt: string;
  /** MCQ only, and never the answer: the client cannot mark its own homework. */
  options: string[];
  difficulty: number;
  batch: number;
  /** Their own answer, for a question they have already dealt with. */
  given: GivenAnswer | null;
}

export interface PracticeExerciseView {
  id: string;
  title: string;
  kind: string;
  difficulty: number;
  estimatedMinutes: number;
  batch: number;
  passed: boolean;
}

export interface PracticeView {
  questions: PracticeQuestionView[];
  exercises: PracticeExerciseView[];
  completion: CompletionState;
  /** True once the concept's routine item has been ticked off. */
  routineDone: boolean;
  /** Said plainly when a batch could not be written, rather than a silence. */
  problem: string | null;
}

export interface TheoryAnswerResult {
  /** Withheld until now on purpose — see `answerTheory`. */
  modelAnswer: string;
  keyPoints: string[];
}

export interface McqAnswerResult {
  correct: boolean;
  correctIndex: number;
  explanation: string;
  completion: CompletionState;
}

/** A pull of questions: enough to be worth doing, few enough to finish. */
const MCQS_PER_BATCH = 3;
const THEORY_PER_BATCH = 2;

/**
 * Practice on one concept: the questions, the code, and what finishes it.
 *
 * Questions and exercises are a **pool shared per concept**. Whatever anyone
 * has generated is there for everyone, so the second person through a concept
 * works the existing questions instead of paying to invent near-duplicates.
 * The model is called only when the pool cannot fill the batch being asked
 * for — which makes "five more" free for everybody but the first to ask.
 *
 * What is per-user is the **assignment**: which pool items you were handed.
 * Completion is measured against those and only those. Measuring against the
 * pool would mean a concept that grows to forty questions can never be
 * finished, and that somebody else generating one could un-finish yours.
 *
 * Written answers withhold their model answer until the user's own is stored.
 * Reading a good answer and then judging yours against it measures nothing, so
 * the reveal is a second request and the endpoint that lists questions has no
 * model answer in it at all for anything still unanswered.
 */
@Injectable()
export class PracticeSetService {
  private readonly logger = new Logger(PracticeSetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly skills: SkillsService,
    private readonly routines: RoutinesService,
    private readonly verifier: ExerciseVerifier,
    @Inject(AI_PROVIDER) private readonly ai: OptionalAIProvider,
  ) {}

  /**
   * Everything this user has been handed on this concept.
   *
   * Opens the first batch on first visit, so Practice is a page with
   * questions on it rather than a button promising some.
   */
  async view(userId: string, conceptId: string): Promise<PracticeView> {
    const concept = await this.load(conceptId);
    let problem: string | null = null;

    const existing = await this.prisma.practiceAssignment.count({
      where: { userId, conceptId },
    });

    if (existing === 0) {
      // First visit: one batch of questions and one exercise, which is the
      // smallest thing that is actually a practice session.
      problem = (await this.serveQuestions(userId, concept, 0)) ?? problem;
      problem = (await this.serveExercise(userId, concept, 0)) ?? problem;
    }

    return this.project(userId, conceptId, problem);
  }

  /** Five more questions: from the pool if it can, from the model if not. */
  async moreQuestions(userId: string, conceptId: string): Promise<PracticeView> {
    const concept = await this.load(conceptId);
    const problem = await this.serveQuestions(
      userId,
      concept,
      (await this.lastBatch(userId, conceptId)) + 1,
    );

    return this.project(userId, conceptId, problem);
  }

  /** One more coding exercise, same bargain. */
  async moreCode(userId: string, conceptId: string): Promise<PracticeView> {
    const concept = await this.load(conceptId);
    const problem = await this.serveExercise(
      userId,
      concept,
      (await this.lastBatch(userId, conceptId)) + 1,
    );

    return this.project(userId, conceptId, problem);
  }

  // -- Answering ------------------------------------------------------------

  /**
   * Marks a multiple-choice answer, records it, and reschedules the concept.
   *
   * Recorded rather than only scored, unlike the between-activity prompt this
   * grew out of: completion depends on knowing which questions a person has
   * dealt with, and nothing used to write that down at all — which is why a
   * concept never finished by itself.
   */
  async answerMcq(
    userId: string,
    questionId: string,
    selectedIndex: number,
  ): Promise<McqAnswerResult> {
    const question = await this.prisma.conceptQuestion.findUnique({
      where: { id: questionId },
      select: {
        id: true,
        conceptId: true,
        kind: true,
        correctIndex: true,
        explanation: true,
        archivedAt: true,
      },
    });

    if (!question || question.archivedAt !== null) throw Problems.notFound('Question');
    if (question.kind !== 'MCQ') {
      throw Problems.badRequest('That question is answered in writing, not by picking an option.');
    }

    const correct = selectedIndex === question.correctIndex;

    // Updated rather than appended: re-answering corrects the record instead
    // of stacking two verdicts on one question.
    const existing = await this.prisma.conceptQuestionAnswer.findFirst({
      where: { userId, questionId },
      orderBy: { createdAt: 'desc' },
    });

    if (existing) {
      await this.prisma.conceptQuestionAnswer.update({
        where: { id: existing.id },
        data: { selectedIndex, correct },
      });
    } else {
      await this.prisma.conceptQuestionAnswer.create({
        data: { userId, questionId, conceptId: question.conceptId, selectedIndex, correct },
      });
    }

    await this.recordRecall(userId, question.conceptId, correct ? 2 : 0, {
      note: correct ? 'Practice question answered correctly' : 'Practice question missed',
      // One question is weak evidence, so the learning rate is low. A wrong
      // answer schedules; it does not punish.
      learningRate: 0.15,
    });

    return {
      correct,
      correctIndex: question.correctIndex,
      // Shown either way. Being right for the wrong reason is still worth
      // correcting, and this is where the learning is.
      explanation: question.explanation,
      completion: await this.settle(userId, question.conceptId),
    };
  }

  /**
   * Records a written answer and, only then, reveals the model answer.
   *
   * The order is the entire mechanism. An endpoint that returned the model
   * answer alongside the question would turn every written question into a
   * reading comprehension exercise with a textarea attached.
   */
  async answerTheory(
    userId: string,
    questionId: string,
    answer: string,
  ): Promise<TheoryAnswerResult> {
    const trimmed = answer.trim();
    if (trimmed.length === 0) throw Problems.badRequest('Write an answer first.');

    const question = await this.prisma.conceptQuestion.findUnique({
      where: { id: questionId },
      select: {
        id: true,
        conceptId: true,
        kind: true,
        modelAnswer: true,
        keyPoints: true,
        archivedAt: true,
      },
    });

    if (!question || question.archivedAt !== null) throw Problems.notFound('Question');
    if (question.kind !== 'THEORY') {
      throw Problems.badRequest('That question is multiple choice. Pick an option instead.');
    }

    const existing = await this.prisma.conceptQuestionAnswer.findFirst({
      where: { userId, questionId },
      orderBy: { createdAt: 'desc' },
    });

    if (existing) {
      // Rewriting clears the old verdict: judging the previous attempt says
      // nothing about this one.
      await this.prisma.conceptQuestionAnswer.update({
        where: { id: existing.id },
        data: { answer: trimmed, selfRating: null },
      });
    } else {
      await this.prisma.conceptQuestionAnswer.create({
        data: { userId, questionId, conceptId: question.conceptId, answer: trimmed },
      });
    }

    return { modelAnswer: question.modelAnswer ?? '', keyPoints: question.keyPoints };
  }

  /**
   * Their own verdict on the answer they wrote, and the schedule that follows.
   *
   * Self-reported, and treated as such: a lower learning rate than a marked
   * answer, and evidence only for recall and retention — never for coding
   * ability, which is measured by running code. This is the bargain every
   * spaced-repetition system makes, because only the person who wrote the
   * answer can say whether they knew it, and it holds here because the model
   * answer arrived after theirs.
   */
  async rateTheory(
    userId: string,
    questionId: string,
    selfRating: number,
  ): Promise<{ completion: CompletionState }> {
    const latest = await this.prisma.conceptQuestionAnswer.findFirst({
      where: { userId, questionId },
      orderBy: { createdAt: 'desc' },
    });

    // Rating without answering would be marking a blank page.
    if (!latest?.answer) throw Problems.badRequest('Answer the question before rating it.');

    await this.prisma.conceptQuestionAnswer.update({
      where: { id: latest.id },
      data: { selfRating },
    });

    await this.recordRecall(userId, latest.conceptId, selfRating, {
      note: `Written answer, self-rated ${selfRating}/2`,
      learningRate: 0.1,
    });

    return { completion: await this.settle(userId, latest.conceptId) };
  }

  /**
   * Called when a submission passes, to see whether that finished the concept.
   *
   * The exercise closing its own attempt is not enough. A concept is finished
   * when its questions are done too, so passing is one input to the rule
   * rather than the whole of it.
   */
  async onExercisePassed(userId: string, exerciseId: string): Promise<void> {
    const exercise = await this.prisma.exercise.findUnique({
      where: { id: exerciseId },
      select: { conceptId: true },
    });
    if (!exercise) return;

    await this.settle(userId, exercise.conceptId);
  }

  // -- Serving --------------------------------------------------------------

  /**
   * Hands over a batch, generating only what the pool cannot supply.
   *
   * Returns a sentence to show the user when something could not be written,
   * or null. Never throws: a failed top-up should leave them with whatever
   * the pool did have rather than an error page.
   */
  private async serveQuestions(
    userId: string,
    concept: LoadedConcept,
    batch: number,
  ): Promise<string | null> {
    const pool = await this.unservedQuestions(userId, concept.id);

    const picked = [
      ...pool.filter((question) => question.kind === 'MCQ').slice(0, MCQS_PER_BATCH),
      ...pool.filter((question) => question.kind === 'THEORY').slice(0, THEORY_PER_BATCH),
    ];

    const wantMcqs = MCQS_PER_BATCH - picked.filter((q) => q.kind === 'MCQ').length;
    const wantTheory = THEORY_PER_BATCH - picked.filter((q) => q.kind === 'THEORY').length;

    let problem: string | null = null;

    if (wantMcqs > 0 || wantTheory > 0) {
      const written = await this.writeQuestions(userId, concept, wantMcqs, wantTheory);

      if (written === null) {
        problem = this.ai
          ? 'Some new questions could not be written just now. These are the ones already here.'
          : 'New questions need an AI provider. Add a key in Settings → AI, or work through what ' +
            'is already here.';
      } else {
        picked.push(...written);
      }
    }

    if (picked.length === 0) return problem ?? 'There are no questions on this concept yet.';

    await this.prisma.practiceAssignment.createMany({
      data: picked.map((question) => ({
        userId,
        conceptId: concept.id,
        questionId: question.id,
        batch,
      })),
      // Two tabs asking at once must not fail on the uniqueness rule.
      skipDuplicates: true,
    });

    return problem;
  }

  private async serveExercise(
    userId: string,
    concept: LoadedConcept,
    batch: number,
  ): Promise<string | null> {
    // The curriculum's own exercises first: hand-written tests, already
    // verified, and free. The model is asked only once they run out.
    const next = await this.unservedExercise(userId, concept.id);
    const exerciseId = next?.id ?? (await this.writeExercise(userId, concept));

    if (!exerciseId) {
      return this.ai
        ? 'A new coding exercise could not be written just now. Try again in a moment.'
        : 'A new coding exercise needs an AI provider. Add a key in Settings → AI.';
    }

    await this.prisma.practiceAssignment.createMany({
      data: [{ userId, conceptId: concept.id, exerciseId, batch }],
      skipDuplicates: true,
    });

    return null;
  }

  private async unservedQuestions(userId: string, conceptId: string) {
    return this.prisma.conceptQuestion.findMany({
      where: { conceptId, archivedAt: null, assignments: { none: { userId } } },
      orderBy: [{ difficulty: 'asc' }, { createdAt: 'asc' }],
    });
  }

  private async unservedExercise(userId: string, conceptId: string) {
    return this.prisma.exercise.findFirst({
      where: {
        conceptId,
        archivedAt: null,
        // PROJECT and the prose-graded kinds are their own thing; practice
        // here means an exercise the sandbox can mark.
        kind: { in: ['CODING', 'DEBUGGING', 'BLIND_CODING'] },
        assignments: { none: { userId } },
      },
      orderBy: [{ difficulty: 'asc' }, { createdAt: 'asc' }],
      select: { id: true },
    });
  }

  /** Adds to the shared pool. Returns the new rows, or null on any failure. */
  private async writeQuestions(
    userId: string,
    concept: LoadedConcept,
    wantMcqs: number,
    wantTheory: number,
  ) {
    if (!this.ai) return null;

    const existing = await this.prisma.conceptQuestion.findMany({
      where: { conceptId: concept.id, archivedAt: null },
      select: { prompt: true },
      // Enough for the model to avoid repeating itself, without the prompt
      // growing without bound as a popular concept's pool fills up.
      take: 40,
      orderBy: { createdAt: 'desc' },
    });

    try {
      const written = await practiceSetAgent.run(
        this.ai,
        {
          technologyName: concept.technology.name,
          conceptName: concept.name,
          conceptDescription: concept.description,
          difficulty: concept.difficulty,
          learningObjectives: concept.learningObjectives,
          commonMistakes: concept.commonMistakes,
          language: concept.technology.exerciseLanguage,
          existingPrompts: existing.map((row) => row.prompt),
          wantMcqs,
          wantTheory,
        },
        { userId },
      );

      const stamp = { generatedBy: practiceSetAgent.name, promptVersion: PRACTICE_SET_VERSION };

      // createMany cannot return the rows, and their ids are needed to assign
      // them, so they go in one at a time inside a transaction.
      return this.prisma.$transaction(
        [
          ...written.mcqs.map((mcq) => ({
            conceptId: concept.id,
            kind: 'MCQ' as const,
            prompt: mcq.prompt,
            options: mcq.options,
            correctIndex: mcq.correctIndex,
            explanation: mcq.explanation,
            difficulty: mcq.difficulty,
            ...stamp,
          })),
          ...written.theory.map((theory) => ({
            conceptId: concept.id,
            kind: 'THEORY' as const,
            prompt: theory.prompt,
            modelAnswer: theory.modelAnswer,
            keyPoints: theory.keyPoints,
            difficulty: theory.difficulty,
            ...stamp,
          })),
        ].map((data) => this.prisma.conceptQuestion.create({ data })),
      );
    } catch (error) {
      // Degrade to the pool. A concept with four questions and a failed
      // top-up is still practisable; failing the page would take those away.
      this.logger.warn({ err: error }, `Could not write questions for ${concept.slug}`);
      this.logger.debug(describeAIFailure(error));
      return null;
    }
  }

  /**
   * Writes one coding exercise and adds it to the pool.
   *
   * Verified before it is stored, by running its own reference solution
   * against its own tests. An exercise whose tests do not match the harness
   * produces a failure the user can neither act on nor pass, so an
   * unverifiable one is thrown away rather than handed over.
   */
  private async writeExercise(userId: string, concept: LoadedConcept): Promise<string | null> {
    if (!this.ai) return null;

    const language = concept.technology.exerciseLanguage;
    // Nothing to run means nothing to verify, and an unverified coding
    // exercise is worse than none at all.
    if (language !== 'javascript' && language !== 'typescript') return null;

    const existing = await this.prisma.exercise.findMany({
      where: { conceptId: concept.id },
      select: { slug: true },
    });

    try {
      const generated = await exerciseAgent.run(
        this.ai,
        {
          technologyName: concept.technology.name,
          conceptName: concept.name,
          conceptDescription: concept.description,
          difficulty: concept.difficulty,
          learningObjectives: concept.learningObjectives,
          commonMistakes: concept.commonMistakes,
          language,
          existingSlugs: existing.map((row) => row.slug),
        },
        { userId },
      );

      for (const exercise of generated.exercises) {
        // A debugging exercise needs its broken code proved to fail as well,
        // which is a second sandbox run for a kind nobody asked for here.
        if (exercise.kind === 'DEBUGGING') continue;

        const verdict = await this.verifier.verify(exercise);
        if (!verdict.accepted) {
          this.logger.warn(`Rejected generated "${exercise.slug}": ${verdict.reason}`);
          continue;
        }

        return await this.persistExercise(concept.id, exercise, language);
      }

      return null;
    } catch (error) {
      this.logger.warn({ err: error }, `Could not write an exercise for ${concept.slug}`);
      this.logger.debug(describeAIFailure(error));
      return null;
    }
  }

  private async persistExercise(
    conceptId: string,
    exercise: GeneratedExerciseOutput,
    language: 'javascript' | 'typescript',
  ): Promise<string> {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.exercise.create({
        data: {
          conceptId,
          slug: exercise.slug,
          title: exercise.title,
          kind: exercise.kind,
          difficulty: exercise.difficulty,
          language,
          objective: exercise.objective,
          requirements: exercise.requirements,
          functionSignature: exercise.functionSignature,
          starterCode: exercise.starterCode,
          examples: exercise.examples,
          staticHints: exercise.staticHints,
          referenceSolution: exercise.referenceSolution,
          estimatedMinutes: exercise.estimatedMinutes,
        },
      });

      await tx.exerciseTestCase.createMany({
        data: exercise.testCases.map((testCase, index) => ({
          exerciseId: row.id,
          name: testCase.name,
          hidden: testCase.hidden,
          orderIndex: index,
          code: testCase.code,
        })),
      });

      return row.id;
    });
  }

  // -- Projection and completion -------------------------------------------

  private async project(
    userId: string,
    conceptId: string,
    problem: string | null,
  ): Promise<PracticeView> {
    const [assignments, answers, passed, routineDone] = await Promise.all([
      this.assignmentsFor(userId, conceptId),
      this.prisma.conceptQuestionAnswer.findMany({ where: { userId, conceptId } }),
      this.prisma.exerciseAttempt.findMany({
        where: { userId, outcome: 'PASSED', exercise: { conceptId } },
        select: { exerciseId: true },
      }),
      this.isRoutineDone(userId, conceptId),
    ]);

    const answerByQuestion = new Map(answers.map((row) => [row.questionId, row]));
    const passedIds = new Set(passed.map((row) => row.exerciseId));

    const questions: PracticeQuestionView[] = interleave(
      assignments
        .filter((row) => row.question !== null)
        .map((row) => ({
          assignment: row,
          question: row.question!,
          kind: row.question!.kind,
          difficulty: row.question!.difficulty,
        })),
    ).map(({ assignment, question }) => ({
      id: question.id,
      kind: question.kind,
      prompt: question.prompt,
      options: question.kind === 'MCQ' ? question.options : [],
      difficulty: question.difficulty,
      batch: assignment.batch,
      given: toGiven(question, answerByQuestion.get(question.id) ?? null),
    }));

    const exercises: PracticeExerciseView[] = assignments
      .filter((row) => row.exercise !== null)
      .map((row) => ({
        id: row.exercise!.id,
        title: row.exercise!.title,
        kind: row.exercise!.kind,
        difficulty: row.exercise!.difficulty,
        estimatedMinutes: row.exercise!.estimatedMinutes,
        batch: row.batch,
        passed: passedIds.has(row.exercise!.id),
      }));

    const completion = completionState(
      questions.map((question) => ({
        questionId: question.id,
        answered: question.given !== null && isAnswered(question.given),
      })),
      exercises.map((exercise) => ({ exerciseId: exercise.id, passed: exercise.passed })),
    );

    return { questions, exercises, completion, routineDone, problem };
  }

  /**
   * Checks the rule and ticks off the routine item if it is satisfied.
   *
   * Called after every answer rather than behind a "finish" button, because
   * asking someone to report that they have finished something the app just
   * watched them finish is exactly the bug this replaced.
   */
  private async settle(userId: string, conceptId: string): Promise<CompletionState> {
    const view = await this.project(userId, conceptId, null);

    if (view.completion.complete && !view.routineDone) {
      await this.routines.markConceptDone(userId, conceptId).catch((error: unknown) =>
        // Bookkeeping. Losing the user's answer over a routine write would
        // be the worse bug.
        this.logger.warn({ err: error }, 'Could not tick off the routine item for this concept'),
      );
    }

    return view.completion;
  }

  private async isRoutineDone(userId: string, conceptId: string): Promise<boolean> {
    const done = await this.prisma.routineItem.count({
      where: { conceptId, status: 'DONE', routine: { userId } },
    });

    return done > 0;
  }

  private async assignmentsFor(userId: string, conceptId: string) {
    return this.prisma.practiceAssignment.findMany({
      where: { userId, conceptId },
      orderBy: [{ batch: 'asc' }, { servedAt: 'asc' }],
      include: { question: true, exercise: true },
    });
  }

  private async lastBatch(userId: string, conceptId: string): Promise<number> {
    const latest = await this.prisma.practiceAssignment.findFirst({
      where: { userId, conceptId },
      orderBy: { batch: 'desc' },
      select: { batch: true },
    });

    return latest?.batch ?? -1;
  }

  private async load(conceptId: string): Promise<LoadedConcept> {
    const concept = await this.prisma.concept.findUnique({
      where: { id: conceptId },
      include: { technology: { select: { name: true, exerciseLanguage: true } } },
    });

    if (!concept) throw Problems.notFound('Concept');

    return concept;
  }

  /**
   * Moves the review date and records the evidence.
   *
   * `quality` is 0 missed, 1 partly, 2 got it — which is also what a wrong or
   * right multiple-choice answer maps onto.
   */
  private async recordRecall(
    userId: string,
    conceptId: string,
    quality: number,
    options: { note: string; learningRate: number },
  ): Promise<void> {
    const [existing, skill] = await Promise.all([
      this.prisma.reviewSchedule.findUnique({ where: { userId_conceptId: { userId, conceptId } } }),
      this.prisma.skill.findUnique({
        where: { userId_conceptId: { userId, conceptId } },
        select: { conceptMastery: true },
      }),
    ]);

    // "Partly" is a pass that came back slowly, which is what the partial
    // credit path in gradeFromPerformance is for.
    const grade = gradeFromPerformance({
      passed: quality >= 1,
      testsPassed: quality,
      testsTotal: 2,
      aiRequestCount: 0,
      solutionRevealed: false,
    });

    const next = scheduleNextReview(
      existing
        ? {
            easeFactor: existing.easeFactor,
            intervalDays: existing.intervalDays,
            repetitions: existing.repetitions,
            lapses: existing.lapses,
          }
        : INITIAL_REVIEW_STATE,
      grade,
      { mastery: skill?.conceptMastery ?? 0.5 },
    );

    const state = {
      easeFactor: next.easeFactor,
      intervalDays: next.intervalDays,
      repetitions: next.repetitions,
      lapses: next.lapses,
      dueAt: next.dueAt,
      lastReviewedAt: new Date(),
    };

    await this.prisma.reviewSchedule.upsert({
      where: { userId_conceptId: { userId, conceptId } },
      create: { userId, conceptId, ...state },
      update: state,
    });

    await this.skills.applyEvidence({
      userId,
      conceptId,
      cause: 'REVIEW',
      note: options.note,
      learningRate: options.learningRate,
      evidence: { recallStrength: quality / 2, retention: quality / 2 },
    });
  }
}

/**
 * What of a question's answer key the client may see.
 *
 * Nothing, until they have answered. The explanation and the model answer are
 * both here only because the row proves they already committed — and the model
 * answer specifically waits for prose to exist, not merely for the question to
 * have been looked at.
 */
function toGiven(
  question: {
    explanation: string;
    modelAnswer: string | null;
    keyPoints: string[];
  },
  given: {
    selectedIndex: number | null;
    correct: boolean | null;
    answer: string | null;
    selfRating: number | null;
  } | null,
): GivenAnswer | null {
  if (!given) return null;

  return {
    selectedIndex: given.selectedIndex,
    correct: given.correct,
    answer: given.answer,
    selfRating: given.selfRating,
    explanation: question.explanation,
    modelAnswer: given.answer ? question.modelAnswer : null,
    keyPoints: given.answer ? question.keyPoints : [],
  };
}

interface LoadedConcept {
  id: string;
  slug: string;
  name: string;
  description: string;
  difficulty: number;
  learningObjectives: string[];
  commonMistakes: string[];
  technology: { name: string; exerciseLanguage: string | null };
}
