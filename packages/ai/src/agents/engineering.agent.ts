import { z } from 'zod';

import type { AIProvider, CallContext, PromptSpec } from '../provider/ai-provider.port.js';

import { PROMPT_VERSION, stripCodeBlocks } from './policy.js';

/**
 * Advanced engineering challenges (§18-19, Phase 9).
 *
 * System design and production incidents are the two things a senior
 * interview always reaches and this product could not previously test at all,
 * because neither can be graded by running code. They are graded by reading
 * prose — which means the grading prompt does most of the work, and the
 * honesty rules that apply everywhere else apply harder here: a design review
 * that hands over the architecture is not a review, it is the answer.
 */

const score01 = z.number().min(0).max(1);

// -- System design -----------------------------------------------------------

/**
 * The seven things a design is judged on.
 *
 * Every gap is tagged with one, which is how the scores are computed.
 */
export const DESIGN_DIMENSIONS = [
  'requirementsUnderstanding',
  'architectureThinking',
  'scalability',
  'dataModelling',
  'failureHandling',
  'tradeOffAwareness',
  'operability',
] as const;

export type DesignDimension = (typeof DESIGN_DIMENSIONS)[number];

/**
 * What the reviewer is asked for — and what it is not.
 *
 * Notice there are no dimension scores here. Asked for them directly, the
 * model returned 1.00 across the board for a design it had just described as
 * having two critical flaws. It is reliably good at the two judgements it is
 * actually asked to make — "did they engage with this at all" and "is this a
 * gap, and how bad" — and reliably bad at turning those into a number. So the
 * numbers are computed from the gaps instead. This is the same correction the
 * interview report needed, for the same reason.
 */
export const designReviewSchema = z.object({
  /**
   * Dimensions the submission actually engaged with.
   *
   * This is what separates "no gaps because it is solid" from "no gaps
   * because they never mentioned it" — which must score null, not full marks.
   */
  addressed: z.array(z.enum(DESIGN_DIMENSIONS)).max(7),
  /** What the design gets right. Specific, or omitted. */
  strengths: z.array(z.string().min(1).max(300)).max(5),
  /** Each one a gap in the design, not a style preference. */
  gaps: z
    .array(
      z.object({
        severity: z.enum(['critical', 'major', 'minor']),
        dimension: z.enum(DESIGN_DIMENSIONS),
        title: z.string().min(1).max(160),
        /** Why it matters, in terms of what breaks. Never the fix. */
        explanation: z.string().min(1).max(800),
      }),
    )
    .max(6),
  /**
   * The questions a real interviewer would ask next. This is the part that
   * teaches: a good follow-up makes the gap obvious without naming it.
   */
  followUpQuestions: z.array(z.string().min(1).max(300)).max(4),
  summary: z.string().min(1).max(1_000),
});

export type DesignReviewOutput = z.infer<typeof designReviewSchema>;

export interface DesignReviewInput {
  title: string;
  brief: string;
  /** Constraints the design had to satisfy — scale, latency, budget. */
  constraints: readonly string[];
  /** What a competent answer would address. Used as a checklist, not a key. */
  expectedTopics: readonly string[];
  submission: string;
}

const DESIGN_SYSTEM = `You are reviewing a system design an experienced engineer has just written under interview conditions.

Grade what is there, not what you would have written. Two designs can both be right.

Rules:
- Do NOT design it for them. Name the gap and say what breaks because of it. They close it. Handing over the architecture removes the entire exercise.
- A gap is something that would fail in production or be challenged in an interview — not a missing diagram, not a naming preference, not "you could also mention".
- Tag every gap with the one dimension it belongs to. The grade is computed from these, so a miscategorised gap penalises the wrong thing.
- "addressed" lists only the dimensions the submission genuinely engaged with. A design that never mentions storage does not get dataModelling, even to say it was weak — that distinction is how the grade tells "unaddressed" apart from "addressed badly".
- Follow-up questions are the teaching. Ask what a good interviewer would ask to expose the gap, without naming the gap.
- Say what is genuinely good, briefly. Padding every review with praise makes praise worthless.
- At most six gaps. A review nobody finishes changes nothing.`;

export const designReviewAgent = {
  name: 'reviewer' as const,
  promptVersion: PROMPT_VERSION,
  contract: designReviewSchema,

  buildPrompt(input: DesignReviewInput): PromptSpec {
    return {
      model: 'reasoning',
      temperature: 0.2,
      maxTokens: 2_500,
      messages: [
        { role: 'system', content: DESIGN_SYSTEM },
        {
          role: 'user',
          content: [
            `Brief: ${input.title}`,
            input.brief,
            input.constraints.length > 0
              ? `Constraints:\n${input.constraints.map((c) => `- ${c}`).join('\n')}`
              : '',
            input.expectedTopics.length > 0
              ? `A competent answer would engage with:\n${input.expectedTopics.map((t) => `- ${t}`).join('\n')}`
              : '',
            `Their design:\n${input.submission}`,
          ]
            .filter(Boolean)
            .join('\n\n'),
        },
      ],
    };
  },

  async run(
    provider: AIProvider,
    input: DesignReviewInput,
    context: Omit<CallContext, 'agent' | 'promptVersion'>,
  ): Promise<DesignReviewOutput> {
    const result = await provider.structured({
      prompt: designReviewAgent.buildPrompt(input),
      schema: designReviewSchema,
      schemaName: 'DesignReview',
      context: { ...context, agent: 'reviewer', promptVersion: PROMPT_VERSION },
    });

    // A review that pastes in the schema or the config defeats the exercise.
    // Stripped rather than the review discarded: the prose around it is still
    // worth reading, and this mirrors the code reviewer's guard exactly.
    return {
      ...result.data,
      gaps: result.data.gaps.map((gap) => ({
        ...gap,
        explanation: stripCodeBlocks(gap.explanation).text,
      })),
    };
  },
};

/** How much each severity costs the dimension it was tagged against. */
const SEVERITY_PENALTY: Record<'critical' | 'major' | 'minor', number> = {
  critical: 0.6,
  major: 0.35,
  minor: 0.1,
};

/**
 * Turns a review into per-dimension scores.
 *
 * A dimension the submission never engaged with scores `null`, not zero:
 * null means untested, and a zero would tell the user they are bad at
 * something they were never asked about.
 */
export function scoreDesign(
  review: Pick<DesignReviewOutput, 'addressed' | 'gaps'>,
): Record<DesignDimension, number | null> {
  const scores = {} as Record<DesignDimension, number | null>;

  // A gap is itself evidence about its dimension: the reviewer found
  // something concrete to say. Models routinely tag a gap to `scalability`
  // and then leave scalability out of `addressed`, which would throw the
  // penalty away and report the dimension as untested.
  const scored = new Set<DesignDimension>([
    ...review.addressed,
    ...review.gaps.map((gap) => gap.dimension),
  ]);

  for (const dimension of DESIGN_DIMENSIONS) {
    if (!scored.has(dimension)) {
      scores[dimension] = null;
      continue;
    }

    const penalty = review.gaps
      .filter((gap) => gap.dimension === dimension)
      .reduce((sum, gap) => sum + SEVERITY_PENALTY[gap.severity], 0);

    scores[dimension] = Math.max(0, 1 - penalty);
  }

  return scores;
}

// -- Production incidents ----------------------------------------------------

export const incidentReviewSchema = z.object({
  /** Did they identify the actual cause? The single most important number. */
  diagnosisAccuracy: score01,
  /** Did they reason from the evidence, or pattern-match to a guess? */
  reasoningQuality: score01.nullable(),
  /** Did they propose something that would actually stop it? */
  remediationQuality: score01.nullable(),
  /** Did they say how to stop it recurring, not just how to stop it now? */
  preventionThinking: score01.nullable(),
  /** True when they named the cause, whatever else they got wrong. */
  foundRootCause: z.boolean(),
  /** Evidence in the scenario they did not use. Often the whole answer. */
  missedSignals: z.array(z.string().min(1).max(300)).max(5),
  /** Wrong turns worth naming — a plausible-but-false cause they settled on. */
  misdiagnoses: z.array(z.string().min(1).max(300)).max(3),
  summary: z.string().min(1).max(1_000),
});

export type IncidentReviewOutput = z.infer<typeof incidentReviewSchema>;

export interface IncidentReviewInput {
  title: string;
  scenario: string;
  /** Logs, metrics, alerts — everything the user could see. */
  telemetry: string;
  /** The real cause. Never shown to the user before they have submitted. */
  rootCause: string;
  submission: string;
}

const INCIDENT_SYSTEM = `You are the incident commander reading an engineer's write-up of an outage after the fact. You know the real cause; they did not.

Grade the reasoning, not the luck. Someone who guessed the right cause without using the evidence has not demonstrated anything, and someone who reasoned carefully to a wrong conclusion has demonstrated a great deal.

Rules:
- diagnosisAccuracy is about the cause they named. foundRootCause is whether they named the real one at all.
- missedSignals are specific pieces of evidence in the telemetry they did not use. This is usually the most useful part of the review, because in a real incident the signal was always there.
- Do NOT rewrite their investigation or hand them the next step. Say what the evidence showed and let them see what they walked past.
- Be direct. This is a post-incident review, not a performance appraisal.`;

export const incidentReviewAgent = {
  name: 'evaluator' as const,
  promptVersion: PROMPT_VERSION,
  contract: incidentReviewSchema,

  buildPrompt(input: IncidentReviewInput): PromptSpec {
    return {
      model: 'reasoning',
      temperature: 0.15,
      maxTokens: 2_000,
      messages: [
        { role: 'system', content: INCIDENT_SYSTEM },
        {
          role: 'user',
          content: [
            `Incident: ${input.title}`,
            input.scenario,
            `Telemetry they had:\n${input.telemetry}`,
            `The actual cause (they did not know this):\n${input.rootCause}`,
            `Their write-up:\n${input.submission}`,
          ].join('\n\n'),
        },
      ],
    };
  },

  async run(
    provider: AIProvider,
    input: IncidentReviewInput,
    context: Omit<CallContext, 'agent' | 'promptVersion'>,
  ): Promise<IncidentReviewOutput> {
    const result = await provider.structured({
      prompt: incidentReviewAgent.buildPrompt(input),
      schema: incidentReviewSchema,
      schemaName: 'IncidentReview',
      context: { ...context, agent: 'evaluator', promptVersion: PROMPT_VERSION },
    });

    return result.data;
  },
};
