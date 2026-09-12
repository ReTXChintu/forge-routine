import { debuggingExercisesFor } from './debugging.js';
import { javascriptCurriculum } from './javascript.js';
import { nodejsCurriculum } from './nodejs.js';
import { seedTechnologySchema, type SeedTechnology, type SeedTechnologyInput } from './types.js';

export * from './types.js';
export { TECHNOLOGY_CATALOGUE } from './catalogue.js';
export { DEBUGGING_EXERCISES, debuggingExercisesFor } from './debugging.js';

/**
 * Technologies that ship with a hand-written concept graph. Everything else in the
 * catalogue is generated on first use through the same format, so there is one
 * import path for curated and generated curriculum alike.
 */
const CURATED: SeedTechnologyInput[] = [javascriptCurriculum, nodejsCurriculum];

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
          ...debuggingExercisesFor(tech.slug, concept.slug),
        ],
      })),
    }),
  );
}

export function getCuratedSlugs(): string[] {
  return CURATED.map((t) => t.slug);
}
