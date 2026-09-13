/**
 * The order technologies should be learned — and therefore generated — in.
 *
 * This exists to stop paying a model to answer a question we already know.
 * The curriculum generator can propose cross-technology prerequisites, but
 * only once both technologies have been generated, which is too late to
 * decide what to build first. React comes after JavaScript whether or not
 * anyone has spent a token establishing it.
 *
 * The order drives two things:
 *
 *   1. **Generation.** Exactly one technology is generated at a time, and it
 *      is the earliest one in this order that the user still needs.
 *   2. **The roadmap.** Phases appear in the same order, so what the user is
 *      told to study matches what has actually been built.
 */

export interface OrderableTechnology {
  technologyId: string;
  slug: string;
  /** Slugs of technologies that should come first. Unknown slugs are ignored. */
  dependsOn: readonly string[];
  /** Higher sorts earlier among technologies that are equally unblocked. */
  weight?: number;
}

/**
 * Topological order, with `weight` then `slug` breaking ties.
 *
 * Kahn's algorithm rather than a plain sort: a comparator cannot express
 * "A before B" and "B before C" consistently when most pairs are unrelated,
 * and the result silently depends on the input order.
 *
 * Dependencies on technologies the user has not chosen are ignored rather
 * than pulled in. Someone who picks React and not TypeScript has made a
 * choice, and quietly adding TypeScript to their plan would override it.
 */
export function orderTechnologies(technologies: readonly OrderableTechnology[]): string[] {
  const present = new Map(technologies.map((technology) => [technology.slug, technology]));

  const blockers = new Map<string, Set<string>>();
  for (const technology of technologies) {
    blockers.set(
      technology.technologyId,
      new Set(technology.dependsOn.filter((slug) => present.has(slug))),
    );
  }

  const byId = new Map(technologies.map((technology) => [technology.technologyId, technology]));
  const remaining = new Set(byId.keys());
  const ordered: string[] = [];
  const satisfied = new Set<string>();

  while (remaining.size > 0) {
    const ready = [...remaining].filter((id) =>
      [...(blockers.get(id) ?? [])].every((slug) => satisfied.has(slug)),
    );

    // A cycle should be impossible — `assertAcyclicTechnologies` runs at seed
    // time — but emitting a partial order would silently drop half the user's
    // choices, which is worse than an imperfect one.
    const candidates = ready.length > 0 ? ready : [...remaining];

    candidates.sort((a, b) => {
      const byWeight = (byId.get(b)?.weight ?? 0) - (byId.get(a)?.weight ?? 0);
      if (byWeight !== 0) return byWeight;
      return (byId.get(a)?.slug ?? '').localeCompare(byId.get(b)?.slug ?? '');
    });

    const next = candidates[0]!;
    ordered.push(next);
    remaining.delete(next);
    satisfied.add(byId.get(next)!.slug);
  }

  return ordered;
}

/**
 * Throws on a dependency cycle.
 *
 * Run at seed time. A cycle here would make some technology permanently
 * ungeneratable — every pass would find it blocked — and the symptom would
 * be a roadmap phase that never fills in, with nothing in the logs.
 */
export function assertAcyclicTechnologies(
  technologies: readonly { slug: string; dependsOn: readonly string[] }[],
): void {
  const bySlug = new Map(technologies.map((technology) => [technology.slug, technology]));
  const visiting = new Set<string>();
  const done = new Set<string>();

  const visit = (slug: string, trail: string[]): void => {
    if (done.has(slug)) return;

    if (visiting.has(slug)) {
      const cycle = [...trail.slice(trail.indexOf(slug)), slug].join(' -> ');
      throw new Error(`Technology dependency cycle: ${cycle}`);
    }

    visiting.add(slug);
    for (const dependency of bySlug.get(slug)?.dependsOn ?? []) {
      // An unknown slug is a typo in the catalogue, not a cycle. Named
      // explicitly, because "react depends on typescrpt" would otherwise
      // just silently stop constraining anything.
      if (!bySlug.has(dependency)) {
        throw new Error(`Technology "${slug}" depends on unknown "${dependency}"`);
      }
      visit(dependency, [...trail, slug]);
    }
    visiting.delete(slug);
    done.add(slug);
  };

  for (const technology of technologies) visit(technology.slug, []);
}

/**
 * The next technology to generate, or null when there is nothing to do.
 *
 * One at a time, and only when it is actually needed. Generating a user's
 * whole selection on sign-up spends money on technologies they may never
 * reach — and spends it at exactly the moment they are least likely to have
 * decided the product is worth it.
 */
export function nextToGenerate(
  technologies: readonly (OrderableTechnology & { hasContent: boolean })[],
): string | null {
  const order = orderTechnologies(technologies);
  const byId = new Map(technologies.map((technology) => [technology.technologyId, technology]));

  for (const id of order) {
    if (!byId.get(id)?.hasContent) return id;
  }

  return null;
}

/**
 * Whether the user is far enough into what they have to justify building the
 * next thing.
 *
 * Generation takes minutes, so waiting until they are actually blocked means
 * they sit and wait. Starting at the first sign of progress means paying for
 * a technology they may abandon after one session. This threshold is the
 * compromise, and it is a guess — the honest kind, tuned by how it feels
 * rather than derived from anything.
 */
export const GENERATE_AHEAD_AT = 0.6;

export function shouldGenerateAhead(input: {
  /** Concepts in technologies that already have content. */
  totalConcepts: number;
  /** How many of those the user has practised at least once. */
  practisedConcepts: number;
}): boolean {
  // Nothing built yet: the first technology is always worth generating,
  // handled by nextToGenerate rather than here.
  if (input.totalConcepts === 0) return true;
  return input.practisedConcepts / input.totalConcepts >= GENERATE_AHEAD_AT;
}
