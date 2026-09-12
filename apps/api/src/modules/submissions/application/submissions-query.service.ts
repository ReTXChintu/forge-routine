import { Injectable } from '@nestjs/common';

import type { CodeEvaluation, ExecutionResult } from '@forgeroutine/shared-types';

import { Problems } from '../../../common/http/problem-details.js';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';

export interface SubmissionDetail {
  id: string;
  code: string;
  language: string;
  createdAt: string;
  execution: ExecutionResult | null;
  evaluation: CodeEvaluation | null;
}

/**
 * Reads kept separate from the submission pipeline: a query has no business
 * sharing a class with a use-case that executes code and mutates the skill model.
 */
@Injectable()
export class SubmissionsQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async findOne(userId: string, id: string): Promise<SubmissionDetail> {
    const row = await this.prisma.codeSubmission.findUnique({
      where: { id },
      include: { execution: true, evaluation: true },
    });

    if (!row || row.userId !== userId) throw Problems.notFound('Submission');

    return {
      id: row.id,
      code: row.code,
      language: row.language,
      createdAt: row.createdAt.toISOString(),
      execution: row.execution
        ? {
            status: row.execution.status as ExecutionResult['status'],
            passed: row.execution.passed,
            testsPassed: row.execution.testsPassed,
            testsTotal: row.execution.testsTotal,
            cases: Array.isArray(row.execution.cases)
              ? (row.execution.cases as unknown as ExecutionResult['cases'])
              : [],
            stdout: row.execution.stdout,
            stderr: row.execution.stderr,
            durationMs: row.execution.durationMs,
            truncated: row.execution.truncated,
          }
        : null,
      evaluation: row.evaluation
        ? {
            overallScore: row.evaluation.overallScore,
            quality: {
              correctness: row.evaluation.correctness,
              readability: row.evaluation.readability,
              architecture: row.evaluation.architecture,
              performance: row.evaluation.performance,
              security: row.evaluation.security,
              errorHandling: row.evaluation.errorHandling,
              edgeCases: row.evaluation.edgeCases,
              idiomatic: row.evaluation.idiomatic,
            },
            strengths: row.evaluation.strengths,
            weaknesses: row.evaluation.weaknesses,
            conceptGaps: row.evaluation.conceptGaps,
            recommendedDifficulty: row.evaluation
              .recommendedDifficulty as CodeEvaluation['recommendedDifficulty'],
            nextAction: row.evaluation.nextAction as CodeEvaluation['nextAction'],
            degraded: row.evaluation.degraded,
          }
        : null,
    };
  }
}
