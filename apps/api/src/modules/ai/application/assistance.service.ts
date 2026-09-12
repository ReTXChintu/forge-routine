import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  INTERVENTION_MESSAGE,
  checkEscalationGate,
  ladderPosition,
  shouldIntervene,
  staticHintFallback,
  tutorAgent,
  type TutorResult,
} from '@forgeroutine/ai';
import { HINT_LADDER } from '@forgeroutine/ai';
import type { AppConfig } from '@forgeroutine/config';
import type { HintKind, HintResponse } from '@forgeroutine/shared-types';
import { dayKey } from '@forgeroutine/utils';
import type { HintRequestInput } from '@forgeroutine/validation';

import { Problems } from '../../../common/http/problem-details.js';
import { APP_CONFIG } from '../../../infrastructure/config/config.module.js';
import { type PrismaService } from '../../../infrastructure/prisma/prisma.service.js';
import { AI_PROVIDER, type OptionalAIProvider } from '../ai.tokens.js';

/**
 * The assistance ladder, enforced server-side (docs/ai-assistance-policy.md).
 *
 * Every counter here is authoritative: the client cannot under-report how much
 * help it asked for, because the Independent Coding Score is only meaningful if
 * its inputs cannot be forged.
 */
@Injectable()
export class AssistanceService {
  private readonly logger = new Logger(AssistanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(AI_PROVIDER) private readonly ai: OptionalAIProvider,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async requestHint(userId: string, input: HintRequestInput): Promise<HintResponse> {
    const attempt = await this.loadAttempt(userId, input.attemptId);
    const secondsSinceOpen = Math.floor((Date.now() - attempt.openedAt.getTime()) / 1000);

    const priorHints = await this.prisma.hintRequest.findMany({
      where: { attemptId: attempt.id },
      orderBy: { createdAt: 'asc' },
    });

    const gate = checkEscalationGate({
      kind: input.kind,
      secondsSinceOpen,
      priorHintKinds: priorHints.map((h) => h.kind as HintKind),
      overrideConfirmed: input.overrideGate,
      blindMode: attempt.blindMode,
    });

    if (!gate.allowed) throw Problems.assistanceGated(gate.reason);

    const intervening = shouldIntervene({
      kind: input.kind,
      secondsSinceOpen,
      previousAttemptWasEarlyReveal: await this.previousAttemptWasEarlyReveal(
        userId,
        attempt.exerciseId,
        attempt.id,
      ),
    });

    const result = intervening
      ? this.interventionResponse()
      : await this.generate(userId, attempt, input, priorHints);

    await this.record(attempt.id, input.kind, result, secondsSinceOpen, intervening);

    return {
      hint: {
        id: '',
        attemptId: attempt.id,
        kind: input.kind,
        response: result.message,
        secondsSinceOpen,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      intervention: intervening ? INTERVENTION_MESSAGE : null,
      remainingBeforeSolution: Math.max(
        0,
        ladderPosition('SHOW_SOLUTION') - ladderPosition(input.kind),
      ),
      degraded: this.ai === null,
    };
  }

  private async loadAttempt(userId: string, attemptId: string) {
    const attempt = await this.prisma.exerciseAttempt.findUnique({
      where: { id: attemptId },
      include: {
        exercise: {
          include: { concept: { select: { name: true } } },
        },
      },
    });

    if (!attempt || attempt.userId !== userId) throw Problems.notFound('Attempt');
    if (attempt.outcome !== 'IN_PROGRESS') throw Problems.attemptClosed();

    return attempt;
  }

  private interventionResponse(): TutorResult {
    return {
      message: `${INTERVENTION_MESSAGE}\n\nWhat is the smallest part of this you could make work on its own?`,
      containsCode: false,
      question: 'What is the smallest part of this you could make work on its own?',
      conceptReferenced: null,
      redacted: false,
      promptVersion: 'v1',
    };
  }

  private async generate(
    userId: string,
    attempt: Awaited<ReturnType<AssistanceService['loadAttempt']>>,
    input: HintRequestInput,
    priorHints: { kind: string; response: string }[],
  ): Promise<TutorResult> {
    const overBudget = await this.isOverDailyBudget(userId);

    if (!this.ai || overBudget) {
      if (overBudget) this.logger.warn({ userId }, 'Daily AI token budget exceeded; degrading');
      return staticHintFallback(input.kind, attempt.exercise.staticHints, priorHints.length);
    }

    try {
      return await tutorAgent.run(
        this.ai,
        {
          kind: input.kind,
          conceptName: attempt.exercise.concept.name,
          exerciseTitle: attempt.exercise.title,
          exerciseRequirements: attempt.exercise.requirements,
          ...(input.code ? { userCode: input.code } : {}),
          ...(input.lastError ? { lastError: input.lastError } : {}),
          priorHints: priorHints.map((h) => ({
            kind: h.kind as HintKind,
            response: h.response,
          })),
        },
        { userId },
      );
    } catch (error) {
      this.logger.warn({ err: error }, 'Tutor call failed; falling back to static hints');
      return staticHintFallback(input.kind, attempt.exercise.staticHints, priorHints.length);
    }
  }

  private async record(
    attemptId: string,
    kind: HintKind,
    result: TutorResult,
    secondsSinceOpen: number,
    intervened: boolean,
  ): Promise<void> {
    if (result.redacted) {
      // A redaction means the model produced code despite the system block.
      // Logged loudly because it is a prompt regression, not a user problem.
      this.logger.warn({ kind }, 'Tutor output contained code and was redacted');
    }

    await this.prisma.$transaction([
      this.prisma.hintRequest.create({
        data: {
          attemptId,
          kind,
          response: result.message,
          secondsSinceOpen,
          intervened,
          degraded: this.ai === null,
        },
      }),
      this.prisma.exerciseAttempt.update({
        where: { id: attemptId },
        data: {
          // An intervention is not assistance: the user received a question, not
          // an answer, so it must not count against their independence score.
          aiRequestCount: { increment: intervened ? 0 : 1 },
          ...(kind === 'SHOW_SOLUTION' && !intervened ? { solutionRevealed: true } : {}),
        },
      }),
    ]);
  }

  private async previousAttemptWasEarlyReveal(
    userId: string,
    exerciseId: string,
    currentAttemptId: string,
  ): Promise<boolean> {
    const previous = await this.prisma.exerciseAttempt.findFirst({
      where: { userId, exerciseId, id: { not: currentAttemptId } },
      orderBy: { createdAt: 'desc' },
      include: {
        hintRequests: {
          where: { kind: { in: ['SHOW_SOLUTION', 'SHOW_APPROACH'] } },
          orderBy: { createdAt: 'asc' },
          take: 1,
        },
      },
    });

    const first = previous?.hintRequests[0];
    return first !== undefined && first.secondsSinceOpen < 60;
  }

  /** Exceeding the budget degrades to fallbacks rather than erroring at the user. */
  private async isOverDailyBudget(userId: string): Promise<boolean> {
    const budget = this.config.env.AI_DAILY_TOKEN_BUDGET;
    if (budget === 0) return false;

    const today = new Date(`${dayKey(new Date())}T00:00:00.000Z`);
    const usage = await this.prisma.tokenUsageDaily.findUnique({
      where: { userId_day: { userId, day: today } },
      select: { tokens: true },
    });

    return (usage?.tokens ?? 0) >= budget;
  }
}

export { HINT_LADDER };
