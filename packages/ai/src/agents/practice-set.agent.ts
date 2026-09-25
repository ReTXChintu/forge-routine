import { z } from 'zod';

import type { AIProvider, CallContext, PromptSpec } from '../provider/ai-provider.port.js';

import { PROMPT_VERSION } from './policy.js';

/**
 * A set of questions on one concept, of two kinds that fail differently.
 *
 * Multiple choice is cheap and catches a missing distinction: shown four
 * plausible answers, someone who has half the idea picks the wrong one.
 * What it cannot catch is the far more common failure — recognising an
 * idea fluently while being unable to state it — because the options do
 * the remembering for you. That is what the written questions are for, and
 * why both kinds are generated together rather than either being enough.
 *
 * Generated **once per concept and shared by everyone**, like the
 * explainer. A question about closures does not depend on who is answering
 * it, and paying per reader for the same ten questions would multiply the
 * bill by the user count for nothing. What is per-user is the answering.
 *
 * Coding is not generated here. The curriculum already ships exercises
 * with real test cases, and a model-invented coding question with no
 * harness to run it against is a question nobody can grade.
 *
 * Not `questionAgent`, which writes multiple choice during bulk curriculum
 * generation. That one runs once per concept while a whole technology is
 * being built, for whatever the author may never open. This runs when
 * someone has opened one concept and wants to be tested on it now, and it
 * writes both kinds in a single call so the written questions can probe
 * what the multiple choice left covered.
 */

const mcqSchema = z.object({
  prompt: z.string().min(1).max(600),
  /** Three or four. Two is a coin toss; five is a reading exercise. */
  options: z.array(z.string().min(1).max(300)).min(3).max(4),
  correctIndex: z.number().int().min(0).max(3),
  /** Shown after answering, right or wrong. This is where the learning is. */
  explanation: z.string().min(1).max(800),
  difficulty: z.number().int().min(1).max(5),
});

const theorySchema = z.object({
  prompt: z.string().min(1).max(600),
  /** What a good answer says. Withheld until theirs is in. */
  modelAnswer: z.string().min(1).max(2_000),
  /** The points a complete answer covers, so self-marking is a checklist. */
  keyPoints: z.array(z.string().min(1).max(300)).min(2).max(5),
  difficulty: z.number().int().min(1).max(5),
});

export const practiceSetSchema = z.object({
  mcqs: z.array(mcqSchema).max(8),
  theory: z.array(theorySchema).max(5),
});

/**
 * Bumped when the prompt below changes in a way that should reach sets
 * already written. Without it, an improvement only ever reaches concepts
 * nobody has practised yet.
 */
export const PRACTICE_SET_VERSION = 'v1';

export type PracticeSetOutput = z.infer<typeof practiceSetSchema>;

export interface PracticeSetInput {
  technologyName: string;
  conceptName: string;
  conceptDescription: string;
  difficulty: number;
  learningObjectives: readonly string[];
  commonMistakes: readonly string[];
  /** Null for technologies that cannot be practised by running code. */
  language: string | null;
  /** Questions the concept already ships, so the set does not repeat them. */
  existingPrompts: readonly string[];
  /** How many of each to write. The caller tops up rather than duplicating. */
  wantMcqs: number;
  wantTheory: number;
}

const SYSTEM = `You are setting questions that check whether someone has actually understood one concept, not whether they have read about it.

Write two kinds.

Multiple choice. Each question turns on one real distinction — the thing people get wrong, not a definition they could match by keyword. Every wrong option must be something a half-informed person would genuinely pick: an answer that was true in an older version, a rule applied one step too far, a neighbouring concept. Never pad with an option that is obviously silly, and never make the correct answer the longest or the most hedged one. Vary which position is correct.

Written questions. These ask them to explain, compare, or predict in their own words — "why does X happen", "what breaks if you do Y", "when would you reach for A over B". Ask for reasoning, never for recitation: a question answered by naming a thing teaches nothing. Keep each one answerable in a few sentences.

For each written question also write the model answer and its key points. The model answer is what a strong answer says, in plain prose. The key points are the separate things a complete answer must cover, each phrased so the person can look at what they wrote and tell honestly whether it is there. Two to five of them, no overlap.

Explanations for multiple choice say why the right answer is right AND why the tempting wrong one is wrong. That second half is the whole value.

Spread the difficulty. Start where someone who has just read the page can succeed, and end somewhere that separates understanding from familiarity.

Do not ask about anything outside this concept. Do not write questions whose answer is a fact about the documentation rather than about the idea.`;

export const practiceSetAgent = {
  name: 'practice-set' as const,
  promptVersion: PROMPT_VERSION,
  contract: practiceSetSchema,

  buildPrompt(input: PracticeSetInput): PromptSpec {
    const notes = [
      `Technology: ${input.technologyName}`,
      `Concept: ${input.conceptName}`,
      `Description: ${input.conceptDescription}`,
      `Difficulty: ${input.difficulty}/5`,
      `Write ${input.wantMcqs} multiple choice questions and ${input.wantTheory} written questions.`,
    ];

    if (input.learningObjectives.length > 0) {
      notes.push(
        `They should come away able to:\n${input.learningObjectives
          .map((objective) => `- ${objective}`)
          .join('\n')}`,
      );
    }

    if (input.commonMistakes.length > 0) {
      // The curriculum's own list, and the source of the debugging
      // exercises too — so the questions and the practice are about the
      // same failures rather than each inventing their own.
      notes.push(
        `Known mistakes on this concept. Build the tempting wrong options out of these:\n${input.commonMistakes
          .map((mistake) => `- ${mistake}`)
          .join('\n')}`,
      );
    }

    if (input.existingPrompts.length > 0) {
      notes.push(
        `This concept already has these questions. Do not repeat them or rephrase them:\n${input.existingPrompts
          .map((prompt) => `- ${prompt}`)
          .join('\n')}`,
      );
    }

    if (input.language) {
      notes.push(`Where a question needs code, write it in ${input.language}.`);
    } else {
      notes.push('This concept is not practised by writing code. Keep the questions in prose.');
    }

    return {
      model: 'reasoning',
      temperature: 0.5,
      maxTokens: 4_000,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: notes.join('\n\n') },
      ],
    };
  },

  async run(
    provider: AIProvider,
    input: PracticeSetInput,
    context: Omit<CallContext, 'agent' | 'promptVersion'>,
  ): Promise<PracticeSetOutput> {
    const result = await provider.structured({
      prompt: practiceSetAgent.buildPrompt(input),
      schema: practiceSetSchema,
      schemaName: 'PracticeSet',
      context: { ...context, agent: practiceSetAgent.name, promptVersion: PROMPT_VERSION },
    });

    return {
      // An answer key pointing past the end of the options would mark the
      // right answer wrong, which is worse than having no question. The
      // schema cannot express the relationship, so it is checked here and
      // the bad question is dropped rather than failing the whole set.
      mcqs: result.data.mcqs.filter((mcq) => mcq.correctIndex < mcq.options.length),
      theory: result.data.theory,
    };
  },
};
