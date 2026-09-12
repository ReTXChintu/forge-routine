import type { Priority, TargetProficiency } from '@forgeroutine/shared-types';

import type { GraphEdge } from './graph.js';

/**
 * The rule-based roadmap builder (docs/learning-path.md).
 *
 * This is not scaffolding for the AI planner — it is the planner's declared
 * fallback (docs/ai-architecture.md). It runs whenever AI is unavailable, over
 * budget, or returns output that fails its contract, so it has to produce a
 * path a person would actually follow.
 *
 * Pure: no database, no network, no clock. Everything it needs is an argument,
 * which is what makes an ordering this opinionated testable at all.
 */

// -- Inputs -----------------------------------------------------------------

export interface RoadmapTechnology {
  technologyId: string;
  slug: string;
  name: string;
  priority: Priority;
  targetProficiency: TargetProficiency;
  /** 0-5. Raises the chance of an interview checkpoint at the end. */
  interviewImportance: number;
}

export interface RoadmapExercise {
  id: string;
  kind: 'CODING' | 'RECALL' | 'DEBUGGING' | 'BLIND_CODING' | 'EXPLANATION' | 'PROJECT';
  difficulty: number;
  estimatedMinutes: number;
}

export interface RoadmapConcept {
  id: string;
  technologyId: string;
  slug: string;
  name: string;
  difficulty: number;
  orderIndex: number;
  exercises: RoadmapExercise[];
}

export interface RoadmapSkill {
  conceptMastery: number;
  codingAbility: number;
}

export interface RoadmapPreferences {
  dailyMinutes: number;
  primaryGoal: 'CODING' | 'INTERVIEW' | 'JOB_PREPARATION' | 'ENGINEERING_MASTERY';
  interviewTarget: 'JUNIOR' | 'MID' | 'SENIOR';
  /** Days until the interview, when there is one. Compresses the path. */
  daysUntilInterview?: number | null;
}

export interface BuildRoadmapInput {
  technologies: readonly RoadmapTechnology[];
  concepts: readonly RoadmapConcept[];
  edges: readonly GraphEdge[];
  /** conceptId -> current skill. Absent means never practised. */
  skills: ReadonlyMap<string, RoadmapSkill>;
  preferences: RoadmapPreferences;
  /** Concepts per phase before a project lands. §: "after 5-6 lessons". */
  conceptsPerPhase?: number;
}

// -- Outputs ----------------------------------------------------------------

export type RoadmapItemKind =
  | 'LEARN'
  | 'RECALL'
  | 'CODE'
  | 'BLIND_CODE'
  | 'DEBUG'
  | 'EXPLAIN'
  | 'PROJECT'
  | 'CHECKPOINT'
  | 'INTERVIEW';

export interface BuiltItem {
  kind: RoadmapItemKind;
  conceptId: string | null;
  exerciseId: string | null;
  title: string;
  /** Shown to the user. An opaque path is not a trusted path. */
  rationale: string;
  estimatedMinutes: number;
  awaitingContent: boolean;
}

export interface BuiltPhase {
  title: string;
  goal: string;
  technologyId: string | null;
  items: BuiltItem[];
  estimatedMinutes: number;
}

export interface BuiltRoadmap {
  phases: BuiltPhase[];
  /** Technology ids in the order the user will meet them. */
  technologyOrder: string[];
  totalMinutes: number;
  generatedBy: 'rules';
}

// -- Tuning -----------------------------------------------------------------

/** Mastery a concept must reach before the roadmap stops scheduling it. */
const MASTERY_TARGET: Record<TargetProficiency, number> = {
  AWARENESS: 0.3,
  WORKING: 0.6,
  PROFICIENT: 0.8,
  EXPERT: 0.95,
};

const PRIORITY_WEIGHT: Record<Priority, number> = {
  CRITICAL: 3,
  HIGH: 2,
  NORMAL: 1,
  LOW: 0,
};

const DEFAULT_CONCEPTS_PER_PHASE = 5;

/** A concept's reading/explanation step, scaled by how hard it is. */
const LEARN_MINUTES_PER_DIFFICULTY = 4;

const PROJECT_MINUTES = 75;
const INTERVIEW_MINUTES = 20;

// -- Builder ----------------------------------------------------------------

export function buildRoadmap(input: BuildRoadmapInput): BuiltRoadmap {
  const conceptsPerPhase = input.conceptsPerPhase ?? DEFAULT_CONCEPTS_PER_PHASE;
  const technologyOrder = orderTechnologies(input);
  const phases: BuiltPhase[] = [];

  for (const technologyId of technologyOrder) {
    const technology = input.technologies.find((t) => t.technologyId === technologyId);
    if (!technology) continue;

    const conceptsForTech = input.concepts.filter((c) => c.technologyId === technologyId);

    // A technology whose curriculum has not generated yet still belongs in the
    // path. Hiding it would make the roadmap look shorter than the commitment
    // the user actually made.
    if (conceptsForTech.length === 0) {
      phases.push(awaitingContentPhase(technology));
      continue;
    }

    const ordered = orderConcepts(conceptsForTech, input.edges);
    const pending = ordered.filter((c) => !isMastered(c, technology, input.skills));

    // Everything already known. Say so rather than emitting an empty phase.
    if (pending.length === 0) {
      phases.push({
        title: `${technology.name}: already solid`,
        goal: `Nothing scheduled — your ${technology.name} skills already meet your target.`,
        technologyId,
        items: [],
        estimatedMinutes: 0,
      });
      continue;
    }

    phases.push(...phasesForTechnology(technology, pending, input, conceptsPerPhase));
  }

  const totalMinutes = phases.reduce((sum, p) => sum + p.estimatedMinutes, 0);

  return { phases, technologyOrder, totalMinutes, generatedBy: 'rules' };
}

// -- Technology ordering ----------------------------------------------------

/**
 * Technologies are ordered by dependency first, then by what the user cares
 * about. Dependency is a hard constraint: scheduling Node.js before JavaScript
 * would be wrong no matter how the user ranked them.
 */
function orderTechnologies(input: BuildRoadmapInput): string[] {
  const byId = new Map(input.technologies.map((t) => [t.technologyId, t]));
  const conceptTech = new Map(input.concepts.map((c) => [c.id, c.technologyId]));

  // Cross-technology dependencies, derived from concept edges that cross a
  // boundary. Only HARD edges: a soft link is advice, not an ordering.
  const dependsOn = new Map<string, Set<string>>();
  for (const id of byId.keys()) dependsOn.set(id, new Set());

  for (const edge of input.edges) {
    if (edge.strength !== 'HARD') continue;
    const from = conceptTech.get(edge.conceptId);
    const to = conceptTech.get(edge.prerequisiteId);
    if (!from || !to || from === to) continue;
    if (!byId.has(from) || !byId.has(to)) continue;
    dependsOn.get(from)?.add(to);
  }

  // Preference score, used only to break ties the dependency graph leaves open.
  const score = (id: string): number => {
    const tech = byId.get(id);
    if (!tech) return 0;
    const interviewBoost =
      input.preferences.primaryGoal === 'INTERVIEW' ||
      input.preferences.primaryGoal === 'JOB_PREPARATION'
        ? tech.interviewImportance * 0.5
        : 0;
    return PRIORITY_WEIGHT[tech.priority] * 2 + interviewBoost;
  };

  const remaining = new Set(byId.keys());
  const ordered: string[] = [];

  while (remaining.size > 0) {
    const ready = [...remaining].filter((id) =>
      [...(dependsOn.get(id) ?? [])].every((dep) => !remaining.has(dep)),
    );

    // A cycle across technologies should be impossible — the concept graph is
    // validated acyclic on import — but a roadmap that silently drops half the
    // user's choices would be worse than one in an arbitrary order.
    const candidates = ready.length > 0 ? ready : [...remaining];

    candidates.sort((a, b) => {
      const byScore = score(b) - score(a);
      if (byScore !== 0) return byScore;
      // Stable and predictable when everything else ties.
      return (byId.get(a)?.slug ?? '').localeCompare(byId.get(b)?.slug ?? '');
    });

    const next = candidates[0] as string;
    ordered.push(next);
    remaining.delete(next);
  }

  return ordered;
}

// -- Concept ordering -------------------------------------------------------

/**
 * Curriculum order, subject to prerequisites.
 *
 * Kahn's algorithm with `orderIndex` as the tiebreaker, rather than a plain
 * topological sort followed by a secondary sort. The difference matters:
 * a plain sort returns *some* valid order, and for an unconstrained set that
 * order is whatever the input array happened to be — so the curriculum's own
 * sequencing would be silently discarded whenever concepts have no edges
 * between them, which is the common case.
 *
 * Here, prerequisites constrain and `orderIndex` decides everything they leave
 * open.
 */
function orderConcepts(
  concepts: readonly RoadmapConcept[],
  edges: readonly GraphEdge[],
): RoadmapConcept[] {
  const byId = new Map(concepts.map((c) => [c.id, c]));
  const internal = edges.filter((e) => byId.has(e.conceptId) && byId.has(e.prerequisiteId));

  const unmetCount = new Map<string, number>();
  const unlocks = new Map<string, string[]>();
  for (const c of concepts) {
    unmetCount.set(c.id, 0);
    unlocks.set(c.id, []);
  }

  for (const edge of internal) {
    unmetCount.set(edge.conceptId, (unmetCount.get(edge.conceptId) ?? 0) + 1);
    unlocks.get(edge.prerequisiteId)?.push(edge.conceptId);
  }

  const byOrderIndex = (a: string, b: string): number => {
    const left = byId.get(a);
    const right = byId.get(b);
    return (left?.orderIndex ?? 0) - (right?.orderIndex ?? 0) || a.localeCompare(b);
  };

  const ready = concepts
    .filter((c) => (unmetCount.get(c.id) ?? 0) === 0)
    .map((c) => c.id)
    .sort(byOrderIndex);

  const ordered: RoadmapConcept[] = [];

  while (ready.length > 0) {
    const id = ready.shift() as string;
    const item = byId.get(id);
    if (item) ordered.push(item);

    for (const dependent of unlocks.get(id) ?? []) {
      const remaining = (unmetCount.get(dependent) ?? 1) - 1;
      unmetCount.set(dependent, remaining);
      if (remaining === 0) {
        ready.push(dependent);
        ready.sort(byOrderIndex);
      }
    }
  }

  // A cycle would leave concepts unemitted. The graph is validated acyclic on
  // import, but dropping half a user's curriculum is a far worse failure than
  // an imperfect order, so anything stranded is appended.
  if (ordered.length < concepts.length) {
    const emitted = new Set(ordered.map((c) => c.id));
    ordered.push(
      ...concepts.filter((c) => !emitted.has(c.id)).sort((a, b) => a.orderIndex - b.orderIndex),
    );
  }

  return ordered;
}

function isMastered(
  concept: RoadmapConcept,
  technology: RoadmapTechnology,
  skills: ReadonlyMap<string, RoadmapSkill>,
): boolean {
  const skill = skills.get(concept.id);
  if (!skill) return false;

  const target = MASTERY_TARGET[technology.targetProficiency];

  // Both dimensions, deliberately. Understanding without implementation is the
  // exact gap this product exists to close, so mastery alone does not excuse a
  // concept from the path.
  return skill.conceptMastery >= target && skill.codingAbility >= target * 0.8;
}

// -- Phase assembly ---------------------------------------------------------

function phasesForTechnology(
  technology: RoadmapTechnology,
  concepts: readonly RoadmapConcept[],
  input: BuildRoadmapInput,
  conceptsPerPhase: number,
): BuiltPhase[] {
  const chunks = chunk(concepts, conceptsPerPhase);
  const phases: BuiltPhase[] = [];

  for (const [index, group] of chunks.entries()) {
    const items: BuiltItem[] = [];

    for (const concept of group) {
      items.push(...itemsForConcept(concept, input.skills));
    }

    // A project closes every phase: composition is the thing isolated drills
    // never exercise. Uses a real PROJECT exercise when the curriculum has one,
    // and a checkpoint when it does not, rather than inventing a fake project.
    items.push(closingItem(technology, group, chunks.length, index));

    phases.push({
      title: `${technology.name} · part ${index + 1}`,
      goal: phaseGoal(technology, group),
      technologyId: technology.technologyId,
      items,
      estimatedMinutes: items.reduce((sum, i) => sum + i.estimatedMinutes, 0),
    });
  }

  const wantsInterview =
    technology.interviewImportance >= 4 ||
    input.preferences.primaryGoal === 'INTERVIEW' ||
    input.preferences.primaryGoal === 'JOB_PREPARATION';

  if (wantsInterview && phases.length > 0) {
    const last = phases[phases.length - 1] as BuiltPhase;
    last.items.push({
      kind: 'INTERVIEW',
      conceptId: null,
      exerciseId: null,
      title: `${technology.name} interview check`,
      rationale: `You marked ${technology.name} as interview-relevant. This checks whether you can explain it under pressure, not just write it.`,
      estimatedMinutes: INTERVIEW_MINUTES,
      awaitingContent: false,
    });
    last.estimatedMinutes += INTERVIEW_MINUTES;
  }

  return phases;
}

function itemsForConcept(
  concept: RoadmapConcept,
  skills: ReadonlyMap<string, RoadmapSkill>,
): BuiltItem[] {
  const items: BuiltItem[] = [];
  const skill = skills.get(concept.id);
  const learnMinutes = Math.max(8, concept.difficulty * LEARN_MINUTES_PER_DIFFICULTY);

  items.push({
    kind: 'LEARN',
    conceptId: concept.id,
    exerciseId: null,
    title: concept.name,
    rationale: learnRationale(skill),
    estimatedMinutes: learnMinutes,
    awaitingContent: false,
  });

  const coding = pickExercise(concept.exercises, ['CODING', 'RECALL', 'BLIND_CODING']);
  if (coding) {
    items.push({
      kind: 'CODE',
      conceptId: concept.id,
      exerciseId: coding.id,
      title: `Write it: ${concept.name}`,
      rationale:
        skill && skill.conceptMastery > skill.codingAbility + 0.2
          ? 'You understand this better than you can currently implement it.'
          : 'Reading it is not the same as writing it.',
      estimatedMinutes: coding.estimatedMinutes,
      awaitingContent: false,
    });
  }

  const debugging = pickExercise(concept.exercises, ['DEBUGGING']);
  if (debugging) {
    items.push({
      kind: 'DEBUG',
      conceptId: concept.id,
      exerciseId: debugging.id,
      title: `Find the bug: ${concept.name}`,
      rationale: 'Finding a fault you did not create is a separate skill from writing code.',
      estimatedMinutes: debugging.estimatedMinutes,
      awaitingContent: false,
    });
  }

  return items;
}

function closingItem(
  technology: RoadmapTechnology,
  group: readonly RoadmapConcept[],
  totalPhases: number,
  index: number,
): BuiltItem {
  const project = group.flatMap((c) => c.exercises).find((e) => e.kind === 'PROJECT');
  const covered = group.map((c) => c.name).join(', ');

  if (project) {
    return {
      kind: 'PROJECT',
      conceptId: null,
      exerciseId: project.id,
      title: `${technology.name} project ${index + 1} of ${totalPhases}`,
      rationale: `Puts ${covered} together. Isolated exercises never test composition.`,
      estimatedMinutes: project.estimatedMinutes || PROJECT_MINUTES,
      awaitingContent: false,
    };
  }

  return {
    kind: 'CHECKPOINT',
    conceptId: null,
    exerciseId: null,
    title: `Checkpoint: ${technology.name} part ${index + 1}`,
    rationale: `Covers ${covered}. A project for this phase has not been generated yet.`,
    estimatedMinutes: PROJECT_MINUTES,
    awaitingContent: true,
  };
}

function awaitingContentPhase(technology: RoadmapTechnology): BuiltPhase {
  return {
    title: technology.name,
    goal: `Your ${technology.name} curriculum is still being prepared.`,
    technologyId: technology.technologyId,
    items: [
      {
        kind: 'CHECKPOINT',
        conceptId: null,
        exerciseId: null,
        title: `${technology.name} is being prepared`,
        rationale:
          'This is generating in the background. It will fill in before you reach it; check back shortly if not.',
        estimatedMinutes: 0,
        awaitingContent: true,
      },
    ],
    estimatedMinutes: 0,
  };
}

function phaseGoal(technology: RoadmapTechnology, group: readonly RoadmapConcept[]): string {
  const names = group.map((c) => c.name);
  const listed =
    names.length <= 2
      ? names.join(' and ')
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

  return `Be able to write ${listed} in ${technology.name} without help.`;
}

function learnRationale(skill: RoadmapSkill | undefined): string {
  if (!skill) return 'New to you — start here.';
  if (skill.conceptMastery < 0.3) return 'Weak on the concept itself, so start with the idea.';
  return 'A refresher before the implementation.';
}

/** Prefers the easiest matching exercise: the path should start gently. */
function pickExercise(
  exercises: readonly RoadmapExercise[],
  kinds: readonly RoadmapExercise['kind'][],
): RoadmapExercise | undefined {
  return [...exercises]
    .filter((e) => kinds.includes(e.kind))
    .sort(
      (a, b) => a.difficulty - b.difficulty || kinds.indexOf(a.kind) - kinds.indexOf(b.kind),
    )[0];
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
