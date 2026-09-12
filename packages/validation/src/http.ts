import { z } from 'zod';

import {
  assistanceLevelSchema,
  cuidSchema,
  dailyMinutesSchema,
  hintKindSchema,
  interviewTargetSchema,
  languageSchema,
  learningFrequencySchema,
  primaryGoalSchema,
  prioritySchema,
  slugSchema,
  targetProficiencySchema,
  unitScoreSchema,
} from './primitives.js';

/** Request schemas for every endpoint in docs/api.md. */

// -- Auth -------------------------------------------------------------------

export const registerSchema = z.object({
  email: z.string().email().max(254).toLowerCase().trim(),
  // Single-tenant app, owner-operated: the floor is convenience over strength.
  // Raise this before the product ever has a second user.
  password: z.string().min(6, 'Use at least 6 characters').max(128),
  displayName: z.string().min(1).max(80).trim(),
});

export const loginSchema = z.object({
  email: z.string().email().max(254).toLowerCase().trim(),
  password: z.string().min(1).max(128),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(20).max(512),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;

// -- Preferences -------------------------------------------------------------

export const updatePreferencesSchema = z
  .object({
    dailyMinutes: dailyMinutesSchema,
    adaptiveDifficulty: z.boolean(),
    interviewTarget: interviewTargetSchema,
    primaryGoal: primaryGoalSchema,
    timezone: z.string().min(1).max(64),
  })
  .partial();

export type UpdatePreferencesInput = z.infer<typeof updatePreferencesSchema>;

// -- Technologies ------------------------------------------------------------

export const addTechnologySchema = z
  .object({
    /** Either an existing catalogue id, or a name to create a new technology from. */
    technologyId: cuidSchema.optional(),
    name: z.string().min(1).max(60).trim().optional(),
    priority: prioritySchema.default('NORMAL'),
    targetProficiency: targetProficiencySchema.default('WORKING'),
    interviewImportance: z.number().int().min(0).max(5).default(3),
    frequency: learningFrequencySchema.default('FREQUENT'),
    existingKnowledge: unitScoreSchema.nullable().default(null),
  })
  .refine((v) => Boolean(v.technologyId ?? v.name), {
    message: 'Provide either technologyId or name',
    path: ['technologyId'],
  });

export const updateUserTechnologySchema = z
  .object({
    priority: prioritySchema,
    targetProficiency: targetProficiencySchema,
    interviewImportance: z.number().int().min(0).max(5),
    frequency: learningFrequencySchema,
  })
  .partial();

export type AddTechnologyInput = z.infer<typeof addTechnologySchema>;
export type UpdateUserTechnologyInput = z.infer<typeof updateUserTechnologySchema>;

// -- Concepts ----------------------------------------------------------------

export const listConceptsSchema = z.object({
  technologyId: cuidSchema.optional(),
  technologySlug: slugSchema.optional(),
});

// -- Sessions ----------------------------------------------------------------

export const startSessionSchema = z.object({
  conceptId: cuidSchema.optional(),
  routineItemId: cuidSchema.optional(),
});

// -- Exercises and attempts --------------------------------------------------

export const listExercisesSchema = z.object({
  conceptId: cuidSchema.optional(),
  kind: z.enum(['CODING', 'RECALL', 'DEBUGGING', 'BLIND_CODING']).optional(),
});

export const startAttemptSchema = z.object({
  sessionId: cuidSchema.optional(),
  /** Opting into Blind Coding (§12): no AI, no solution, evaluation only after submit. */
  blindMode: z.boolean().default(false),
  /** Explicit override; otherwise the user's earned level for the concept is used. */
  assistanceLevel: assistanceLevelSchema.optional(),
});

export type StartAttemptInput = z.infer<typeof startAttemptSchema>;

// -- Submissions -------------------------------------------------------------

export const clientSignalsSchema = z.object({
  keystrokeCount: z.number().int().min(0).max(1_000_000).optional(),
  largePasteEvents: z.number().int().min(0).max(10_000).optional(),
  firstCodeAtMs: z.number().int().min(0).optional(),
});

export const submitCodeSchema = z.object({
  attemptId: cuidSchema,
  // 64 KB. Submissions are text; anything larger is a mistake or an attack.
  code: z.string().min(1).max(65_536),
  language: languageSchema,
  /**
   * DEBUGGING exercises (§13): what the user believes is wrong, written before
   * they see whether their fix passes. Graded separately from the fix.
   */
  diagnosis: z.string().max(4_000).optional(),
  clientSignals: clientSignalsSchema.optional(),
});

export type SubmitCodeInput = z.infer<typeof submitCodeSchema>;

// -- AI assistance -----------------------------------------------------------

export const hintRequestSchema = z.object({
  attemptId: cuidSchema,
  kind: hintKindSchema,
  code: z.string().max(65_536).optional(),
  lastError: z.string().max(4_000).optional(),
  overrideGate: z.boolean().default(false),
});

export const explainConceptSchema = z.object({
  conceptId: cuidSchema,
  question: z.string().min(1).max(2_000).optional(),
});

export const reviewCodeSchema = z.object({
  submissionId: cuidSchema,
});

export type HintRequestInput = z.infer<typeof hintRequestSchema>;

// -- Routine -----------------------------------------------------------------

export const generateRoutineSchema = z.object({
  minutes: dailyMinutesSchema.optional(),
  date: z.string().date().optional(),
  force: z.boolean().default(false),
});

export const updateRoutineItemSchema = z.object({
  status: z.enum(['IN_PROGRESS', 'DONE', 'SKIPPED']),
});
