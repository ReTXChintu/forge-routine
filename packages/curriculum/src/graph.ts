import type { PrerequisiteStrength, UnitScore } from '@forgeroutine/shared-types';
import { unit } from '@forgeroutine/utils';

/**
 * Knowledge-graph algorithms (docs/knowledge-graph.md).
 *
 * Pure functions over an adjacency description. Nothing here touches the database —
 * the caller loads edges once and the traversals run in memory, which is what makes
 * the routine planner fast enough to run on every request.
 */

export interface GraphEdge {
  conceptId: string;
  prerequisiteId: string;
  strength: PrerequisiteStrength;
}

export interface GraphNode {
  id: string;
  name: string;
  technologyId: string;
}

export class KnowledgeGraph {
  /** conceptId -> its prerequisites */
  private readonly prerequisites = new Map<string, GraphEdge[]>();
  /** prerequisiteId -> concepts that depend on it */
  private readonly dependents = new Map<string, GraphEdge[]>();
  private readonly nodes = new Map<string, GraphNode>();

  constructor(nodes: readonly GraphNode[], edges: readonly GraphEdge[]) {
    for (const node of nodes) this.nodes.set(node.id, node);

    for (const edge of edges) {
      if (edge.conceptId === edge.prerequisiteId) {
        throw new GraphCycleError([edge.conceptId], 'A concept cannot be its own prerequisite');
      }
      pushInto(this.prerequisites, edge.conceptId, edge);
      pushInto(this.dependents, edge.prerequisiteId, edge);
    }
  }

  node(id: string): GraphNode | undefined {
    return this.nodes.get(id);
  }

  directPrerequisites(conceptId: string): GraphEdge[] {
    return this.prerequisites.get(conceptId) ?? [];
  }

  directDependents(conceptId: string): GraphEdge[] {
    return this.dependents.get(conceptId) ?? [];
  }

  /**
   * Transitive prerequisites, breadth-first so that `depth` is the *shortest*
   * distance. Nearest-first ordering matters: a single bad Streams attempt must
   * not send the user back to "Variables".
   */
  transitivePrerequisites(
    conceptId: string,
    maxDepth = MAX_TRACE_DEPTH,
  ): { conceptId: string; depth: number; strength: PrerequisiteStrength }[] {
    const seen = new Set<string>([conceptId]);
    const out: { conceptId: string; depth: number; strength: PrerequisiteStrength }[] = [];
    let frontier: { id: string; strength: PrerequisiteStrength }[] = [
      { id: conceptId, strength: 'HARD' },
    ];

    for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth += 1) {
      const next: { id: string; strength: PrerequisiteStrength }[] = [];

      for (const current of frontier) {
        for (const edge of this.directPrerequisites(current.id)) {
          if (seen.has(edge.prerequisiteId)) continue;
          seen.add(edge.prerequisiteId);

          // A path is only as strong as its weakest link: reaching a prerequisite
          // through a SOFT edge makes the whole dependency soft.
          const strength: PrerequisiteStrength =
            current.strength === 'SOFT' || edge.strength === 'SOFT' ? 'SOFT' : 'HARD';

          out.push({ conceptId: edge.prerequisiteId, depth, strength });
          next.push({ id: edge.prerequisiteId, strength });
        }
      }

      frontier = next;
    }

    return out;
  }

  /** Concepts with no unmet prerequisites, in dependency order. */
  topologicalOrder(): string[] {
    const inDegree = new Map<string, number>();
    for (const id of this.nodes.keys()) {
      inDegree.set(id, this.directPrerequisites(id).length);
    }

    const queue = [...inDegree.entries()].filter(([, d]) => d === 0).map(([id]) => id);
    const order: string[] = [];

    while (queue.length > 0) {
      const id = queue.shift() as string;
      order.push(id);
      for (const edge of this.directDependents(id)) {
        const remaining = (inDegree.get(edge.conceptId) ?? 1) - 1;
        inDegree.set(edge.conceptId, remaining);
        if (remaining === 0) queue.push(edge.conceptId);
      }
    }

    if (order.length !== this.nodes.size) {
      const stuck = [...inDegree.entries()].filter(([, d]) => d > 0).map(([id]) => id);
      throw new GraphCycleError(stuck, 'Prerequisite graph contains a cycle');
    }

    return order;
  }
}

export const MAX_TRACE_DEPTH = 3;

/** Minimum mastery of a HARD prerequisite before a concept unlocks. */
export const UNLOCK_THRESHOLD = 0.6;

/** Below this on any measured dimension a prerequisite counts as weak. */
export const WEAKNESS_THRESHOLD = 0.5;

export class GraphCycleError extends Error {
  constructor(
    public readonly conceptIds: string[],
    message: string,
  ) {
    super(`${message}: ${conceptIds.join(', ')}`);
    this.name = 'GraphCycleError';
  }
}

/**
 * Reject a batch of edges that would introduce a cycle.
 * Called whenever curriculum is generated or imported — a cycle would make the
 * routine planner non-terminating, so it must never reach the database.
 */
export function assertAcyclic(nodes: readonly GraphNode[], edges: readonly GraphEdge[]): void {
  new KnowledgeGraph(nodes, edges).topologicalOrder();
}

// -- Weakness tracing -------------------------------------------------------

export interface SkillLookup {
  (conceptId: string): { conceptMastery: UnitScore; codingAbility: UnitScore } | undefined;
}

export interface WeakPrerequisite {
  conceptId: string;
  depth: number;
  strength: PrerequisiteStrength;
  /** How far below the threshold the weakest measured dimension sits. */
  deficit: number;
}

export type RootCauseTrace =
  | { cause: 'CONCEPT_ITSELF'; targetConceptId: string; weak: [] }
  | { cause: 'PREREQUISITE_GAP'; targetConceptId: string; weak: WeakPrerequisite[] };

/**
 * When the user struggles with a concept, ask *why* rather than simply scheduling
 * more of the same. Returns unmet prerequisites nearest-first.
 */
export function traceRootCause(
  graph: KnowledgeGraph,
  conceptId: string,
  skillOf: SkillLookup,
  options: { maxDepth?: number; threshold?: number } = {},
): RootCauseTrace {
  const maxDepth = options.maxDepth ?? MAX_TRACE_DEPTH;
  const threshold = options.threshold ?? WEAKNESS_THRESHOLD;

  const weak: WeakPrerequisite[] = [];

  for (const prereq of graph.transitivePrerequisites(conceptId, maxDepth)) {
    const skill = skillOf(prereq.conceptId);
    // An unpractised prerequisite is treated as a full gap — no evidence of
    // competence is not the same as competence.
    const mastery = skill?.conceptMastery ?? 0;
    const coding = skill?.codingAbility ?? 0;
    const worst = Math.min(mastery, coding);

    if (worst < threshold) {
      weak.push({
        conceptId: prereq.conceptId,
        depth: prereq.depth,
        strength: prereq.strength,
        deficit: unit(threshold - worst),
      });
    }
  }

  if (weak.length === 0) {
    return { cause: 'CONCEPT_ITSELF', targetConceptId: conceptId, weak: [] };
  }

  // Nearest first; HARD before SOFT at equal depth; larger deficit first after that.
  weak.sort(
    (a, b) =>
      a.depth - b.depth ||
      (a.strength === b.strength ? 0 : a.strength === 'HARD' ? -1 : 1) ||
      b.deficit - a.deficit,
  );

  return { cause: 'PREREQUISITE_GAP', targetConceptId: conceptId, weak };
}

// -- Readiness --------------------------------------------------------------

export interface Readiness {
  conceptId: string;
  unlocked: boolean;
  score: UnitScore;
  blockingConceptIds: string[];
  /** Soft prerequisites that are weak. Advisory: these never block. */
  advisoryConceptIds: string[];
}

/**
 * A concept unlocks when every HARD prerequisite reaches UNLOCK_THRESHOLD mastery.
 * Soft prerequisites influence ordering and produce advice, but never gate access —
 * blocking on "it would help to know Linux pipes" would be infuriating and wrong.
 */
export function computeReadiness(
  graph: KnowledgeGraph,
  conceptId: string,
  skillOf: SkillLookup,
  threshold = UNLOCK_THRESHOLD,
): Readiness {
  const direct = graph.directPrerequisites(conceptId);
  const hard = direct.filter((e) => e.strength === 'HARD');
  const soft = direct.filter((e) => e.strength === 'SOFT');

  const blocking: string[] = [];
  const ratios: number[] = [];

  for (const edge of hard) {
    const mastery = skillOf(edge.prerequisiteId)?.conceptMastery ?? 0;
    ratios.push(unit(mastery / threshold));
    if (mastery < threshold) blocking.push(edge.prerequisiteId);
  }

  const advisory = soft
    .filter((e) => (skillOf(e.prerequisiteId)?.conceptMastery ?? 0) < threshold)
    .map((e) => e.prerequisiteId);

  return {
    conceptId,
    unlocked: blocking.length === 0,
    score: ratios.length === 0 ? 1 : Math.min(...ratios),
    blockingConceptIds: blocking,
    advisoryConceptIds: advisory,
  };
}

function pushInto<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const existing = map.get(key);
  if (existing) existing.push(value);
  else map.set(key, [value]);
}
