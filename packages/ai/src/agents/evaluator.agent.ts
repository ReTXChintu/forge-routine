import type { CodeEvaluation, ExecutionResult } from '@forgeroutine/shared-types';

import { codeEvaluationSchema } from '../contracts/index.js';
import type { AIProvider, CallContext, PromptSpec } from '../provider/ai-provider.port.js';

import { PROMPT_VERSION } from './policy.js';

export interface EvaluatorInput {
  conceptName: string;
  exerciseTitle: string;
  requirements: string;
  code: string;
  language: string;
  /**
   * Ground truth from the sandbox. The model is told the results, never asked to
   * predict them — we measure correctness, then ask about quality (see
   * docs/architecture.md, "Request lifecycle").
   */
  execution: ExecutionResult;
  commonMistakes: readonly string[];
}

const SYSTEM = `You are reviewing code written by an experienced engineer who is deliberately rebuilding their ability to write code unaided.

The test results you are given are ground truth, produced by actually executing the code. Do not second-guess them, and do not re-derive whether the code passes.

Your job is the part tests cannot measure: readability, architecture, error handling, edge cases, security, performance, and whether the code is idiomatic.

Rules:
- Be specific. "Could be cleaner" is worthless; name the line and the reason.
- Do not rewrite their code. Describe the problem and let them fix it.
- Score only what you can actually assess from this submission. If a dimension does not apply, return null for it rather than guessing a number.
- Be honest. Inflated scores make the whole product useless to them.`;

export const evaluatorAgent = {
  name: 'evaluator' as const,
  promptVersion: PROMPT_VERSION,
  contract: codeEvaluationSchema,

  buildPrompt(input: EvaluatorInput): PromptSpec {
    const failed = input.execution.cases.filter((c) => !c.passed);

    const testSummary = [
      `Status: ${input.execution.status}`,
      `Passed ${input.execution.testsPassed} of ${input.execution.testsTotal}.`,
      failed.length > 0
        ? `Failing cases:\n${failed
            .map((c) => `- ${c.name}${c.error ? `: ${c.error}` : ''}`)
            .join('\n')}`
        : 'All cases passed.',
    ].join('\n');

    const knownMistakes =
      input.commonMistakes.length > 0
        ? `Known common mistakes for this concept (check whether any apply):\n${input.commonMistakes
            .map((m) => `- ${m}`)
            .join('\n')}`
        : '';

    return {
      // 'fast', not 'reasoning'. The tests have already run: the verdict
      // is decided before the model is asked, and its job is to explain the
      // result rather than reach it. gpt-4o was 17x the price for prose.
      model: 'fast',
      temperature: 0.1,
      maxTokens: 1_200,
      messages: [
        { role: 'system', content: SYSTEM },
        {
          role: 'user',
          content: [
            `Concept: ${input.conceptName}`,
            `Exercise: ${input.exerciseTitle}`,
            `Requirements:\n${input.requirements}`,
            `Execution results (ground truth):\n${testSummary}`,
            knownMistakes,
            `Submitted ${input.language}:\n\`\`\`\n${input.code}\n\`\`\``,
          ]
            .filter(Boolean)
            .join('\n\n'),
        },
      ],
    };
  },

  async run(
    provider: AIProvider,
    input: EvaluatorInput,
    context: Omit<CallContext, 'agent' | 'promptVersion'>,
  ): Promise<CodeEvaluation> {
    const result = await provider.structured({
      prompt: evaluatorAgent.buildPrompt(input),
      schema: codeEvaluationSchema,
      schemaName: 'CodeEvaluation',
      context: { ...context, agent: evaluatorAgent.name, promptVersion: PROMPT_VERSION },
    });

    return {
      ...result.data,
      // Correctness is measured, not opined on. Overriding the model here keeps one
      // source of truth and stops a confident model from contradicting the sandbox.
      quality: {
        ...result.data.quality,
        correctness: correctnessFromExecution(input.execution),
      },
      degraded: false,
    };
  },
};

/**
 * Fallback when AI is unavailable: report execution facts and mark every
 * subjective dimension `unscored`.
 *
 * Returning zeros instead would silently poison the skill model, which is the
 * product's long-term memory and the one thing it cannot rebuild.
 */
export function executionOnlyEvaluation(execution: ExecutionResult): CodeEvaluation {
  const correctness = correctnessFromExecution(execution);

  return {
    overallScore: correctness,
    quality: {
      correctness,
      readability: null,
      architecture: null,
      performance: null,
      security: null,
      errorHandling: null,
      edgeCases: null,
      idiomatic: null,
      diagnosisAccuracy: null,
    },
    strengths: execution.passed ? ['All tests passed.'] : [],
    weaknesses: execution.passed
      ? []
      : execution.cases.filter((c) => !c.passed).map((c) => `Failing: ${c.name}`),
    conceptGaps: [],
    recommendedDifficulty: execution.passed ? 'harder' : 'same',
    nextAction: execution.passed ? 'advance' : 'practice',
    degraded: true,
  };
}

function correctnessFromExecution(execution: ExecutionResult): number {
  if (execution.testsTotal === 0) return execution.passed ? 1 : 0;
  return execution.testsPassed / execution.testsTotal;
}
