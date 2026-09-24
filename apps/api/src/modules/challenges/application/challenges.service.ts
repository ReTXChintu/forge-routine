import { Inject, Injectable, Logger } from '@nestjs/common';

import { designReviewAgent, incidentReviewAgent, scoreDesign } from '@forgeroutine/ai';
import { findScenario, runScenario, describeCheck } from '@forgeroutine/terminal';

import { Problems } from '../../../common/http/problem-details.js';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';
import { AI_PROVIDER, type OptionalAIProvider } from '../../ai/ai.tokens.js';
import { SkillsService } from '../../skills/application/skills.service.js';
import {
  parseChallengeSpec,
  type ChallengeSpec,
  type IncidentSpec,
  type SystemDesignSpec,
} from '../domain/challenge-spec.js';

export interface ChallengeSummary {
  exerciseId: string;
  slug: string;
  kind: 'SYSTEM_DESIGN' | 'INCIDENT' | 'TERMINAL';
  title: string;
  objective: string;
  difficulty: number;
  estimatedMinutes: number;
  /** What this challenge practises. Attributes a timed session to a concept. */
  conceptId: string;
  conceptName: string;
  technologyName: string;
  completed: boolean;
}

export interface ChallengeView extends ChallengeSummary {
  attemptId: string | null;
  /** Everything the user may see before submitting. Never the answer. */
  brief: {
    body: string;
    constraints: string[];
    sections: string[];
    /** TERMINAL only: the starting shell and what counts as done. */
    terminal?: { task: string; goals: string[] };
    /** INCIDENT only: the evidence. Shown in full — the signal is there. */
    telemetry?: string;
  };
}

export interface TerminalRunResult {
  transcript: { command: string; stdout: string; stderr: string; exitCode: number }[];
  checks: { description: string; passed: boolean; detail: string }[];
  passed: boolean;
}

export interface WrittenReviewResult {
  passed: boolean;
  scores: Record<string, number | null>;
  strengths: string[];
  issues: { severity: string; title: string; explanation: string }[];
  followUpQuestions: string[];
  summary: string;
  /** INCIDENT only, and only after submission. */
  rootCause?: string;
  missedSignals?: string[];
  degraded: boolean;
}

/**
 * Advanced engineering challenges (§18-19).
 *
 * Three kinds, none graded by running the user's code:
 *
 *  - **SYSTEM_DESIGN** — prose, reviewed by an agent that names gaps and
 *    refuses to design it for them.
 *  - **INCIDENT** — a diagnosis written against telemetry. The real cause is
 *    withheld until they have committed to one, for the same reason a
 *    debugging exercise withholds its bug explanation (§13): being told the
 *    answer while you are still forming one destroys the exercise.
 *  - **TERMINAL** — replayed against the deterministic simulator and graded
 *    on the end state, not on which commands were typed.
 */
@Injectable()
export class ChallengesService {
  private readonly logger = new Logger(ChallengesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly skills: SkillsService,
    @Inject(AI_PROVIDER) private readonly ai: OptionalAIProvider,
  ) {}

  async list(userId: string): Promise<ChallengeSummary[]> {
    const rows = await this.prisma.exercise.findMany({
      where: {
        kind: { in: ['SYSTEM_DESIGN', 'INCIDENT', 'TERMINAL'] },
        archivedAt: null,
        concept: { technology: { userTechnologies: { some: { userId, archivedAt: null } } } },
      },
      orderBy: [{ difficulty: 'asc' }, { title: 'asc' }],
      include: {
        concept: { select: { id: true, name: true, technology: { select: { name: true } } } },
        attempts: {
          where: { userId, outcome: 'PASSED' },
          select: { id: true },
          take: 1,
        },
      },
    });

    return rows.flatMap((row) => {
      const spec = parseChallengeSpec(row.challengeSpec);
      if (!spec) {
        // One malformed row must not take down the list. The user sees one
        // fewer challenge; we see the reason.
        this.logger.warn(`Challenge ${row.slug} has an unreadable spec and was skipped`);
        return [];
      }

      return [
        {
          exerciseId: row.id,
          slug: row.slug,
          kind: spec.kind,
          title: row.title,
          objective: row.objective,
          difficulty: row.difficulty,
          estimatedMinutes: row.estimatedMinutes,
          conceptId: row.concept.id,
          conceptName: row.concept.name,
          technologyName: row.concept.technology.name,
          completed: row.attempts.length > 0,
        },
      ];
    });
  }

  async get(userId: string, exerciseId: string): Promise<ChallengeView> {
    const { row, spec } = await this.load(exerciseId);

    const attempt = await this.prisma.exerciseAttempt.findFirst({
      where: { userId, exerciseId, outcome: 'IN_PROGRESS' },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });

    const passed = await this.prisma.exerciseAttempt.count({
      where: { userId, exerciseId, outcome: 'PASSED' },
    });

    return {
      exerciseId: row.id,
      slug: row.slug,
      kind: spec.kind,
      title: row.title,
      objective: row.objective,
      difficulty: row.difficulty,
      estimatedMinutes: row.estimatedMinutes,
      conceptId: row.concept.id,
      conceptName: row.concept.name,
      technologyName: row.concept.technology.name,
      completed: passed > 0,
      attemptId: attempt?.id ?? null,
      brief: this.brief(spec),
    };
  }

  async start(userId: string, exerciseId: string): Promise<ChallengeView> {
    await this.load(exerciseId);

    const existing = await this.prisma.exerciseAttempt.findFirst({
      where: { userId, exerciseId, outcome: 'IN_PROGRESS' },
    });

    // A refresh must not restart the clock or discard a half-written design.
    if (!existing) {
      await this.prisma.exerciseAttempt.create({
        data: { userId, exerciseId, assistanceLevel: 3, openedAt: new Date() },
      });
    }

    return this.get(userId, exerciseId);
  }

  // -- Terminal -------------------------------------------------------------

  /**
   * Replays commands against a fresh simulator and grades the end state.
   *
   * Replayed rather than held live between requests: the API is stateless,
   * and a shell in memory would not survive a restart, a second tab, or a
   * second process behind PM2. The whole filesystem is a Map, so replaying is
   * cheaper than the round trip that delivered the commands.
   */
  async runTerminal(exerciseId: string, commands: readonly string[]): Promise<TerminalRunResult> {
    const { spec } = await this.load(exerciseId);
    if (spec.kind !== 'TERMINAL') throw Problems.notFound('Terminal challenge');

    const scenario = findScenario(spec.scenarioSlug);
    if (!scenario) {
      // The spec names a scenario that no longer ships. That is our bug, not
      // the user's, and it must not read as a failed attempt.
      this.logger.error(`Challenge ${exerciseId} names missing scenario ${spec.scenarioSlug}`);
      throw Problems.notFound('Terminal scenario');
    }

    const result = runScenario(scenario, commands);

    return {
      transcript: result.transcript.map((entry) => ({
        command: entry.command,
        stdout: entry.result.stdout,
        stderr: entry.result.stderr,
        exitCode: entry.result.exitCode,
      })),
      checks: result.checks.map((check) => ({
        description: describeCheck(check.check),
        passed: check.passed,
        detail: check.detail,
      })),
      passed: result.passed,
    };
  }

  /** Grades a terminal attempt for real: writes skill evidence and closes it. */
  async submitTerminal(
    userId: string,
    attemptId: string,
    commands: readonly string[],
  ): Promise<TerminalRunResult> {
    const attempt = await this.requireOpenAttempt(userId, attemptId);
    const result = await this.runTerminal(attempt.exerciseId, commands);

    await this.record(userId, attempt, commands.join('\n'), result.passed, {
      // A terminal scenario is operational problem-solving: it says nothing
      // about whether the user can write a function.
      problemSolving: score(result.checks),
      debuggingAbility: score(result.checks),
      conceptMastery: result.passed ? 1 : score(result.checks),
    });

    return result;
  }

  // -- Written challenges ---------------------------------------------------

  async submitWritten(
    userId: string,
    attemptId: string,
    text: string,
  ): Promise<WrittenReviewResult> {
    const attempt = await this.requireOpenAttempt(userId, attemptId);
    const { row, spec } = await this.load(attempt.exerciseId);

    if (spec.kind === 'TERMINAL') throw Problems.notFound('Written challenge');
    if (!this.ai) throw Problems.aiUnavailable();

    const review =
      spec.kind === 'SYSTEM_DESIGN'
        ? await this.reviewDesign(row.title, spec, text)
        : await this.reviewIncident(row.title, spec, text);

    await this.record(userId, attempt, text, review.passed, review.evidence);

    return review.view;
  }

  private async reviewDesign(title: string, spec: SystemDesignSpec, submission: string) {
    const review = await designReviewAgent.run(
      this.ai!,
      {
        title,
        brief: spec.brief,
        constraints: spec.constraints,
        expectedTopics: spec.expectedTopics,
        submission,
      },
      {},
    );

    const blocking = review.gaps.filter(
      (gap) => gap.severity === 'critical' || gap.severity === 'major',
    );

    // Computed from the gaps rather than asked for. See scoreDesign.
    const scores = scoreDesign(review);
    const overall = mean(Object.values(scores));

    return {
      // A design with a critical gap has not passed, whatever it scored.
      // Averaging a critical hole away is how a design review becomes
      // decorative.
      passed: !review.gaps.some((gap) => gap.severity === 'critical') && (overall ?? 0) >= 0.6,
      evidence: {
        problemSolving: overall,
        conceptMastery: scores.architectureThinking,
        explanationAbility: scores.requirementsUnderstanding,
      },
      view: {
        passed: blocking.length === 0,
        scores,
        strengths: review.strengths,
        issues: review.gaps.map((gap) => ({
          severity: gap.severity,
          title: gap.title,
          explanation: gap.explanation,
        })),
        followUpQuestions: review.followUpQuestions,
        summary: review.summary,
        degraded: false,
      } satisfies WrittenReviewResult,
    };
  }

  private async reviewIncident(title: string, spec: IncidentSpec, submission: string) {
    const review = await incidentReviewAgent.run(
      this.ai!,
      {
        title,
        scenario: spec.scenario,
        telemetry: spec.telemetry,
        rootCause: spec.rootCause,
        submission,
      },
      {},
    );

    const scores = {
      diagnosisAccuracy: review.diagnosisAccuracy,
      reasoningQuality: review.reasoningQuality,
      remediationQuality: review.remediationQuality,
      preventionThinking: review.preventionThinking,
    };

    return {
      passed: review.foundRootCause && review.diagnosisAccuracy >= 0.6,
      evidence: {
        // An incident is debugging at system scale, so it is the best
        // evidence this product has for that dimension.
        debuggingAbility: review.diagnosisAccuracy,
        problemSolving: review.reasoningQuality,
        explanationAbility: review.reasoningQuality,
      },
      view: {
        passed: review.foundRootCause,
        scores,
        strengths: [],
        issues: review.misdiagnoses.map((title_) => ({
          severity: 'major',
          title: title_,
          explanation: 'A plausible cause that the evidence does not support.',
        })),
        followUpQuestions: [],
        summary: review.summary,
        // Released only now that they have committed to a diagnosis.
        rootCause: spec.rootCause,
        missedSignals: review.missedSignals,
        degraded: false,
      } satisfies WrittenReviewResult,
    };
  }

  // -- Shared ---------------------------------------------------------------

  /**
   * What the user may see before submitting.
   *
   * The withholding here is the same rule as the assistance ladder: an
   * incident's root cause and a design's expected-topics checklist are the
   * answer, and showing either turns the exercise into reading comprehension.
   */
  private brief(spec: ChallengeSpec): ChallengeView['brief'] {
    switch (spec.kind) {
      case 'SYSTEM_DESIGN':
        return {
          body: spec.brief,
          constraints: spec.constraints,
          sections: spec.sections,
        };

      case 'INCIDENT':
        return {
          body: spec.scenario,
          constraints: [],
          sections: spec.sections,
          telemetry: spec.telemetry,
        };

      case 'TERMINAL': {
        // The registry is the source of truth; anything on the spec is a
        // denormalised copy kept only as a fallback.
        const scenario = findScenario(spec.scenarioSlug);
        const task = scenario?.task ?? spec.task ?? '';
        const checks = scenario?.checks ?? spec.checks ?? [];

        return {
          body: task,
          constraints: [],
          sections: [],
          terminal: {
            task,
            // Goals are shown up front. A terminal task where you cannot see
            // what "done" means is a guessing game, not an exercise.
            goals: checks.map((check) => describeCheck(check)),
          },
        };
      }
    }
  }

  private async load(exerciseId: string) {
    const row = await this.prisma.exercise.findUnique({
      where: { id: exerciseId },
      include: {
        concept: { select: { id: true, name: true, technology: { select: { name: true } } } },
      },
    });

    if (!row || row.archivedAt) throw Problems.notFound('Challenge');

    const spec = parseChallengeSpec(row.challengeSpec);
    if (!spec) throw Problems.notFound('Challenge');

    return { row, spec };
  }

  private async requireOpenAttempt(userId: string, attemptId: string) {
    const attempt = await this.prisma.exerciseAttempt.findUnique({ where: { id: attemptId } });

    if (!attempt || attempt.userId !== userId) throw Problems.notFound('Attempt');
    if (attempt.outcome !== 'IN_PROGRESS') throw Problems.attemptClosed();

    return attempt;
  }

  private async record(
    userId: string,
    attempt: { id: string; exerciseId: string },
    body: string,
    passed: boolean,
    evidence: Record<string, number | null>,
  ): Promise<void> {
    const submission = await this.prisma.codeSubmission.create({
      data: {
        attemptId: attempt.id,
        userId,
        // The "code" of a design challenge is its prose, and of a terminal
        // challenge its command log. Reusing the column keeps one attempt
        // history rather than three.
        code: body,
        language: 'text',
      },
    });

    await this.prisma.exerciseAttempt.update({
      where: { id: attempt.id },
      data: {
        submissionCount: { increment: 1 },
        // A failed attempt stays open: these are meant to be revised, not
        // scored once and closed.
        ...(passed ? { outcome: 'PASSED' as const, completedAt: new Date() } : {}),
      },
    });

    const concept = await this.prisma.exercise.findUnique({
      where: { id: attempt.exerciseId },
      select: { conceptId: true },
    });
    if (!concept) return;

    await this.skills.applyEvidence({
      userId,
      conceptId: concept.conceptId,
      cause: 'EXERCISE_ATTEMPT',
      sourceId: submission.id,
      note: 'Engineering challenge',
      evidence,
    });
  }
}

function mean(values: readonly (number | null)[]): number | null {
  const present = values.filter((value): value is number => value !== null);
  if (present.length === 0) return null;
  return present.reduce((sum, value) => sum + value, 0) / present.length;
}

function score(checks: readonly { passed: boolean }[]): number {
  if (checks.length === 0) return 0;
  return checks.filter((check) => check.passed).length / checks.length;
}
