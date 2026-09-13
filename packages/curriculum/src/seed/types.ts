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
  /**
   * DEBUGGING exercises (§13): realistic broken code the user must diagnose.
   * Unlike starterCode this is shown at every assistance level — the bug *is*
   * the problem statement, so withholding it would leave nothing to do.
   */
  brokenCode: z.string().nullable().default(null),
  /** What is actually wrong. Grades the diagnosis; never sent before one arrives. */
  bugExplanation: z.string().nullable().default(null),
  estimatedMinutes: z.number().int().min(1).max(240).default(15),
  testCases: z.array(seedTestCaseSchema).min(1),
});

export const seedQuestionSchema = z
  .object({
    prompt: z.string().min(1).max(600),
    /** Two to five options; exactly one is correct. */
    options: z.array(z.string().min(1).max(300)).min(2).max(5),
    correctIndex: z.number().int().min(0),
    /** Shown after answering, right or wrong. This is where the learning is. */
    explanation: z.string().min(1).max(800),
    difficulty: z.number().int().min(1).max(5).default(3),
  })
  // An out-of-range answer key would mark the right answer wrong, which is
  // worse than having no question at all. Caught at author time.
  .refine((q) => q.correctIndex < q.options.length, {
    message: 'correctIndex must point at one of the options',
    path: ['correctIndex'],
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
  /**
   * Recall questions for this concept.
   *
   * Previously these only ever came from the generator, which made a
   * question-based day impossible without spending money. A curated
   * technology can now ship its own, and the import path is the same one
   * the generator writes through.
   */
  questions: z.array(seedQuestionSchema).default([]),
});

export const seedTechnologySchema = z.object({
  slug: z.string().min(1).max(64),
  name: z.string().min(1).max(60),
  description: z.string().default(''),
  category: z.string().default('general'),
  /**
   * Language the sandbox can execute this technology's exercises in, or null
   * when it cannot be practised by running code. Null technologies get
   * concept questions instead of coding exercises.
   */
  exerciseLanguage: z.enum(['javascript', 'typescript']).nullable().default('javascript'),
  /**
   * Technologies that should be learned first, by slug.
   *
   * Hand-authored rather than inferred. The generator does propose
   * cross-technology prerequisite edges, but those only exist *after* both
   * technologies have been generated — which is too late to decide what to
   * generate first, and pays for the answer to a question we already know.
   * Nobody needs a model to work out that React comes after JavaScript.
   *
   * Used for two things: the order curriculum is generated in, and the order
   * phases appear in the roadmap.
   */
  dependsOn: z.array(z.string().min(1)).default([]),
  /**
   * Where this sits in the intended reading order. Lower comes first.
   *
   * `dependsOn` says what is *forbidden*; this says what is *wanted*. Both
   * are needed, because dependencies alone leave most pairs unordered — a
   * topological sort of them alone scatters the JavaScript chain across the
   * whole list and interleaves it with DevOps, which is a valid order and a
   * bad curriculum.
   *
   * A test proves the two never contradict each other, so this can be
   * reordered freely without quietly breaking a prerequisite.
   */
  learningOrder: z.number().int().min(0).default(500),
  concepts: z.array(seedConceptSchema).default([]),
});

export type SeedQuestion = z.infer<typeof seedQuestionSchema>;
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
export type SeedQuestionInput = z.input<typeof seedQuestionSchema>;
export type SeedTestCaseInput = z.input<typeof seedTestCaseSchema>;
export type SeedExerciseInput = z.input<typeof seedExerciseSchema>;
export type SeedConceptInput = z.input<typeof seedConceptSchema>;
export type SeedTechnologyInput = z.input<typeof seedTechnologySchema>;
