import type { HintKind } from '@forgeroutine/shared-types';

import { tutorResponseSchema, type TutorResponseOutput } from '../contracts/index.js';
import type { AIProvider, CallContext, PromptSpec } from '../provider/ai-provider.port.js';

import {
  HINT_INSTRUCTIONS,
  NO_CODE_SYSTEM_BLOCK,
  PROMPT_VERSION,
  SOLUTION_SYSTEM_BLOCK,
  enforceNoCode,
} from './policy.js';

export interface TutorInput {
  kind: HintKind;
  conceptName: string;
  exerciseTitle: string;
  exerciseRequirements: string;
  /** Omitted for CONCEPT_REMINDER, which must not look at the user's code. */
  userCode?: string;
  lastError?: string;
  /** What has already been asked this attempt, so the tutor does not repeat itself. */
  priorHints: readonly { kind: HintKind; response: string }[];
}

export interface TutorResult extends TutorResponseOutput {
  /** True when the output guard had to remove code the model produced anyway. */
  redacted: boolean;
  promptVersion: string;
}

export const tutorAgent = {
  name: 'tutor' as const,
  promptVersion: PROMPT_VERSION,
  contract: tutorResponseSchema,

  buildPrompt(input: TutorInput): PromptSpec {
    const isSolution = input.kind === 'SHOW_SOLUTION';
    const systemBlock = isSolution ? SOLUTION_SYSTEM_BLOCK : NO_CODE_SYSTEM_BLOCK;

    const context = [
      `Concept: ${input.conceptName}`,
      `Exercise: ${input.exerciseTitle}`,
      `Requirements:\n${input.exerciseRequirements}`,
    ];

    // CONCEPT_REMINDER must not reference their code, so it is not given it.
    if (input.userCode && input.kind !== 'CONCEPT_REMINDER') {
      context.push(`Their current code:\n${input.userCode}`);
    }
    if (input.lastError) {
      context.push(`Error they are seeing:\n${input.lastError}`);
    }
    if (input.priorHints.length > 0) {
      context.push(
        `Already said this attempt (do not repeat):\n` +
          input.priorHints.map((h) => `- [${h.kind}] ${h.response}`).join('\n'),
      );
    }

    return {
      model: isSolution ? 'reasoning' : 'fast',
      temperature: 0.4,
      maxTokens: isSolution ? 1_500 : 400,
      messages: [
        { role: 'system', content: systemBlock },
        {
          role: 'system',
          content: `Requested assistance level: ${input.kind}\n${HINT_INSTRUCTIONS[input.kind]}`,
        },
        { role: 'user', content: context.join('\n\n') },
      ],
    };
  },

  async run(
    provider: AIProvider,
    input: TutorInput,
    context: Omit<CallContext, 'agent' | 'promptVersion'>,
  ): Promise<TutorResult> {
    const result = await provider.structured({
      prompt: tutorAgent.buildPrompt(input),
      schema: tutorResponseSchema,
      schemaName: 'TutorResponse',
      context: { ...context, agent: tutorAgent.name, promptVersion: PROMPT_VERSION },
    });

    // The model self-reports `containsCode`; we do not trust it. The guard is what
    // actually enforces the policy.
    const guarded = enforceNoCode(input.kind, result.data.message);

    return {
      ...result.data,
      message: guarded.text,
      containsCode: input.kind === 'SHOW_SOLUTION' ? result.data.containsCode : false,
      redacted: guarded.redacted,
      promptVersion: PROMPT_VERSION,
    };
  },
};

/**
 * Fallback when AI is unavailable or over budget (docs/ai-architecture.md).
 * Uses the static per-exercise hints stored with the exercise, so the product
 * stays usable rather than showing an error where help should be.
 */
export function staticHintFallback(
  kind: HintKind,
  staticHints: readonly string[],
  alreadyGiven: number,
): TutorResult {
  const message =
    kind === 'SHOW_SOLUTION'
      ? 'The full solution is unavailable right now. The hints below are still here.'
      : (staticHints[alreadyGiven] ??
        staticHints.at(-1) ??
        'What is the smallest piece of this you could make work first?');

  return {
    message,
    containsCode: false,
    question: message.trimEnd().endsWith('?') ? message : null,
    conceptReferenced: null,
    redacted: false,
    promptVersion: PROMPT_VERSION,
  };
}
