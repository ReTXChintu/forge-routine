import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  answerGraderAgent,
  interviewReportAgent,
  interviewerAgent,
  type InterviewReportOutput,
} from '@forgeroutine/ai';

import { Problems } from '../../../common/http/problem-details.js';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';
import { AI_PROVIDER, type OptionalAIProvider } from '../../ai/ai.tokens.js';
import { SkillsService } from '../../skills/application/skills.service.js';
import {
  interviewShape,
  maxTurns,
  selectInterviewConcepts,
  type SelectableConcept,
} from '../domain/concept-selector.js';

export type InterviewMode =
  'QUICK' | 'TECHNICAL' | 'CODING' | 'DEBUGGING' | 'SYSTEM_DESIGN' | 'SENIOR';
export type InterviewTarget = 'JUNIOR' | 'MID' | 'SENIOR';

export interface InterviewTurnView {
  questionId: string;
  orderIndex: number;
  prompt: string;
  conceptName: string | null;
  answer: string | null;
}

export interface InterviewView {
  id: string;
  mode: string;
  targetLevel: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  turns: InterviewTurnView[];
  /** The question awaiting an answer, or null when the interview is over. */
  currentQuestion: { id: string; prompt: string } | null;
  turnsRemaining: number;
}

export interface InterviewReportView {
  overallScore: number | null;
  dimensions: Record<string, number | null>;
  strongAreas: string[];
  weakAreas: string[];
  recommendedTopics: string[];
  summary: string | null;
  /** True when the report was produced without AI and is therefore thin. */
  degraded: boolean;
}

/**
 * The interview engine (§15-17).
 *
 * Three things make this different from a question list:
 *
 *  1. **The next question depends on the last answer.** A wrong answer gets a
 *     way back in; a strong one gets pushed harder. That reactivity is the
 *     whole product.
 *  2. **Nothing is graded in front of the user.** Feedback mid-interview turns
 *     it into a tutorial, and the user starts answering for approval rather
 *     than saying what they think.
 *  3. **The transcript is the evidence.** Skills are written once, from the
 *     final report, not turn by turn — one shaky answer is noise.
 */
@Injectable()
export class InterviewsService {
  private readonly logger = new Logger(InterviewsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly skills: SkillsService,
    @Inject(AI_PROVIDER) private readonly ai: OptionalAIProvider,
  ) {}

  async start(
    userId: string,
    mode: InterviewMode,
    targetLevel: InterviewTarget,
  ): Promise<InterviewView> {
    if (!this.ai) throw Problems.aiUnavailable();

    // One at a time. Two open interviews means two half-transcripts and no
    // usable report from either.
    const open = await this.prisma.interview.findFirst({
      where: { userId, status: 'IN_PROGRESS' },
      select: { id: true },
    });
    if (open) return this.get(userId, open.id);

    const candidates = await this.candidates(userId);
    if (candidates.length === 0) throw Problems.notFound('Anything to interview on');

    const shape = interviewShape(mode);
    const selected = selectInterviewConcepts(candidates, {
      count: shape.concepts,
      targetLevel,
    });

    const interview = await this.prisma.interview.create({
      data: { userId, mode, targetLevel, status: 'IN_PROGRESS' },
    });

    await this.ask(interview.id, selected[0], 'OPEN', 0, 0, mode, targetLevel, []);

    return this.get(userId, interview.id);
  }

  async get(userId: string, interviewId: string): Promise<InterviewView> {
    const interview = await this.load(userId, interviewId);

    const turns: InterviewTurnView[] = interview.questions.map((question) => ({
      questionId: question.id,
      orderIndex: question.orderIndex,
      prompt: question.prompt,
      conceptName: question.concept?.name ?? null,
      answer: question.answer?.text ?? null,
    }));

    const pending = interview.questions.find((question) => !question.answer);

    return {
      id: interview.id,
      mode: interview.mode,
      targetLevel: interview.targetLevel,
      status: interview.status,
      startedAt: interview.startedAt.toISOString(),
      endedAt: interview.endedAt?.toISOString() ?? null,
      turns,
      currentQuestion:
        interview.status === 'IN_PROGRESS' && pending
          ? { id: pending.id, prompt: pending.prompt }
          : null,
      turnsRemaining: Math.max(0, maxTurns(interview.mode) - interview.questions.length),
    };
  }

  /**
   * Record an answer and produce the next question, or end the interview.
   *
   * The grade is stored but never returned. The user finds out at the end,
   * the way they would in a real interview.
   */
  async answer(userId: string, questionId: string, text: string): Promise<InterviewView> {
    const question = await this.prisma.interviewQuestion.findUnique({
      where: { id: questionId },
      include: {
        answer: true,
        concept: { select: { id: true, name: true } },
        interview: {
          select: { id: true, userId: true, status: true, mode: true, targetLevel: true },
        },
      },
    });

    if (!question || question.interview.userId !== userId) throw Problems.notFound('Question');
    if (question.interview.status !== 'IN_PROGRESS') throw Problems.attemptClosed();
    if (question.answer) throw Problems.attemptClosed();

    const shape = interviewShape(question.interview.mode);
    const grade = await this.grade(question, text, shape.maxDepth);

    await this.prisma.interviewAnswer.create({
      data: {
        questionId,
        text,
        correctness: grade?.correctness ?? null,
        depth: grade?.depth ?? null,
        specificity: grade?.specificity ?? null,
        confidence: grade?.confidence ?? null,
      },
    });

    const asked = await this.prisma.interviewQuestion.count({
      where: { interviewId: question.interview.id },
    });

    if (asked >= maxTurns(question.interview.mode)) {
      await this.finish(userId, question.interview.id);
      return this.get(userId, question.interview.id);
    }

    await this.next(userId, question.interview.id, grade?.move ?? 'PIVOT');

    return this.get(userId, question.interview.id);
  }

  /** End early. The report covers what was actually asked and no more. */
  async end(userId: string, interviewId: string): Promise<InterviewReportView> {
    const interview = await this.load(userId, interviewId);
    if (interview.status === 'IN_PROGRESS') await this.finish(userId, interviewId);
    return this.report(userId, interviewId);
  }

  async report(userId: string, interviewId: string): Promise<InterviewReportView> {
    await this.load(userId, interviewId);

    const evaluation = await this.prisma.interviewEvaluation.findUnique({
      where: { interviewId },
    });

    if (!evaluation) throw Problems.notFound('Interview report');

    return {
      overallScore: evaluation.overallScore,
      dimensions: {
        technicalCorrectness: evaluation.technicalCorrectness,
        depth: evaluation.depth,
        problemSolving: evaluation.problemSolving,
        communication: evaluation.communication,
        confidence: evaluation.confidence,
        practicalKnowledge: evaluation.practicalKnowledge,
        architectureThinking: evaluation.architectureThinking,
        debugging: evaluation.debugging,
        codeQuality: evaluation.codeQuality,
        tradeOffAwareness: evaluation.tradeOffAwareness,
      },
      strongAreas: evaluation.strongAreas,
      weakAreas: evaluation.weakAreas,
      recommendedTopics: evaluation.recommendedTopics,
      summary: evaluation.summary,
      degraded: evaluation.summary === null,
    };
  }

  async history(userId: string, limit = 10) {
    const interviews = await this.prisma.interview.findMany({
      where: { userId },
      orderBy: { startedAt: 'desc' },
      take: limit,
      include: {
        evaluation: { select: { overallScore: true } },
        _count: { select: { questions: true } },
      },
    });

    return interviews.map((interview) => ({
      id: interview.id,
      mode: interview.mode,
      targetLevel: interview.targetLevel,
      status: interview.status,
      startedAt: interview.startedAt.toISOString(),
      endedAt: interview.endedAt?.toISOString() ?? null,
      questionCount: interview._count.questions,
      overallScore: interview.evaluation?.overallScore ?? null,
    }));
  }

  // -- Turn machinery -------------------------------------------------------

  private async grade(
    question: {
      prompt: string;
      depth: number;
      expectedPoints: string[];
      concept: { name: string } | null;
    },
    text: string,
    maxDepth: number,
  ) {
    if (!this.ai) return null;

    try {
      return await answerGraderAgent.run(
        this.ai,
        {
          question: question.prompt,
          answer: text,
          conceptName: question.concept?.name ?? 'general',
          expectedPoints: question.expectedPoints,
          depth: question.depth,
          maxDepth,
        },
        {},
      );
    } catch (error) {
      // An ungraded answer is still a recorded answer. Losing the user's
      // words because the grader timed out would be the worse failure.
      this.logger.warn({ err: error }, 'Answer grading failed');
      return null;
    }
  }

  private async next(userId: string, interviewId: string, decidedMove: string): Promise<void> {
    const interview = await this.load(userId, interviewId);
    const shape = interviewShape(interview.mode);

    const asked = interview.questions;
    const last = asked[asked.length - 1];
    const usedConceptIds = new Set(
      asked.map((question) => question.conceptId).filter((id): id is string => id !== null),
    );

    // PIVOT moves to a new area; every other move stays put and goes deeper.
    let move = decidedMove;
    let conceptId = last?.conceptId ?? null;
    let depth = (last?.depth ?? 0) + 1;

    if (move === 'PIVOT' || depth >= shape.maxDepth) {
      const candidates = await this.candidates(userId);
      const unused = candidates.filter((concept) => !usedConceptIds.has(concept.conceptId));

      // Running out of areas ends the interview rather than repeating one.
      if (unused.length === 0) {
        await this.finish(userId, interviewId);
        return;
      }

      const [nextConcept] = selectInterviewConcepts(unused, {
        count: 1,
        targetLevel: interview.targetLevel as InterviewTarget,
      });
      conceptId = nextConcept?.conceptId ?? null;
      depth = 0;
      move = 'OPEN';
    }

    const concept = conceptId
      ? await this.prisma.concept.findUnique({
          where: { id: conceptId },
          select: { id: true, name: true, description: true, commonMistakes: true },
        })
      : null;

    if (!concept) {
      await this.finish(userId, interviewId);
      return;
    }

    await this.ask(
      interviewId,
      {
        conceptId: concept.id,
        name: concept.name,
        description: concept.description,
        commonMistakes: concept.commonMistakes,
        // Ranking is already done; only the descriptive fields matter here.
        mastery: null,
        interviewRelevance: 0,
        difficulty: 3,
      },
      move,
      depth,
      asked.length,
      interview.mode as InterviewMode,
      interview.targetLevel as InterviewTarget,
      asked.map((question) => ({
        question: question.prompt,
        answer: question.answer?.text ?? '',
        move: question.move,
      })),
    );
  }

  private async ask(
    interviewId: string,
    concept: SelectableConcept | undefined,
    move: string,
    depth: number,
    orderIndex: number,
    mode: InterviewMode,
    targetLevel: InterviewTarget,
    transcript: readonly { question: string; answer: string; move: string }[],
  ): Promise<void> {
    if (!concept || !this.ai) throw Problems.aiUnavailable();

    const question = await interviewerAgent.run(
      this.ai,
      {
        mode,
        targetLevel,
        conceptName: concept.name,
        conceptDescription: concept.description,
        commonMistakes: concept.commonMistakes,
        transcript,
        move: move as 'OPEN',
        depth,
      },
      {},
    );

    await this.prisma.interviewQuestion.create({
      data: {
        interviewId,
        conceptId: concept.conceptId,
        orderIndex,
        prompt: question.prompt,
        move,
        depth,
        expectedPoints: question.expectedPoints,
      },
    });
  }

  // -- Closing --------------------------------------------------------------

  private async finish(userId: string, interviewId: string): Promise<void> {
    const interview = await this.load(userId, interviewId);
    const answered = interview.questions.filter((question) => question.answer !== null);

    const report = await this.buildReport(interview, answered);

    await this.prisma.$transaction([
      this.prisma.interview.update({
        where: { id: interviewId },
        data: { status: 'COMPLETED', endedAt: new Date() },
      }),
      this.prisma.interviewEvaluation.upsert({
        where: { interviewId },
        create: { interviewId, ...report },
        update: report,
      }),
    ]);

    await this.writeSkillEvidence(userId, interview, answered);
  }

  /**
   * The debrief.
   *
   * The numbers and the prose come from different places on purpose. Every
   * answer was already graded when it was given — against that specific
   * question, with the expected points in hand — so `technicalCorrectness`,
   * `depth` and `confidence` are the means of those grades, not a second
   * opinion. A live run proved why: asked to re-score a whole transcript at
   * once, the model returned `overallScore: 1` beside six weak areas
   * describing a candidate who got nothing right. The prose was accurate and
   * the number was noise, and the number is what writes to the skill model.
   *
   * The report agent is left with what it is genuinely better at — reading
   * the transcript as a whole for communication and practical judgement, and
   * saying what to do about it.
   */
  private async buildReport(
    interview: { mode: string; targetLevel: string },
    answered: readonly {
      prompt: string;
      concept: { name: string } | null;
      answer: {
        text: string;
        correctness: number | null;
        depth: number | null;
        confidence: number | null;
      } | null;
    }[],
  ) {
    const measured = gradedDimensions(answered);

    if (!this.ai || answered.length === 0) return { ...measured, ...noProse() };

    try {
      const generated: InterviewReportOutput = await interviewReportAgent.run(
        this.ai,
        {
          mode: interview.mode,
          targetLevel: interview.targetLevel,
          transcript: answered.map((question) => ({
            question: question.prompt,
            answer: question.answer?.text ?? '',
            conceptName: question.concept?.name ?? 'general',
          })),
        },
        {},
      );

      return {
        ...measured,
        problemSolving: generated.problemSolving,
        communication: generated.communication,
        practicalKnowledge: generated.practicalKnowledge,
        architectureThinking: generated.architectureThinking,
        debugging: generated.debugging,
        codeQuality: generated.codeQuality,
        tradeOffAwareness: generated.tradeOffAwareness,
        strongAreas: generated.strongAreas,
        weakAreas: generated.weakAreas,
        recommendedTopics: generated.recommendedTopics,
        summary: generated.summary,
      };
    } catch (error) {
      // The grades survive regardless, so a report without prose is still a
      // real one. A null summary marks it degraded, so the UI can say the
      // written review is missing rather than passing arithmetic off as
      // insight.
      this.logger.warn({ err: error }, 'Interview report generation failed');
      return { ...measured, ...noProse() };
    }
  }

  /**
   * Skill evidence, written once at the end, per concept.
   *
   * `explanationAbility` is what an interview measures best — it is the only
   * activity in the product where the user has to say the thing out loud.
   * `codingAbility` is deliberately absent: not one line of code was written.
   */
  private async writeSkillEvidence(
    userId: string,
    interview: { mode: string },
    answered: readonly {
      conceptId: string | null;
      answer: {
        correctness: number | null;
        depth: number | null;
        confidence: number | null;
      } | null;
    }[],
  ): Promise<void> {
    const byConcept = new Map<
      string,
      { correctness: number[]; depth: number[]; confidence: number[] }
    >();

    for (const question of answered) {
      if (!question.conceptId || !question.answer) continue;
      const bucket = byConcept.get(question.conceptId) ?? {
        correctness: [],
        depth: [],
        confidence: [],
      };
      const { correctness, depth, confidence } = question.answer;
      if (correctness !== null) bucket.correctness.push(correctness);
      if (depth !== null) bucket.depth.push(depth);
      if (confidence !== null) bucket.confidence.push(confidence);
      byConcept.set(question.conceptId, bucket);
    }

    for (const [conceptId, bucket] of byConcept) {
      const correctness = mean(bucket.correctness);
      if (correctness === null) continue;

      await this.skills.applyEvidence({
        userId,
        conceptId,
        cause: 'INTERVIEW',
        note: `${interview.mode} interview`,
        // One interview is real evidence but a small sample, and nerves are a
        // confound. It moves the model; it does not define it.
        learningRate: 0.25,
        evidence: {
          explanationAbility: correctness,
          interviewReadiness: correctness,
          conceptMastery: mean(bucket.depth),
          confidence: mean(bucket.confidence),
        },
      });
    }
  }

  // -- Candidates -----------------------------------------------------------

  /**
   * Concepts this user could be interviewed on.
   *
   * Practised ones only. Interviewing someone on material they have never
   * studied measures nothing except that they have not studied it, which the
   * roadmap already knows.
   */
  private async candidates(userId: string): Promise<SelectableConcept[]> {
    const technologies = await this.prisma.userTechnology.findMany({
      where: { userId, status: 'ACTIVE', archivedAt: null },
      select: { technologyId: true, interviewImportance: true },
    });

    if (technologies.length === 0) return [];

    const importance = new Map(technologies.map((t) => [t.technologyId, t.interviewImportance]));

    const concepts = await this.prisma.concept.findMany({
      where: { technologyId: { in: [...importance.keys()] }, archivedAt: null },
      select: {
        id: true,
        name: true,
        description: true,
        difficulty: true,
        commonMistakes: true,
        technologyId: true,
        skills: { where: { userId }, select: { conceptMastery: true, attempts: true } },
        _count: { select: { dependents: true } },
      },
    });

    const maxDependents = Math.max(1, ...concepts.map((concept) => concept._count.dependents));

    return concepts
      .filter((concept) => (concept.skills[0]?.attempts ?? 0) > 0)
      .map((concept) => ({
        conceptId: concept.id,
        name: concept.name,
        description: concept.description,
        commonMistakes: concept.commonMistakes,
        mastery: concept.skills[0]?.conceptMastery ?? null,
        // Two honest signals: how much the user says this technology matters
        // for their interviews, and how foundational the concept is within
        // it. A concept many others depend on is one that gets asked about.
        interviewRelevance:
          ((importance.get(concept.technologyId) ?? 3) / 5) * 0.7 +
          (concept._count.dependents / maxDependents) * 0.3,
        difficulty: concept.difficulty,
      }));
  }

  private async load(userId: string, interviewId: string) {
    const interview = await this.prisma.interview.findUnique({
      where: { id: interviewId },
      include: {
        questions: {
          orderBy: { orderIndex: 'asc' },
          include: { answer: true, concept: { select: { id: true, name: true } } },
        },
      },
    });

    if (!interview || interview.userId !== userId) throw Problems.notFound('Interview');
    return interview;
  }
}

/**
 * The dimensions the per-answer grades actually measured.
 *
 * `overallScore` leans on correctness because that is what an interview
 * establishes most reliably; depth pulls it down when someone is right but
 * cannot say why. Confidence is reported and deliberately excluded from the
 * total — sounding certain is not the same as being correct, and rewarding it
 * would train exactly the wrong habit.
 */
function gradedDimensions(
  answered: readonly {
    answer: { correctness: number | null; depth: number | null; confidence: number | null } | null;
  }[],
) {
  const correctness = mean(answered.map((question) => question.answer?.correctness ?? null));
  const depth = mean(answered.map((question) => question.answer?.depth ?? null));
  const confidence = mean(answered.map((question) => question.answer?.confidence ?? null));

  const overall =
    correctness === null ? null : depth === null ? correctness : correctness * 0.7 + depth * 0.3;

  return {
    overallScore: overall,
    technicalCorrectness: correctness,
    depth,
    confidence,
    interviewReadiness: overall,
  };
}

/**
 * Everything the report agent would have supplied, when it could not.
 *
 * A function rather than a constant, so each caller gets its own arrays —
 * a shared empty array spread into a Prisma write is a trap waiting for
 * whoever appends to one.
 */
function noProse() {
  return {
    problemSolving: null,
    communication: null,
    practicalKnowledge: null,
    architectureThinking: null,
    debugging: null,
    codeQuality: null,
    tradeOffAwareness: null,
    strongAreas: [] as string[],
    weakAreas: [] as string[],
    recommendedTopics: [] as string[],
    summary: null,
  };
}

function mean(values: readonly (number | null)[]): number | null {
  const present = values.filter((value): value is number => value !== null);
  if (present.length === 0) return null;
  return present.reduce((sum, value) => sum + value, 0) / present.length;
}
