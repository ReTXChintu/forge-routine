import { z } from 'zod';

import {
  answerGradeSchema,
  interviewQuestionSchema,
  type AnswerGradeOutput,
  type InterviewQuestionOutput,
} from '../contracts/index.js';
import type { AIProvider, CallContext, PromptSpec } from '../provider/ai-provider.port.js';

import { PROMPT_VERSION } from './policy.js';

/**
 * The interview engine (§15-17, docs/interview-engine.md).
 *
 * The thing that makes this an interview rather than a quiz is that the next
 * question depends on the last answer. A fixed list tests preparation; a
 * reactive interviewer tests understanding, which is the only reason to build
 * one at all.
 */

const INTERVIEWER_SYSTEM = `You are conducting a technical interview with an experienced engineer. Behave like a good interviewer, which means:

- Ask one question at a time and wait. Never stack three questions in one turn.
- React to what they actually said, not to what you planned to ask.
- Push on vagueness. "It handles concurrency" is not an answer; ask how.
- When they are wrong, do not correct them mid-interview. Ask something that lets them find it.
- When they are right and deep, go harder. A candidate who never reaches their limit has not been interviewed.
- No preamble, no praise, no "great question". Ask the question.

You are not teaching. You are finding out what they know.`;

export interface NextQuestionInput {
  mode: 'QUICK' | 'TECHNICAL' | 'CODING' | 'DEBUGGING' | 'SYSTEM_DESIGN' | 'SENIOR';
  targetLevel: 'JUNIOR' | 'MID' | 'SENIOR';
  /** The concept this turn should probe, chosen by the selector. */
  conceptName: string;
  conceptDescription: string;
  commonMistakes: readonly string[];
  /** Everything said so far, oldest first. */
  transcript: readonly { question: string; answer: string; move: string }[];
  /** What the grader decided to do next. */
  move: 'OPEN' | 'DEEPEN' | 'RECOVER' | 'ESCALATE' | 'PIN_DOWN' | 'PIVOT';
  /** How many turns this concept has already had. Caps at 4. */
  depth: number;
}

const MOVE_INSTRUCTION: Record<NextQuestionInput['move'], string> = {
  OPEN: 'Open this area with a question that reveals how deeply they understand it.',
  DEEPEN: 'Their answer was correct but shallow. Push one level down into the mechanism.',
  RECOVER:
    'Their answer was wrong. Ask something simpler in the same area that gives them a way back in. Do not signal that they were wrong.',
  ESCALATE:
    'Their answer was strong. Escalate to something harder, or to a practical scenario where this breaks.',
  PIN_DOWN:
    'Their answer was vague. Demand a concrete example — a specific case, a specific failure, a specific number.',
  PIVOT: 'This area is covered. Move to the next concept cleanly, with no summary of what came before.',
};

export const interviewerAgent = {
  name: 'interviewer' as const,
  promptVersion: PROMPT_VERSION,
  contract: interviewQuestionSchema,

  buildPrompt(input: NextQuestionInput): PromptSpec {
    const transcript =
      input.transcript.length > 0
        ? input.transcript
            .slice(-6)
            .map((turn) => `Q: ${turn.question}\nA: ${turn.answer}`)
            .join('\n\n')
        : '(nothing yet — this is the first question)';

    return {
      model: 'reasoning',
      temperature: 0.5,
      maxTokens: 700,
      messages: [
        { role: 'system', content: INTERVIEWER_SYSTEM },
        {
          role: 'system',
          content: `Mode: ${input.mode}. Target level: ${input.targetLevel}.\n${MOVE_INSTRUCTION[input.move]}`,
        },
        {
          role: 'user',
          content: [
            `Area to probe: ${input.conceptName} — ${input.conceptDescription}`,
            input.commonMistakes.length > 0
              ? `Things people get wrong here:\n${input.commonMistakes.map((m) => `- ${m}`).join('\n')}`
              : '',
            `Turns spent on this area so far: ${input.depth}`,
            `Transcript so far:\n${transcript}`,
          ]
            .filter(Boolean)
            .join('\n\n'),
        },
      ],
    };
  },

  async run(
    provider: AIProvider,
    input: NextQuestionInput,
    context: Omit<CallContext, 'agent' | 'promptVersion'>,
  ): Promise<InterviewQuestionOutput> {
    const result = await provider.structured({
      prompt: interviewerAgent.buildPrompt(input),
      schema: interviewQuestionSchema,
      schemaName: 'InterviewQuestion',
      context: { ...context, agent: 'interviewer', promptVersion: PROMPT_VERSION },
    });

    return result.data;
  },
};

// -- Grading one answer -----------------------------------------------------

export interface GradeAnswerInput {
  question: string;
  answer: string;
  conceptName: string;
  expectedPoints: readonly string[];
  depth: number;
  maxDepth: number;
}

export const answerGraderAgent = {
  name: 'interviewer' as const,
  promptVersion: PROMPT_VERSION,
  contract: answerGradeSchema,

  buildPrompt(input: GradeAnswerInput): PromptSpec {
    return {
      model: 'reasoning',
      temperature: 0.1,
      maxTokens: 800,
      messages: [
        {
          role: 'system',
          content: `Grade one interview answer and decide what the interviewer should do next.

Scoring, all 0-1:
- correctness: is what they said true?
- depth: did they explain the mechanism, or only the behaviour?
- specificity: concrete, or hand-waving?
- confidence: how sure did they sound? Low confidence with a correct answer is worth knowing, and is not the same as being wrong.

Choosing the move:
- DEEPEN when correct but shallow.
- RECOVER when wrong.
- ESCALATE when correct and deep.
- PIN_DOWN when the content might be right but nothing concrete was said.
- PIVOT when the area is covered, or depth has reached the cap.

Be honest. An inflated grade produces an interview report the candidate cannot act on, which is the only thing this is for.`,
        },
        {
          role: 'user',
          content: [
            `Area: ${input.conceptName}`,
            `Question: ${input.question}`,
            `Answer: ${input.answer}`,
            input.expectedPoints.length > 0
              ? `Points a strong answer would touch:\n${input.expectedPoints.map((p) => `- ${p}`).join('\n')}`
              : '',
            `Depth so far: ${input.depth} of a maximum ${input.maxDepth}.`,
          ]
            .filter(Boolean)
            .join('\n\n'),
        },
      ],
    };
  },

  async run(
    provider: AIProvider,
    input: GradeAnswerInput,
    context: Omit<CallContext, 'agent' | 'promptVersion'>,
  ): Promise<AnswerGradeOutput> {
    const result = await provider.structured({
      prompt: answerGraderAgent.buildPrompt(input),
      schema: answerGradeSchema,
      schemaName: 'AnswerGrade',
      context: { ...context, agent: 'interviewer', promptVersion: PROMPT_VERSION },
    });

    // Never go deeper than the cap, whatever the model decided: an interviewer
    // that will not leave one topic is a bad interviewer.
    if (input.depth >= input.maxDepth && result.data.move !== 'PIVOT') {
      return { ...result.data, move: 'PIVOT' };
    }

    return result.data;
  },
};

// -- Final report -----------------------------------------------------------

/**
 * What the debrief agent is asked for — and, just as importantly, what it is
 * not.
 *
 * `correctness`, `depth` and `confidence` are deliberately absent: the
 * per-answer grader already scored those turn by turn against a rubric and a
 * specific question, and a second pass re-scoring the whole transcript at
 * once measurably disagrees with itself. A live run produced `overallScore: 1`
 * beside six weak areas describing a candidate who answered nothing correctly
 * — the prose was right and the number was noise, and the number is what feeds
 * the skill model. So the numbers come from the grades, and this agent is
 * asked only for what a transcript-level read can actually see.
 */
export const interviewReportSchema = z.object({
  problemSolving: z.number().min(0).max(1).nullable(),
  communication: z.number().min(0).max(1).nullable(),
  practicalKnowledge: z.number().min(0).max(1).nullable(),
  architectureThinking: z.number().min(0).max(1).nullable(),
  debugging: z.number().min(0).max(1).nullable(),
  codeQuality: z.number().min(0).max(1).nullable(),
  tradeOffAwareness: z.number().min(0).max(1).nullable(),
  /** Each tied to a moment in the transcript. "You could not explain X." */
  strongAreas: z.array(z.string().min(1).max(300)).max(6),
  weakAreas: z.array(z.string().min(1).max(300)).max(6),
  recommendedTopics: z.array(z.string().min(1).max(120)).max(8),
  summary: z.string().min(1).max(1_200),
});

export type InterviewReportOutput = z.infer<typeof interviewReportSchema>;

export interface ReportInput {
  mode: string;
  targetLevel: string;
  transcript: readonly { question: string; answer: string; conceptName: string }[];
}

export const interviewReportAgent = {
  name: 'interviewer' as const,
  promptVersion: PROMPT_VERSION,
  contract: interviewReportSchema,

  buildPrompt(input: ReportInput): PromptSpec {
    return {
      model: 'reasoning',
      temperature: 0.2,
      maxTokens: 2_500,
      messages: [
        {
          role: 'system',
          content: `Write the interview debrief.

Every score runs 0 to 1, where 0 is "showed none of this" and 1 is "as strong as you would expect from a senior engineer". 0.5 is an average answer. Scores must agree with what you write in weakAreas: a transcript you describe as failing cannot carry high numbers.

- Score only what this interview actually tested. A quick interview reveals nothing about architecture thinking: return null for it rather than guessing a number. A guessed score is worse than no score, because it gets acted on.
- Every strength and weakness must point at a specific moment. "Docker networking is weak" is useless; "could not explain why two containers on different bridge networks cannot reach each other" is something they can go and fix.
- recommendedTopics are things to study next, ordered by what would help most.
- The summary is what you would tell the hiring manager: direct, specific, no hedging.`,
        },
        {
          role: 'user',
          content: [
            `Mode: ${input.mode}. Target level: ${input.targetLevel}.`,
            input.transcript
              .map(
                (turn, index) =>
                  `${index + 1}. [${turn.conceptName}]\nQ: ${turn.question}\nA: ${turn.answer}`,
              )
              .join('\n\n'),
          ].join('\n\n'),
        },
      ],
    };
  },

  async run(
    provider: AIProvider,
    input: ReportInput,
    context: Omit<CallContext, 'agent' | 'promptVersion'>,
  ): Promise<InterviewReportOutput> {
    const result = await provider.structured({
      prompt: interviewReportAgent.buildPrompt(input),
      schema: interviewReportSchema,
      schemaName: 'InterviewReport',
      context: { ...context, agent: 'interviewer', promptVersion: PROMPT_VERSION },
    });

    return result.data;
  },
};
