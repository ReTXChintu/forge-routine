import { debuggingExercisesFor } from './debugging.js';
import { dsaCurriculum } from './dsa.js';
import { extraExercisesFor } from './javascript-extra.js';
import { javascriptCurriculum } from './javascript.js';
import { nodejsCurriculum } from './nodejs.js';
import { referenceSolutionFor } from './reference-solutions.js';
import { seedTechnologySchema, type SeedTechnology, type SeedTechnologyInput } from './types.js';

export * from './types.js';
export { TECHNOLOGY_CATALOGUE } from './catalogue.js';
export { dsaCurriculum } from './dsa.js';
export { SEED_CHALLENGES, challengesFor } from './challenges.js';
export type { SeedChallenge, SeedChallengeSpec } from './challenges.js';
export { DEBUGGING_EXERCISES, debuggingExercisesFor } from './debugging.js';
export { EXTRA_EXERCISES, extraExercisesFor } from './javascript-extra.js';
export { REFERENCE_SOLUTIONS, referenceSolutionFor } from './reference-solutions.js';

/**
 * Technologies that ship with a hand-written concept graph. Everything else in the
 * catalogue is generated on first use through the same format, so there is one
 * import path for curated and generated curriculum alike.
 */
// DSA first: it is on every user's plan from day one, so it must exist
// before anyone's first routine is planned.
const CURATED: SeedTechnologyInput[] = [dsaCurriculum, javascriptCurriculum, nodejsCurriculum];

/**
 * Validate at module load rather than at import time in the seed script:
 * a malformed seed should fail the build, not the deployment.
 */
export function getCuratedCurricula(): SeedTechnology[] {
  return CURATED.map((tech) =>
    seedTechnologySchema.parse({
      ...tech,
      // Debugging exercises live in their own file because they are authored
      // against a concept's recorded `commonMistakes` rather than alongside the
      // coding exercises. They are merged here so there is one import path.
      concepts: (tech.concepts ?? []).map((concept) => ({
        ...concept,
        exercises: [
          ...(concept.exercises ?? []),
          ...extraExercisesFor(tech.slug, concept.slug),
          ...debuggingExercisesFor(tech.slug, concept.slug),
        ].map((exercise) => ({
          ...exercise,
          // Attached here rather than inline so the reference solutions stay in
          // one file, where the test that executes all of them can reach them.
          referenceSolution: exercise.referenceSolution ?? referenceSolutionFor(exercise.slug),
        })),
      })),
    }),
  );
}

export function getCuratedSlugs(): string[] {
  return CURATED.map((t) => t.slug);
}
