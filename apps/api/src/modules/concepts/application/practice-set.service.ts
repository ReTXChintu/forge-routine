import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  describeAIFailure,
  practiceSetAgent,
  PRACTICE_SET_VERSION,
  type PracticeSetOutput,
} from '@forgeroutine/ai';
import {
  INITIAL_REVIEW_STATE,
  gradeFromPerformance,
  scheduleNextReview,
} from '@forgeroutine/utils';

import { Problems } from '../../../common/http/problem-details.js';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';
import { AI_PROVIDER, type OptionalAIProvider } from '../../ai/ai.tokens.js';
import { SkillsService } from '../../skills/application/skills.service.js';
import { interleave } from '../domain/practice-order.js';
import { needsGeneration } from '../domain/practice-quota.js';

export interface PracticeQuestionView {
  id: string;
  kind: 'MCQ' | 'THEORY';
  prompt: string;
  /** MCQ only. Never includes the answer: the client cannot mark its own homework. */
  options: string[];
  difficulty: number;
  /** Set for a THEORY question already answered, so a revisit is not a blank page. */
  previousAnswer: string | null;
}

export interface PracticeSetView {
  questions: PracticeQuestionView[];
  /** False when there are none and none can be written. */
  available: boolean;
  unavailableReason: string | null;
}

export interface TheoryAnswerResult {
  /** Withheld until now on purpose — see the class comment. */
  modelAnswer: string;
  keyPoints: string[];
}

export interface TheoryRatingResult {
  nextDueAt: string;
}

/**
 * How many of each a full set holds.
 *
 * Enough multiple choice to cover the distinctions, enough written answers
 * to catch what multiple choice cannot, and coding left to the curriculum's
 * own exercises — which the client caps at two, because a third adds an
 * hour and very little.
 */
const QUOTA = { mcqs: 6, theory: 3 };

/**
 * The questions on a concept, and what happens when they are answered.
 *
 * Practice used to be whatever exercises the curriculum happened to ship
 * for a concept — often one, sometimes none. One coding exercise proves
 * you can produce a working function; it says nothing about whether you
 * could explain why it works, spot the case that breaks it, or choose it
 * over the alternative. So a set now mixes three things that fail
 * differently: multiple choice, written answers, and code.
 *
 * The written half withholds its model answer until the user's own is
 * stored. Reading a good answer and then judging your own against it is
 * not a test — the marking has to come after the commitment or it measures
 * nothing at all.
 *
 * Generation is once per concept and shared, like the explainer. The
 * questions do not depend on who is answering them.
 */
@Injectable()
export class PracticeSetService {
  private readonly logger = new Logger(PracticeSetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly skills: SkillsService,
    @Inject(AI_PROVIDER) private readonly ai: OptionalAIProvider,
  ) {}

  /**
   * The set for one concept, writing it on first request.
   *
   * Lazy rather than generated with the curriculum: most concepts in a
   * catalogue are never opened, and writing ten questions for each of 113
   * up front would be paying for a thousand nobody answers.
   */
  async set(userId: string, conceptId: string): Promise<PracticeSetView> {
    const concept = await this.prisma.concept.findUnique({
      where: { id: conceptId },
      include: { technology: { select: { name: true, exerciseLanguage: true } } },
    });
    if (!concept) throw Problems.notFound('Concept');

    let questions = await this.stored(conceptId);

    if (needsGeneration(questions, PRACTICE_SET_VERSION, QUOTA)) {
      questions = (await this.write(userId, concept, questions)) ?? questions;
    }

    if (questions.length === 0) {
      return {
        questions: [],
        available: false,
        unavailableReason: this.ai
          ? 'No questions have been written for this concept yet.'
          : 'Questions for this concept have not been written, and AI is off for your ' +
            'account. Add a provider key in Settings → AI.',
      };
    }

    // Their own previous prose, so returning to a set shows what they said
    // last time rather than an empty box they have to fill from nothing.
    const previous = await this.prisma.conceptTheoryAnswer.findMany({
      where: { userId, conceptId },
      orderBy: { createdAt: 'desc' },
      select: { questionId: true, answer: true },
    });
    const byQuestion = new Map<string, string>();
    for (const row of previous) {
      if (!byQuestion.has(row.questionId)) byQuestion.set(row.questionId, row.answer);
    }

    return {
      questions: interleave(questions).map((question) => ({
        id: question.id,
        kind: question.kind,
        prompt: question.prompt,
        options: question.kind === 'MCQ' ? question.options : [],
        difficulty: question.difficulty,
        previousAnswer: byQuestion.get(question.id) ?? null,
      })),
      available: true,
      unavailableReason: null,
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

    await this.prisma.conceptTheoryAnswer.create({
      data: { userId, questionId, conceptId: question.conceptId, answer: trimmed },
    });

    return {
      modelAnswer: question.modelAnswer ?? '',
      keyPoints: question.keyPoints,
    };
  }

  /**
   * Their own verdict on the answer they wrote, and the schedule that follows.
   *
   * Self-reported, and treated as such: a low learning rate, and evidence
   * only for recall and retention — never for coding ability, which is
   * measured by running code. This is the bargain every spaced-repetition
   * system makes, because only the person who wrote the answer can say
   * whether they actually knew it, and it holds here because the model
   * answer arrived after theirs.
   */
  async rateTheory(
    userId: string,
    questionId: string,
    selfRating: number,
  ): Promise<TheoryRatingResult> {
    const latest = await this.prisma.conceptTheoryAnswer.findFirst({
      where: { userId, questionId },
      orderBy: { createdAt: 'desc' },
    });

    // Rating without answering would be marking a blank page.
    if (!latest) throw Problems.badRequest('Answer the question before rating it.');

    await this.prisma.conceptTheoryAnswer.update({
      where: { id: latest.id },
      data: { selfRating },
    });

    const nextDueAt = await this.reschedule(userId, latest.conceptId, selfRating);

    await this.skills.applyEvidence({
      userId,
      conceptId: latest.conceptId,
      cause: 'REVIEW',
      note: `Written answer, self-rated ${selfRating}/2`,
      // Low, and lower than a multiple-choice answer's 0.15: this is the
      // one piece of evidence in the product the user grades themselves.
      learningRate: 0.1,
      evidence: {
        recallStrength: selfRating / 2,
        retention: selfRating / 2,
      },
    });

    return { nextDueAt: nextDueAt.toISOString() };
  }

  // -- Generation -----------------------------------------------------------

  private async stored(conceptId: string) {
    return this.prisma.conceptQuestion.findMany({
      where: { conceptId, archivedAt: null },
      orderBy: [{ difficulty: 'asc' }, { createdAt: 'asc' }],
    });
  }

  private async write(
    userId: string,
    concept: {
      id: string;
      slug: string;
      name: string;
      description: string;
      difficulty: number;
      learningObjectives: string[];
      commonMistakes: string[];
      technology: { name: string; exerciseLanguage: string | null };
    },
    existing: readonly { id: string; kind: string; prompt: string; promptVersion: string | null }[],
  ) {
    if (!this.ai) return null;

    // Superseded generations are dropped rather than left to accumulate.
    // Seed questions have no promptVersion and survive: nothing the product
    // generates should be able to delete what a person wrote.
    const stale = existing.filter(
      (q) => q.promptVersion !== null && q.promptVersion !== PRACTICE_SET_VERSION,
    );
    const keeping = existing.filter((q) => !stale.includes(q));

    const wantMcqs = Math.max(0, QUOTA.mcqs - keeping.filter((q) => q.kind === 'MCQ').length);
    const wantTheory = Math.max(
      0,
      QUOTA.theory - keeping.filter((q) => q.kind === 'THEORY').length,
    );
    if (wantMcqs === 0 && wantTheory === 0 && stale.length === 0) return null;

    let written: PracticeSetOutput;
    try {
      written = await practiceSetAgent.run(
        this.ai,
        {
          technologyName: concept.technology.name,
          conceptName: concept.name,
          conceptDescription: concept.description,
          difficulty: concept.difficulty,
          learningObjectives: concept.learningObjectives,
          commonMistakes: concept.commonMistakes,
          language: concept.technology.exerciseLanguage,
          existingPrompts: keeping.map((q) => q.prompt),
          wantMcqs,
          wantTheory,
        },
        { userId },
      );
    } catch (error) {
      // Degrade to whatever is already there. A concept with four seeded
      // questions and a failed top-up is still practisable, and failing the
      // whole tab would take those four away too.
      this.logger.warn({ err: error }, `Could not write questions for ${concept.slug}`);
      this.logger.debug(describeAIFailure(error));
      return null;
    }

    const stamp = {
      generatedBy: practiceSetAgent.name,
      promptVersion: PRACTICE_SET_VERSION,
    };

    await this.prisma.$transaction([
      // Archived, not deleted: a superseded question may have answers
      // pointing at it, and those are the user's own record.
      this.prisma.conceptQuestion.updateMany({
        where: { id: { in: stale.map((q) => q.id) } },
        data: { archivedAt: new Date() },
      }),
      this.prisma.conceptQuestion.createMany({
        data: [
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
        ],
      }),
    ]);

    this.logger.log(
      `Wrote ${written.mcqs.length} multiple choice and ${written.theory.length} ` +
        `written questions for ${concept.slug}`,
    );

    return this.stored(concept.id);
  }

  private async reschedule(userId: string, conceptId: string, selfRating: number): Promise<Date> {
    const [existing, skill] = await Promise.all([
      this.prisma.reviewSchedule.findUnique({ where: { userId_conceptId: { userId, conceptId } } }),
      this.prisma.skill.findUnique({
        where: { userId_conceptId: { userId, conceptId } },
        select: { conceptMastery: true },
      }),
    ]);

    // "Partly" is a pass that came back slowly, which is exactly what the
    // partial-credit path in gradeFromPerformance is for.
    const grade = gradeFromPerformance({
      passed: selfRating >= 1,
      testsPassed: selfRating,
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

    return next.dueAt;
  }
}
