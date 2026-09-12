import { Inject, Injectable, Logger } from '@nestjs/common';

import { evaluatorAgent, executionOnlyEvaluation } from '@forgeroutine/ai';
import type { Prisma } from '@forgeroutine/database';
import {
  type CodeEvaluation,
  type ExecutionResult,
  type SubmissionResponse,
  INTERNAL_EXECUTION_FAILURES,
} from '@forgeroutine/shared-types';
import {
  decideAssistanceLevel,
  gradeFromPerformance,
  scheduleNextReview,
  unit,
  type AttemptEvidence,
} from '@forgeroutine/utils';
import type { SubmitCodeInput } from '@forgeroutine/validation';

import { Problems } from '../../../common/http/problem-details.js';
import { type PrismaService } from '../../../infrastructure/prisma/prisma.service.js';
import { AI_PROVIDER, type OptionalAIProvider } from '../../ai/ai.tokens.js';
import { type SkillsService } from '../../skills/application/skills.service.js';
import { CODE_EXECUTION_PORT, type CodeExecutionPort } from '../ports/code-execution.port.js';

/**
 * The submission pipeline (docs/architecture.md, "Request lifecycle").
 *
 *   validate → load attempt → EXECUTE → evaluate → update skills → schedule review
 *
 * Ordering is deliberate: execution happens **before** AI evaluation, and the
 * evaluator receives real test results as ground truth. We never ask a model
 * whether code passes — we measure it, then ask about quality. That keeps business
 * logic off arbitrary AI prose (§45.7) and keeps the skill model honest.
 */
@Injectable()
export class SubmitSolutionUseCase {
  private readonly logger = new Logger(SubmitSolutionUseCase.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly skills: SkillsService,
    @Inject(CODE_EXECUTION_PORT) private readonly execution: CodeExecutionPort,
    @Inject(AI_PROVIDER) private readonly ai: OptionalAIProvider,
  ) {}

  async execute(
    userId: string,
    input: SubmitCodeInput,
    idempotencyKey?: string,
  ): Promise<SubmissionResponse> {
    const attempt = await this.loadAttempt(userId, input.attemptId);

    if (idempotencyKey) {
      const existing = await this.findIdempotent(input.attemptId, idempotencyKey);
      if (existing) return existing;
    }

    const exercise = attempt.exercise;
    const testCases = exercise.testCases.map((t) => ({
      name: t.name,
      hidden: t.hidden,
      code: t.code,
    }));

    const executionResult = await this.execution.run({
      code: input.code,
      language: input.language,
      testCases,
    });

    const evaluation = await this.evaluate(executionResult, attempt, input);

    const submission = await this.persist({
      userId,
      attempt,
      input,
      idempotencyKey,
      executionResult,
      evaluation,
    });

    const skillDeltas = await this.recordProgress({
      userId,
      attempt,
      executionResult,
      evaluation,
      submissionId: submission.id,
    });

    return {
      submissionId: submission.id,
      execution: this.redactHiddenCases(executionResult, attempt.assistanceLevel),
      evaluation,
      attemptOutcome: executionResult.passed ? 'PASSED' : 'FAILED',
      skillDeltas,
      independenceScore: null,
      nextActionHint: nextActionHint(executionResult, evaluation),
    };
  }

  private async loadAttempt(userId: string, attemptId: string) {
    const attempt = await this.prisma.exerciseAttempt.findUnique({
      where: { id: attemptId },
      include: {
        exercise: {
          include: {
            testCases: { orderBy: { orderIndex: 'asc' } },
            concept: { select: { id: true, name: true, commonMistakes: true } },
          },
        },
      },
    });

    if (!attempt) throw Problems.notFound('Attempt');
    // Not a 403: revealing that someone else's attempt exists is itself a leak.
    if (attempt.userId !== userId) throw Problems.notFound('Attempt');
    if (attempt.outcome !== 'IN_PROGRESS') throw Problems.attemptClosed();

    return attempt;
  }

  private async findIdempotent(
    attemptId: string,
    idempotencyKey: string,
  ): Promise<SubmissionResponse | null> {
    const existing = await this.prisma.codeSubmission.findUnique({
      where: { attemptId_idempotencyKey: { attemptId, idempotencyKey } },
      include: { execution: true, evaluation: true },
    });
    if (!existing?.execution) return null;

    // A double-clicked submit must not create a second attempt record or a second
    // set of skill events.
    return {
      submissionId: existing.id,
      execution: toExecutionResult(existing.execution),
      evaluation: null,
      attemptOutcome: existing.execution.passed ? 'PASSED' : 'FAILED',
      skillDeltas: [],
      independenceScore: null,
      nextActionHint: null,
    };
  }

  private async evaluate(
    execution: ExecutionResult,
    attempt: Awaited<ReturnType<SubmitSolutionUseCase['loadAttempt']>>,
    input: SubmitCodeInput,
  ): Promise<CodeEvaluation> {
    // Our own failure. Do not spend a model call explaining our bug to the user,
    // and do not record it as evidence about them.
    if (INTERNAL_EXECUTION_FAILURES.includes(execution.status)) {
      return executionOnlyEvaluation(execution);
    }

    if (!this.ai) return executionOnlyEvaluation(execution);

    try {
      return await evaluatorAgent.run(
        this.ai,
        {
          conceptName: attempt.exercise.concept.name,
          exerciseTitle: attempt.exercise.title,
          requirements: attempt.exercise.requirements,
          code: input.code,
          language: input.language,
          execution,
          commonMistakes: attempt.exercise.concept.commonMistakes,
        },
        { userId: attempt.userId },
      );
    } catch (error) {
      // Degrade, never fail the submission: the user's work is already done and
      // the execution result is the part that must not be lost.
      this.logger.warn({ err: error }, 'AI evaluation failed; falling back to execution only');
      return executionOnlyEvaluation(execution);
    }
  }

  private async persist(args: {
    userId: string;
    attempt: Awaited<ReturnType<SubmitSolutionUseCase['loadAttempt']>>;
    input: SubmitCodeInput;
    idempotencyKey: string | undefined;
    executionResult: ExecutionResult;
    evaluation: CodeEvaluation;
  }) {
    const { userId, attempt, input, idempotencyKey, executionResult, evaluation } = args;
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      const submission = await tx.codeSubmission.create({
        data: {
          attemptId: attempt.id,
          userId,
          code: input.code,
          language: input.language,
          idempotencyKey: idempotencyKey ?? null,
          execution: {
            create: {
              status: executionResult.status,
              passed: executionResult.passed,
              testsPassed: executionResult.testsPassed,
              testsTotal: executionResult.testsTotal,
              // Prisma's InputJsonValue does not accept a typed array directly;
              // the shape is guaranteed by ExecutionResult upstream.
              cases: executionResult.cases as unknown as Prisma.InputJsonValue,
              stdout: executionResult.stdout,
              stderr: executionResult.stderr,
              durationMs: executionResult.durationMs,
              truncated: executionResult.truncated,
            },
          },
          evaluation: {
            create: {
              overallScore: evaluation.overallScore,
              correctness: evaluation.quality.correctness,
              readability: evaluation.quality.readability,
              architecture: evaluation.quality.architecture,
              performance: evaluation.quality.performance,
              security: evaluation.quality.security,
              errorHandling: evaluation.quality.errorHandling,
              edgeCases: evaluation.quality.edgeCases,
              idiomatic: evaluation.quality.idiomatic,
              strengths: evaluation.strengths,
              weaknesses: evaluation.weaknesses,
              conceptGaps: evaluation.conceptGaps,
              recommendedDifficulty: evaluation.recommendedDifficulty,
              nextAction: evaluation.nextAction,
              degraded: evaluation.degraded,
            },
          },
        },
      });

      // A harness failure is our bug: it must not close the user's attempt or
      // count as one of their submissions.
      const ourFault = INTERNAL_EXECUTION_FAILURES.includes(executionResult.status);

      await tx.exerciseAttempt.update({
        where: { id: attempt.id },
        data: {
          submissionCount: { increment: ourFault ? 0 : 1 },
          ...(executionResult.passed && !ourFault
            ? {
                outcome: 'PASSED',
                completedAt: now,
                totalDurationMs: now.getTime() - attempt.openedAt.getTime(),
              }
            : {}),
          ...(input.clientSignals?.keystrokeCount !== undefined
            ? { keystrokeCount: input.clientSignals.keystrokeCount }
            : {}),
          ...(input.clientSignals?.largePasteEvents !== undefined
            ? { largePasteEvents: input.clientSignals.largePasteEvents }
            : {}),
        },
      });

      return submission;
    });
  }

  private async recordProgress(args: {
    userId: string;
    attempt: Awaited<ReturnType<SubmitSolutionUseCase['loadAttempt']>>;
    executionResult: ExecutionResult;
    evaluation: CodeEvaluation;
    submissionId: string;
  }) {
    const { userId, attempt, executionResult, evaluation, submissionId } = args;

    if (INTERNAL_EXECUTION_FAILURES.includes(executionResult.status)) return [];

    const conceptId = attempt.exercise.concept.id;
    const passed = executionResult.passed;
    const ratio =
      executionResult.testsTotal === 0
        ? passed
          ? 1
          : 0
        : executionResult.testsPassed / executionResult.testsTotal;

    // Assistance discounts the evidence: passing after four hints says less about
    // independent ability than passing cold.
    const assistanceDiscount = unit(1 - Math.min(1, attempt.aiRequestCount / 6) * 0.5);
    const codingEvidence = attempt.solutionRevealed ? ratio * 0.25 : ratio * assistanceDiscount;

    return this.prisma.$transaction(async (tx) => {
      const deltas = await this.skills.applyEvidenceIn(tx, {
        userId,
        conceptId,
        cause: 'EXERCISE_ATTEMPT',
        sourceId: submissionId,
        assistanceLevel: await this.nextAssistanceLevel(tx, userId, conceptId, attempt),
        evidence: {
          codingAbility: codingEvidence,
          conceptMastery: evaluation.overallScore ?? ratio,
          problemSolving: evaluation.quality.architecture ?? null,
          debuggingAbility: attempt.submissionCount > 1 && passed ? ratio : null,
          confidence: passed && attempt.aiRequestCount === 0 ? 1 : null,
          recallStrength: attempt.assistanceLevel >= 3 ? codingEvidence : null,
        },
      });

      await this.scheduleReview(tx, userId, conceptId, {
        passed,
        testsPassed: executionResult.testsPassed,
        testsTotal: executionResult.testsTotal,
        aiRequestCount: attempt.aiRequestCount,
        solutionRevealed: attempt.solutionRevealed,
      });

      return deltas;
    });
  }

  private async nextAssistanceLevel(
    tx: Parameters<SkillsService['applyEvidenceIn']>[0],
    userId: string,
    conceptId: string,
    attempt: { assistanceLevel: number },
  ) {
    const recent = await tx.exerciseAttempt.findMany({
      where: { userId, exercise: { conceptId }, outcome: { not: 'IN_PROGRESS' } },
      orderBy: { completedAt: 'desc' },
      take: 3,
      select: {
        id: true,
        assistanceLevel: true,
        outcome: true,
        aiRequestCount: true,
        solutionRevealed: true,
        timeToFirstCodeMs: true,
        completedAt: true,
      },
    });

    const evidence: AttemptEvidence[] = recent.map((row) => ({
      attemptId: row.id,
      conceptId,
      completedAt: row.completedAt ?? new Date(),
      assistanceLevel: row.assistanceLevel as AttemptEvidence['assistanceLevel'],
      passed: row.outcome === 'PASSED',
      aiRequestCount: row.aiRequestCount,
      solutionRevealed: row.solutionRevealed,
      timeToFirstCodeMs: row.timeToFirstCodeMs,
      isSuccessfulReattempt: false,
    }));

    const decision = decideAssistanceLevel({
      currentLevel: attempt.assistanceLevel as AttemptEvidence['assistanceLevel'],
      recentAttempts: evidence,
    });

    return decision.action === 'HOLD' ? undefined : decision.to;
  }

  private async scheduleReview(
    tx: Parameters<SkillsService['applyEvidenceIn']>[0],
    userId: string,
    conceptId: string,
    performance: {
      passed: boolean;
      testsPassed: number;
      testsTotal: number;
      aiRequestCount: number;
      solutionRevealed: boolean;
    },
  ): Promise<void> {
    const existing = await tx.reviewSchedule.findUnique({
      where: { userId_conceptId: { userId, conceptId } },
    });
    const skill = await tx.skill.findUnique({
      where: { userId_conceptId: { userId, conceptId } },
      select: { conceptMastery: true },
    });

    const next = scheduleNextReview(
      {
        easeFactor: existing?.easeFactor ?? 2.5,
        intervalDays: existing?.intervalDays ?? 0,
        repetitions: existing?.repetitions ?? 0,
        lapses: existing?.lapses ?? 0,
      },
      gradeFromPerformance(performance),
      { mastery: skill?.conceptMastery ?? 0.5 },
    );

    await tx.reviewSchedule.upsert({
      where: { userId_conceptId: { userId, conceptId } },
      create: {
        userId,
        conceptId,
        easeFactor: next.easeFactor,
        intervalDays: next.intervalDays,
        repetitions: next.repetitions,
        lapses: next.lapses,
        dueAt: next.dueAt,
        lastReviewedAt: new Date(),
      },
      update: {
        easeFactor: next.easeFactor,
        intervalDays: next.intervalDays,
        repetitions: next.repetitions,
        lapses: next.lapses,
        dueAt: next.dueAt,
        lastReviewedAt: new Date(),
      },
    });
  }

  /**
   * Hidden cases are executed but their details are withheld below level 3, and
   * their *names* are withheld above it — otherwise a user could read the spec out
   * of the failure list instead of deriving it.
   */
  private redactHiddenCases(result: ExecutionResult, level: number): ExecutionResult {
    if (level <= 2) return result;

    return {
      ...result,
      cases: result.cases.map((c, index) => ({
        ...c,
        name: c.passed ? c.name : `Hidden case ${index + 1}`,
      })),
    };
  }
}

function toExecutionResult(row: {
  status: string;
  passed: boolean;
  testsPassed: number;
  testsTotal: number;
  cases: unknown;
  stdout: string;
  stderr: string;
  durationMs: number;
  truncated: boolean;
}): ExecutionResult {
  return {
    status: row.status as ExecutionResult['status'],
    passed: row.passed,
    testsPassed: row.testsPassed,
    testsTotal: row.testsTotal,
    cases: Array.isArray(row.cases) ? (row.cases as unknown as ExecutionResult['cases']) : [],
    stdout: row.stdout,
    stderr: row.stderr,
    durationMs: row.durationMs,
    truncated: row.truncated,
  };
}

function nextActionHint(execution: ExecutionResult, evaluation: CodeEvaluation): string | null {
  if (execution.status === 'TIMEOUT') {
    return 'Something is not terminating. Which loop or timer never finishes?';
  }
  if (execution.status === 'COMPILE_ERROR') {
    return 'The file could not be loaded. Check the export before looking at the logic.';
  }
  if (!execution.passed) {
    const first = execution.cases.find((c) => !c.passed);
    return first ? `Start with "${first.name}".` : 'Some cases are still failing.';
  }
  if (evaluation.nextAction === 'advance') {
    return 'Clean pass. The next exercise will give you less to start from.';
  }
  return null;
}
