import { z } from 'zod';

import type { AIProvider, CallContext, PromptSpec } from '../provider/ai-provider.port.js';

import { PROMPT_VERSION } from './policy.js';

/**
 * Generates short conceptual questions for one concept.
 *
 * Two jobs, and both matter:
 *
 *  1. For technologies the sandbox cannot execute — Docker, Linux, SQL — these
 *     are the only practice available. Generating JavaScript coding exercises
 *     for "containers vs virtual machines" produces tests that cannot work;
 *     questions are the honest alternative rather than a broken exercise.
 *  2. They are the source for recall prompts, which feed `recallStrength` and
 *     `retention` — two of the nine skill dimensions that nothing else
 *     currently measures (docs/learning-path.md).
 */

export const conceptQuestionSchema = z.object({
  prompt: z.string().min(10).max(600),
  options: z.array(z.string().min(1).max(300)).min(2).max(5),
  /** Index into `options`. Exactly one option is correct. */
  correctIndex: z.number().int().min(0).max(4),
  /** Shown after answering either way. This is where the learning happens. */
  explanation: z.string().min(10).max(800),
  difficulty: z.number().int().min(1).max(5),
});

export const conceptQuestionSetSchema = z.object({
  questions: z.array(conceptQuestionSchema).min(1).max(6),
});

export type ConceptQuestionOutput = z.infer<typeof conceptQuestionSchema>;
export type ConceptQuestionSetOutput = z.infer<typeof conceptQuestionSetSchema>;

export interface QuestionGenerationInput {
  technologyName: string;
  conceptName: string;
  conceptDescription: string;
  difficulty: number;
  learningObjectives: readonly string[];
  commonMistakes: readonly string[];
  count?: number;
}

export const questionAgent = {
  name: 'curriculum' as const,
  promptVersion: PROMPT_VERSION,
  contract: conceptQuestionSetSchema,

  buildPrompt(input: QuestionGenerationInput): PromptSpec {
    const count = input.count ?? 4;

    return {
      model: 'reasoning',
      temperature: 0.3,
      maxTokens: 2_500,
      messages: [
        {
          role: 'system',
          content: `You write short recall questions for an experienced engineer. They appear between activities and must be answerable in about fifteen seconds.

Rules:
- Test understanding, not memory of trivia. "What port does X default to" is worthless; "why does X fail when Y" is worth asking.
- The wrong options must be plausible — things a competent person might actually believe. An obviously silly option makes the question free, and a free question teaches nothing.
- Exactly one option is correct, and it must be unambiguously correct. If two could be defended, rewrite the question.
- Draw at least one question directly from the listed common mistakes: those are the beliefs worth correcting.
- The explanation says WHY, and is worth reading even when the answer was right.
- No "all of the above", no "none of the above", no trick phrasing.`,
        },
        {
          role: 'user',
          content: [
            `Technology: ${input.technologyName}`,
            `Concept: ${input.conceptName} — ${input.conceptDescription}`,
            `Difficulty: ${input.difficulty}/5`,
            input.learningObjectives.length > 0
              ? `Objectives:\n${input.learningObjectives.map((o) => `- ${o}`).join('\n')}`
              : '',
            input.commonMistakes.length > 0
              ? `Common mistakes:\n${input.commonMistakes.map((m) => `- ${m}`).join('\n')}`
              : '',
            `Write ${count} questions.`,
          ]
            .filter(Boolean)
            .join('\n\n'),
        },
      ],
    };
  },

  async run(
    provider: AIProvider,
    input: QuestionGenerationInput,
    context: Omit<CallContext, 'agent' | 'promptVersion'>,
  ): Promise<ConceptQuestionSetOutput> {
    const result = await provider.structured({
      prompt: questionAgent.buildPrompt(input),
      schema: conceptQuestionSetSchema,
      schemaName: 'ConceptQuestionSet',
      context: { ...context, agent: 'curriculum', promptVersion: PROMPT_VERSION },
    });

    return {
      // A correctIndex past the end of the options list would mark every
      // answer wrong forever, so the question is dropped rather than shipped.
      questions: result.data.questions.filter(
        (q) => q.correctIndex < q.options.length && new Set(q.options).size === q.options.length,
      ),
    };
  },
};
