import { Inject, Injectable, Logger } from '@nestjs/common';

import { projectReviewAgent } from '@forgeroutine/ai';
import type { AppConfig } from '@forgeroutine/config';
import { detectPermissionFlag, runInSandbox, type PermissionFlag } from '@forgeroutine/sandbox';

import { Problems } from '../../../common/http/problem-details.js';
import { APP_CONFIG } from '../../../infrastructure/config/config.module.js';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';
import { AI_PROVIDER, type OptionalAIProvider } from '../../ai/ai.tokens.js';
import { SkillsService } from '../../skills/application/skills.service.js';

export interface ProjectStepView {
  index: number;
  title: string;
  requirements: string;
  estimatedMinutes: number;
  status: 'LOCKED' | 'CURRENT' | 'DONE';
  starterCode: string | null;
  visibleTestNames: string[];
}

export interface ProjectView {
  exerciseId: string;
  attemptId: string | null;
  title: string;
  objective: string;
  requirements: string;
  language: string;
  currentStep: number;
  steps: ProjectStepView[];
}

export interface ReviewIssue {
  severity: 'critical' | 'major' | 'minor' | 'nit';
  category: string;
  title: string;
  explanation: string;
  line: number | null;
}

export interface StepSubmissionResult {
  passed: boolean;
  testsPassed: number;
  testsTotal: number;
  cases: { name: string; passed: boolean; error?: string }[];
  review: { summary: string; issues: ReviewIssue[] } | null;
  /** True when this submission advanced the project to the next step. */
  advanced: boolean;
  projectComplete: boolean;
  /** Present when the project is finished but the review found real problems. */
  checkpointFailed: boolean;
}

/**
 * Projects (§14): multi-step work that makes the user compose several concepts.
 *
 * Two rules shape this service:
 *
 *  1. **Steps unlock in order.** Later steps build on the previous step's
 *     solution, so jumping ahead would hand the user code they have not
 *     written.
 *  2. **A checkpoint is honest.** Passing the tests is not the same as passing
 *     the review. A project with critical or major issues sends the user back
 *     with a specific list rather than waving them through.
 */
@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);
  private permissionFlag: PermissionFlag | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly skills: SkillsService,
    @Inject(AI_PROVIDER) private readonly ai: OptionalAIProvider,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async get(userId: string, exerciseId: string): Promise<ProjectView> {
    const exercise = await this.prisma.exercise.findUnique({
      where: { id: exerciseId },
      include: {
        steps: {
          orderBy: { orderIndex: 'asc' },
          include: { testCases: { select: { name: true, hidden: true } } },
        },
      },
    });

    if (!exercise || exercise.kind !== 'PROJECT') throw Problems.notFound('Project');

    const attempt = await this.prisma.exerciseAttempt.findFirst({
      where: { userId, exerciseId, outcome: 'IN_PROGRESS' },
      orderBy: { createdAt: 'desc' },
    });

    const currentStep = attempt?.currentStep ?? 0;

    return {
      exerciseId: exercise.id,
      attemptId: attempt?.id ?? null,
      title: exercise.title,
      objective: exercise.objective,
      requirements: exercise.requirements,
      language: exercise.language,
      currentStep,
      steps: exercise.steps.map((step) => ({
        index: step.orderIndex,
        // A locked step shows only its title: seeing step three's
        // requirements while on step one gives away the shape of the answer.
        title: step.title,
        requirements: step.orderIndex <= currentStep ? step.requirements : '',
        estimatedMinutes: step.estimatedMinutes,
        status:
          step.orderIndex < currentStep
            ? 'DONE'
            : step.orderIndex === currentStep
              ? 'CURRENT'
              : 'LOCKED',
        starterCode: step.orderIndex === currentStep ? step.starterCode : null,
        visibleTestNames:
          step.orderIndex === currentStep
            ? step.testCases.filter((t) => !t.hidden).map((t) => t.name)
            : [],
      })),
    };
  }

  async start(userId: string, exerciseId: string): Promise<ProjectView> {
    const exercise = await this.prisma.exercise.findUnique({ where: { id: exerciseId } });
    if (!exercise || exercise.kind !== 'PROJECT') throw Problems.notFound('Project');

    const existing = await this.prisma.exerciseAttempt.findFirst({
      where: { userId, exerciseId, outcome: 'IN_PROGRESS' },
    });

    // Reuse an open attempt: a refresh must not reset progress through the
    // steps or restart the clock.
    if (!existing) {
      await this.prisma.exerciseAttempt.create({
        data: { userId, exerciseId, assistanceLevel: 3, openedAt: new Date() },
      });
    }

    return this.get(userId, exerciseId);
  }

  async submitStep(userId: string, attemptId: string, code: string): Promise<StepSubmissionResult> {
    const attempt = await this.prisma.exerciseAttempt.findUnique({
      where: { id: attemptId },
      include: {
        exercise: {
          include: {
            steps: { orderBy: { orderIndex: 'asc' }, include: { testCases: true } },
            concept: { select: { name: true } },
          },
        },
      },
    });

    if (!attempt || attempt.userId !== userId) throw Problems.notFound('Attempt');
    if (attempt.outcome !== 'IN_PROGRESS') throw Problems.attemptClosed();

    const step = attempt.exercise.steps[attempt.currentStep];
    if (!step) throw Problems.notFound('Project step');

    // Run this step's tests plus every earlier step's, so a later step cannot
    // be satisfied by breaking something that already worked.
    const testCases = attempt.exercise.steps
      .filter((s) => s.orderIndex <= attempt.currentStep)
      .flatMap((s) =>
        s.testCases.map((t) => ({
          name:
            s.orderIndex < attempt.currentStep ? `[step ${s.orderIndex + 1}] ${t.name}` : t.name,
          hidden: t.hidden,
          code: t.code,
        })),
      );

    this.permissionFlag ??= await detectPermissionFlag();
    const { env } = this.config;

    const execution = await runInSandbox(
      { code, language: attempt.exercise.language as 'javascript' | 'typescript', testCases },
      {
        workDir: env.EXECUTION_WORK_DIR,
        timeoutMs: Math.max(env.EXECUTION_TIMEOUT_MS, 10_000),
        maxMemoryMb: env.EXECUTION_MAX_MEMORY_MB,
        maxOutputBytes: env.EXECUTION_MAX_OUTPUT_BYTES,
        permissionFlag: this.permissionFlag,
      },
    );

    const review = await this.review(attempt.exercise, step, code, execution.passed);

    const submission = await this.persist(userId, attempt.id, code, execution, review);

    const isLastStep = attempt.currentStep === attempt.exercise.steps.length - 1;
    const blocking = (review?.issues ?? []).filter(
      (i) => i.severity === 'critical' || i.severity === 'major',
    );

    // A checkpoint that waves everyone through is not a checkpoint. Tests
    // passing is necessary, not sufficient (§14).
    const checkpointFailed = execution.passed && isLastStep && blocking.length > 0;
    const advanced = execution.passed && !checkpointFailed;

    if (advanced) {
      await this.advance(attempt.id, attempt.currentStep, isLastStep);
      if (isLastStep) await this.recordCompletion(userId, attempt, submission.id, review);
    }

    return {
      passed: execution.passed,
      testsPassed: execution.testsPassed,
      testsTotal: execution.testsTotal,
      cases: execution.cases.map((c) => ({
        name: c.name,
        passed: c.passed,
        ...(c.error ? { error: c.error } : {}),
      })),
      review,
      advanced,
      projectComplete: advanced && isLastStep,
      checkpointFailed,
    };
  }

  // -- Internals ------------------------------------------------------------

  private async review(
    exercise: { title: string; language: string; concept: { name: string } },
    step: { title: string; requirements: string },
    code: string,
    testsPassed: boolean,
  ): Promise<{ summary: string; issues: ReviewIssue[] } | null> {
    if (!this.ai) return null;

    try {
      const result = await projectReviewAgent.run(
        this.ai,
        {
          projectTitle: exercise.title,
          stepTitle: step.title,
          requirements: step.requirements,
          code,
          language: exercise.language,
          testsPassed,
          conceptNames: [exercise.concept.name],
        },
        {},
      );

      return {
        summary: result.summary,
        issues: result.issues.map((issue) => ({
          severity: issue.severity,
          category: issue.category,
          title: issue.title,
          explanation: issue.explanation,
          line: issue.line,
        })),
      };
    } catch (error) {
      // Losing the review must not lose the submission. The user's work is
      // done and the execution result is the part that cannot be recreated.
      this.logger.warn({ err: error }, 'Project review failed');
      return null;
    }
  }

  private async persist(
    userId: string,
    attemptId: string,
    code: string,
    execution: Awaited<ReturnType<typeof runInSandbox>>,
    review: { summary: string; issues: ReviewIssue[] } | null,
  ) {
    return this.prisma.codeSubmission.create({
      data: {
        attemptId,
        userId,
        code,
        language: 'javascript',
        execution: {
          create: {
            status: execution.status,
            passed: execution.passed,
            testsPassed: execution.testsPassed,
            testsTotal: execution.testsTotal,
            cases: execution.cases as unknown as object[],
            stdout: execution.stdout,
            stderr: execution.stderr,
            durationMs: execution.durationMs,
            truncated: execution.truncated,
          },
        },
        evaluation: {
          create: {
            overallScore:
              execution.testsTotal > 0 ? execution.testsPassed / execution.testsTotal : 0,
            correctness:
              execution.testsTotal > 0 ? execution.testsPassed / execution.testsTotal : 0,
            degraded: review === null,
            reviewIssues: (review?.issues ?? []) as unknown as object[],
            strengths: review ? [review.summary] : [],
            weaknesses: (review?.issues ?? []).map((i) => i.title),
            recommendedDifficulty: 'same',
            nextAction: execution.passed ? 'advance' : 'practice',
          },
        },
      },
    });
  }

  private async advance(attemptId: string, currentStep: number, isLastStep: boolean) {
    await this.prisma.exerciseAttempt.update({
      where: { id: attemptId },
      data: {
        currentStep: isLastStep ? currentStep : currentStep + 1,
        submissionCount: { increment: 1 },
        ...(isLastStep ? { outcome: 'PASSED' as const, completedAt: new Date() } : {}),
      },
    });
  }

  private async recordCompletion(
    userId: string,
    attempt: { exercise: { conceptId: string } },
    submissionId: string,
    review: { issues: ReviewIssue[] } | null,
  ) {
    // Projects are the only evidence the skill model gets for composition, so
    // they write the two dimensions isolated exercises cannot reach.
    const issueCount = review?.issues.length ?? 0;
    const quality = Math.max(0, 1 - issueCount * 0.15);

    await this.skills.applyEvidence({
      userId,
      conceptId: attempt.exercise.conceptId,
      cause: 'EXERCISE_ATTEMPT',
      sourceId: submissionId,
      note: 'Project completed',
      evidence: {
        problemSolving: quality,
        codingAbility: quality,
        // Only a reviewed project says anything about architecture.
        conceptMastery: review ? quality : null,
      },
    });
  }
}
