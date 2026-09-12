import { z } from 'zod';

import type { AIProvider, CallContext, PromptSpec } from '../provider/ai-provider.port.js';

import { PROMPT_VERSION } from './policy.js';

/**
 * Grades a debugging diagnosis (§13).
 *
 * Diagnosis and repair are graded separately because they are different
 * abilities. A user can fix code by trial and error without ever understanding
 * what was wrong — that passes the tests and teaches nothing, and the skill
 * model must be able to tell the two apart.
 */

export const diagnosisGradeSchema = z.object({
  /** How well the stated cause matches the actual one. */
  accuracy: z.number().min(0).max(1),
  /** True when the user named the real mechanism, not just the symptom. */
  identifiedMechanism: z.boolean(),
  /** Shown to the user. Must not restate the answer if they were wrong. */
  feedback: z.string().min(1).max(800),
});

export type DiagnosisGrade = z.infer<typeof diagnosisGradeSchema>;

export interface DebuggerInput {
  exerciseTitle: string;
  requirements: string;
  brokenCode: string;
  /** The reference explanation. Never shown to the user before they commit. */
  actualCause: string;
  userDiagnosis: string;
}

const SYSTEM = `You are grading an engineer's diagnosis of a bug. They have already read the broken code and written what they believe is wrong.

Grade only the diagnosis, not the fix.

Scoring:
- 1.0  They named the actual mechanism and why it produces the observed behaviour.
- 0.7  Correct mechanism, vague on why.
- 0.4  Correct area, wrong mechanism — they described the symptom, not the cause.
- 0.1  Wrong, but engaged with the code.
- 0.0  Empty, or unrelated to this code.

Describing the symptom is not a diagnosis. "It returns the wrong value" scores low
no matter how true it is.

Feedback rules:
- If they were right, say what they got right in one sentence. Do not pad it.
- If they were wrong, ask one question that moves them toward the real cause.
  Do NOT state the actual cause: they get another attempt, and handing it over
  now removes the only thing this exercise was for.
- Never write code.`;

export const debuggerAgent = {
  name: 'debugger' as const,
  promptVersion: PROMPT_VERSION,
  contract: diagnosisGradeSchema,

  buildPrompt(input: DebuggerInput): PromptSpec {
    return {
      model: 'reasoning',
      temperature: 0.1,
      maxTokens: 600,
      messages: [
        { role: 'system', content: SYSTEM },
        {
          role: 'user',
          content: [
            `Exercise: ${input.exerciseTitle}`,
            `What the code should do:\n${input.requirements}`,
            `The broken code:\n\`\`\`\n${input.brokenCode}\n\`\`\``,
            `The actual cause (reference, never reveal it):\n${input.actualCause}`,
            `Their diagnosis:\n${input.userDiagnosis}`,
          ].join('\n\n'),
        },
      ],
    };
  },

  async run(
    provider: AIProvider,
    input: DebuggerInput,
    context: Omit<CallContext, 'agent' | 'promptVersion'>,
  ): Promise<DiagnosisGrade> {
    const result = await provider.structured({
      prompt: debuggerAgent.buildPrompt(input),
      schema: diagnosisGradeSchema,
      schemaName: 'DiagnosisGrade',
      context: { ...context, agent: debuggerAgent.name, promptVersion: PROMPT_VERSION },
    });

    return result.data;
  },
};

/** How many words before a diagnosis is worth grading at all. */
const MIN_DIAGNOSIS_WORDS = 3;

/**
 * Fallback when AI is unavailable.
 *
 * Returns `accuracy: null` — unscored, not zero. We genuinely cannot tell
 * whether they were right, and guessing would corrupt the skill model.
 */
export function ungradedDiagnosis(userDiagnosis: string): {
  accuracy: number | null;
  feedback: string;
} {
  const trimmed = userDiagnosis.trim();

  if (trimmed.split(/\s+/).filter(Boolean).length < MIN_DIAGNOSIS_WORDS) {
    // This much we can judge without a model.
    return {
      accuracy: 0,
      feedback: 'That is too short to be a diagnosis. What specifically is going wrong, and why?',
    };
  }

  return {
    accuracy: null,
    feedback:
      'Your diagnosis was recorded but could not be graded right now. ' +
      'Compare it against the explanation once your fix passes.',
  };
}
