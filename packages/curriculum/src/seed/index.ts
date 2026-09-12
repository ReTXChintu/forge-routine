import { javascriptCurriculum } from './javascript.js';
import { nodejsCurriculum } from './nodejs.js';
import { seedTechnologySchema, type SeedTechnology, type SeedTechnologyInput } from './types.js';

export * from './types.js';
export { TECHNOLOGY_CATALOGUE } from './catalogue.js';

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
  return CURATED.map((tech) => seedTechnologySchema.parse(tech));
}

export function getCuratedSlugs(): string[] {
  return CURATED.map((t) => t.slug);
}
