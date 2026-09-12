import { z } from 'zod';

/**
 * Shared primitives. Every external boundary in ForgeRoutine validates through
 * schemas built from these (§45.6) — HTTP bodies, query strings, AI output, and
 * seed data all use the same definitions so the rules cannot drift apart.
 */

export const cuidSchema = z
  .string()
  .min(20)
  .max(40)
  .regex(/^[a-z0-9]+$/i, 'Invalid id');

export const slugSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Must be a lowercase hyphenated slug');

/** Every score in the system lives in [0,1]. Percentages exist only in the UI. */
export const unitScoreSchema = z.number().min(0).max(1);

export const difficultySchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);

export const assistanceLevelSchema = difficultySchema;

export const languageSchema = z.enum(['javascript', 'typescript']);

export const hintKindSchema = z.enum([
  'CONCEPT_REMINDER',
  'SMALL_HINT',
  'HINT',
  'DEBUGGING_QUESTION',
  'EXPLAIN_ERROR',
  'SHOW_APPROACH',
  'SHOW_SOLUTION',
]);

export const skillDimensionSchema = z.enum([
  'conceptMastery',
  'recallStrength',
  'codingAbility',
  'problemSolving',
  'debuggingAbility',
  'explanationAbility',
  'interviewReadiness',
  'confidence',
  'retention',
]);

export const prioritySchema = z.enum(['LOW', 'NORMAL', 'HIGH', 'CRITICAL']);
export const targetProficiencySchema = z.enum(['AWARENESS', 'WORKING', 'PROFICIENT', 'EXPERT']);
export const learningFrequencySchema = z.enum(['DAILY', 'FREQUENT', 'OCCASIONAL', 'RARE']);
export const prerequisiteStrengthSchema = z.enum(['HARD', 'SOFT']);

export const exerciseKindSchema = z.enum([
  'CODING',
  'RECALL',
  'DEBUGGING',
  'BLIND_CODING',
  'EXPLANATION',
  'PROJECT',
]);

export const dailyMinutesSchema = z.union([
  z.literal(30),
  z.literal(45),
  z.literal(60),
  z.literal(90),
  z.literal(120),
]);

export const interviewTargetSchema = z.enum(['JUNIOR', 'MID', 'SENIOR']);

export const primaryGoalSchema = z.enum([
  'CODING',
  'INTERVIEW',
  'JOB_PREPARATION',
  'ENGINEERING_MASTERY',
]);

/** Cursor pagination, shared by every list endpoint. */
export const paginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type PaginationInput = z.infer<typeof paginationSchema>;
