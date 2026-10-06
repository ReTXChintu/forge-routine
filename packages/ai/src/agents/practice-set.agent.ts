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

Do not ask about anything outside this concept. Do not write questions whose answer is a fact about the documentation rather than about the idea.

When a question shows code, put that code in a fenced block — three backticks, the language, a newline, the code, three backticks — and keep the prose outside the fence. Without the fence the snippet renders as one unbroken line and the reader cannot see the thing they are being asked about. Short identifiers mentioned inside a sentence take single backticks instead.`;

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

// -- Marking a written answer ------------------------------------------------

/**
 * Marks prose against the answer it was meant to give.
 *
 * Not `answerGraderAgent`, which already exists: that one scores an interview
 * reply on four axes to decide the interviewer's next move, and returns no
 * feedback a learner would read. Same two words, unrelated jobs.
 *
 * The written half of practice used to be self-marked: read the model answer,
 * decide whether yours matched. Honest, and weak — the thing a written answer
 * is for is surfacing what you cannot yet put into words, and that is exactly
 * what somebody checking their own work is least able to see.
 *
 * Deliberately the cheap tier. This runs on every written answer, where the
 * set itself is generated once per concept and shared, so it is the highest
 * volume AI call in the product and the one most worth keeping small.
 *
 * Three fields of feedback rather than one blob, because they answer different
 * questions and a reader skims for the one they want: what landed, what was
 * actually wrong, and what would make it better next time.
 */
export const writtenAnswerGradeSchema = z.object({
  /** Out of five. Five bands is as fine as prose can honestly be marked. */
  score: z.number().int().min(0).max(5),
  /** What the answer got right. Empty only when genuinely nothing did. */
  correct: z.array(z.string().min(1).max(400)).max(4),
  /** What is wrong or missing, stated as the mistake rather than the fix. */
  wrong: z.array(z.string().min(1).max(400)).max(4),
  /** What would make it a five. Concrete, not "be more detailed". */
  improve: z.array(z.string().min(1).max(400)).max(3),
});

export type WrittenAnswerGradeOutput = z.infer<typeof writtenAnswerGradeSchema>;

export interface WrittenAnswerGradeInput {
  conceptName: string;
  question: string;
  /** What a good answer says, from the question's own model answer. */
  modelAnswer: string;
  /** The separate points a complete answer covers. */
  keyPoints: readonly string[];
  /** What the user actually wrote. */
  answer: string;
}

const GRADER_SYSTEM = `You are marking one short written answer from somebody learning to program.

Mark what they wrote against the model answer and its key points, out of five:

5 — every key point, and correct. 4 — all the substance, with a small gap or imprecision. 3 — the main idea, missing something that matters. 2 — a relevant fragment, with the central point missed. 1 — on topic but wrong. 0 — empty, or about something else.

Judge understanding, not wording. An answer that reaches the right idea by a different route, or uses different terms, is correct. Do not deduct for brevity if the substance is there, for spelling, or for not using the same vocabulary as the model answer.

In "correct", name what they actually got right, quoting or paraphrasing their own words so they can see you read it. If nothing was right, leave it empty rather than inventing praise.

In "wrong", say what is mistaken or missing and why it matters. Address them directly. Be specific: "you said the closure copies the value, but it holds a reference" tells them something; "incomplete understanding of closures" does not. An answer with nothing wrong gets an empty list — do not manufacture a flaw to look rigorous.

In "improve", say what would make it a five, concretely. "Name what happens to the variable after the loop finishes" is usable; "add more detail" is not. Leave it empty for a five.

Never restate the model answer as feedback. They can already read it.`;

export const writtenAnswerGraderAgent = {
  name: 'written-answer-grader' as const,
  promptVersion: PROMPT_VERSION,
  contract: writtenAnswerGradeSchema,

  buildPrompt(input: WrittenAnswerGradeInput): PromptSpec {
    return {
      // The cheap tier on purpose: the highest-volume call in the product.
      model: 'fast',
      temperature: 0.2,
      maxTokens: 900,
      messages: [
        { role: 'system', content: GRADER_SYSTEM },
        {
          role: 'user',
          content: [
            `Concept: ${input.conceptName}`,
            `Question: ${input.question}`,
            `Model answer: ${input.modelAnswer}`,
            input.keyPoints.length > 0
              ? `Key points a complete answer covers:\n${input.keyPoints
                  .map((point) => `- ${point}`)
                  .join('\n')}`
              : '',
            `Their answer:\n${input.answer}`,
          ]
            .filter(Boolean)
            .join('\n\n'),
        },
      ],
    };
  },

  async run(
    provider: AIProvider,
    input: WrittenAnswerGradeInput,
    context: Omit<CallContext, 'agent' | 'promptVersion'>,
  ): Promise<WrittenAnswerGradeOutput> {
    const result = await provider.structured({
      prompt: writtenAnswerGraderAgent.buildPrompt(input),
      schema: writtenAnswerGradeSchema,
      schemaName: 'AnswerGrade',
      context: { ...context, agent: writtenAnswerGraderAgent.name, promptVersion: PROMPT_VERSION },
    });

    return result.data;
  },
};
