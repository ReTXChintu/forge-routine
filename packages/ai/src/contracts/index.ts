import { z } from 'zod';

/**
 * Structured output contracts (§28).
 *
 * Business logic never parses prose. Every agent that feeds a decision returns one
 * of these shapes, validated before it reaches the domain (§45.7).
 *
 * Note the deliberate use of `.nullable()` rather than optional-with-default on
 * score fields: a dimension the model could not assess must come back as `null`
 * (unscored), never as 0. Writing a zero would corrupt the skill model.
 */

const score01 = z.number().min(0).max(1);
const shortList = z.array(z.string().min(1).max(300)).max(8);

// -- Evaluator ---------------------------------------------------------------

export const codeEvaluationSchema = z.object({
  overallScore: score01.nullable(),
  quality: z.object({
    correctness: score01.nullable(),
    readability: score01.nullable(),
    architecture: score01.nullable(),
    performance: score01.nullable(),
    security: score01.nullable(),
    errorHandling: score01.nullable(),
    edgeCases: score01.nullable(),
    idiomatic: score01.nullable(),
    /** DEBUGGING only; null for every other exercise kind. */
    diagnosisAccuracy: score01.nullable(),
  }),
  strengths: shortList,
  weaknesses: shortList,
  /** Concept slugs the submission suggests are missing. Drives the routine engine. */
  conceptGaps: z.array(z.string().min(1).max(64)).max(6),
  recommendedDifficulty: z.enum(['easier', 'same', 'harder']),
  nextAction: z.enum(['practice', 'advance', 'review-prerequisite', 'rest']),
});

export type CodeEvaluationOutput = z.infer<typeof codeEvaluationSchema>;

// -- Tutor -------------------------------------------------------------------

export const tutorResponseSchema = z.object({
  /** What the user reads. Prose is allowed here, but the envelope is structured. */
  message: z.string().min(1).max(2_000),
  /**
   * Self-reported by the model and independently verified by the policy guard.
   * A true value below SHOW_SOLUTION is a prompt regression, not a user problem.
   */
  containsCode: z.boolean(),
  /** The single question the tutor is asking, when it is asking one. */
  question: z.string().max(500).nullable(),
  conceptReferenced: z.string().max(64).nullable(),
});

export type TutorResponseOutput = z.infer<typeof tutorResponseSchema>;

// -- Curriculum --------------------------------------------------------------

export const conceptOutlineSchema = z.object({
  concepts: z
    .array(
      z.object({
        slug: z
          .string()
          .min(1)
          .max(64)
          .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
        name: z.string().min(1).max(120),
        description: z.string().min(1).max(600),
        difficulty: z.number().int().min(1).max(5),
      }),
    )
    .min(4)
    .max(40),
});

export const conceptDetailSchema = z.object({
  learningObjectives: z.array(z.string().min(1).max(300)).min(1).max(8),
  codingPatterns: z.array(z.string().min(1).max(200)).max(8),
  commonMistakes: z.array(z.string().min(1).max(300)).min(1).max(8),
});

export const prerequisiteProposalSchema = z.object({
  edges: z
    .array(
      z.object({
        conceptSlug: z.string().min(1).max(96),
        /** `slug` within this technology, or `tech:slug` to cross a boundary. */
        prerequisiteSlug: z.string().min(1).max(96),
        strength: z.enum(['HARD', 'SOFT']),
        reason: z.string().max(300),
      }),
    )
    .max(200),
});

export type ConceptOutlineOutput = z.infer<typeof conceptOutlineSchema>;
export type ConceptDetailOutput = z.infer<typeof conceptDetailSchema>;
export type PrerequisiteProposalOutput = z.infer<typeof prerequisiteProposalSchema>;

// -- Reviewer ----------------------------------------------------------------

export const codeReviewSchema = z.object({
  summary: z.string().min(1).max(500),
  issues: z
    .array(
      z.object({
        severity: z.enum(['critical', 'major', 'minor', 'nit']),
        category: z.enum([
          'correctness',
          'readability',
          'architecture',
          'performance',
          'security',
          'error-handling',
          'testing',
          'maintainability',
          'idiomatic',
        ]),
        title: z.string().min(1).max(160),
        /** Explains the problem. Must NOT contain the corrected code (§31). */
        explanation: z.string().min(1).max(1_200),
        line: z.number().int().min(1).nullable(),
      }),
    )
    .max(12),
});

export type CodeReviewOutput = z.infer<typeof codeReviewSchema>;

// -- Interviewer -------------------------------------------------------------

export const answerGradeSchema = z.object({
  correctness: score01,
  depth: score01,
  specificity: score01,
  confidence: score01,
  move: z.enum(['DEEPEN', 'RECOVER', 'ESCALATE', 'PIN_DOWN', 'PIVOT']),
  reasoning: z.string().max(600),
});

export const interviewQuestionSchema = z.object({
  prompt: z.string().min(1).max(1_200),
  conceptSlug: z.string().max(96).nullable(),
  expectedPoints: shortList,
});

export type AnswerGradeOutput = z.infer<typeof answerGradeSchema>;
export type InterviewQuestionOutput = z.infer<typeof interviewQuestionSchema>;

// -- Planner -----------------------------------------------------------------

export const routinePlanSchema = z.object({
  items: z
    .array(
      z.object({
        kind: z.enum([
          'LEARN',
          'RECALL',
          'CODE',
          'BLIND_CODE',
          'DEBUG',
          'EXPLAIN',
          'REVIEW',
          'INTERVIEW',
        ]),
        minutes: z.number().int().min(5).max(120),
        conceptSlug: z.string().max(96).nullable(),
        title: z.string().min(1).max(160),
        /** Shown to the user. An opaque routine is not a trusted routine. */
        rationale: z.string().min(1).max(300),
      }),
    )
    .min(1)
    .max(10),
});

export type RoutinePlanOutput = z.infer<typeof routinePlanSchema>;
