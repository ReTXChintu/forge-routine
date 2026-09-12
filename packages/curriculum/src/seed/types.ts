import { z } from 'zod';

/**
 * Seed data and AI-generated curriculum share one format, so there is one code path
 * for both (docs/curriculum-engine.md). These schemas validate both.
 */

export const seedTestCaseSchema = z.object({
  name: z.string().min(1).max(120),
  hidden: z.boolean().default(false),
  /**
   * JS evaluated inside the sandbox harness. It receives the user's default export
   * as `solution` and must throw on failure.
   */
  code: z.string().min(1).max(8_000),
});

export const seedExerciseSchema = z.object({
  slug: z.string().min(1).max(64),
  title: z.string().min(1).max(160),
  kind: z
    .enum(['CODING', 'RECALL', 'DEBUGGING', 'BLIND_CODING', 'EXPLANATION', 'PROJECT'])
    .default('CODING'),
  difficulty: z.number().int().min(1).max(5).default(3),
  language: z.enum(['javascript', 'typescript']).default('javascript'),
  /** The entire prompt shown at level 4 (Blank). Must stand alone. */
  objective: z.string().min(1).max(500),
  requirements: z.string().default(''),
  functionSignature: z.string().nullable().default(null),
  starterCode: z.string().nullable().default(null),
  examples: z.array(z.string()).default([]),
  staticHints: z.array(z.string()).default([]),
  referenceSolution: z.string().nullable().default(null),
  estimatedMinutes: z.number().int().min(1).max(240).default(15),
  testCases: z.array(seedTestCaseSchema).min(1),
});

export const seedConceptSchema = z.object({
  slug: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  description: z.string().default(''),
  difficulty: z.number().int().min(1).max(5).default(3),
  learningObjectives: z.array(z.string()).default([]),
  codingPatterns: z.array(z.string()).default([]),
  commonMistakes: z.array(z.string()).default([]),
  /** Slugs, resolved to ids at import. `tech:slug` crosses a technology boundary. */
  prerequisites: z
    .array(
      z.object({
        slug: z.string().min(1),
        strength: z.enum(['HARD', 'SOFT']).default('HARD'),
      }),
    )
    .default([]),
  exercises: z.array(seedExerciseSchema).default([]),
});

export const seedTechnologySchema = z.object({
  slug: z.string().min(1).max(64),
  name: z.string().min(1).max(60),
  description: z.string().default(''),
  category: z.string().default('general'),
  concepts: z.array(seedConceptSchema).default([]),
});

export type SeedTestCase = z.infer<typeof seedTestCaseSchema>;
export type SeedExercise = z.infer<typeof seedExerciseSchema>;
export type SeedConcept = z.infer<typeof seedConceptSchema>;
export type SeedTechnology = z.infer<typeof seedTechnologySchema>;

/**
 * Authoring types.
 *
 * `z.infer` gives the *output* type, in which every `.default(...)` field is required.
 * Hand-written seed literals must not have to spell out every default, so they are
 * typed against `z.input` and become fully-populated output types after parsing.
 */
export type SeedTestCaseInput = z.input<typeof seedTestCaseSchema>;
export type SeedExerciseInput = z.input<typeof seedExerciseSchema>;
export type SeedConceptInput = z.input<typeof seedConceptSchema>;
export type SeedTechnologyInput = z.input<typeof seedTechnologySchema>;
