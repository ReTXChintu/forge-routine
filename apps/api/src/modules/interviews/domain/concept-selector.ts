/**
 * Choosing what an interview asks about (§16).
 *
 * An interview that only probes weaknesses is demoralising and tells the user
 * nothing they did not already know. One that only probes strengths is
 * flattery. A real interview opens somewhere the candidate can succeed, then
 * moves towards the edges of what they know — which is where the information
 * is.
 *
 * So: order by interview relevance, then interleave so no two consecutive
 * areas are both weak.
 */

export interface SelectableConcept {
  conceptId: string;
  name: string;
  description: string;
  commonMistakes: readonly string[];
  /** 0-1. Null when never practised — unknown is not the same as weak. */
  mastery: number | null;
  /** 0-1 from the curriculum. How likely this is to come up in a real interview. */
  interviewRelevance: number;
  difficulty: number;
}

export interface SelectionOptions {
  /** How many areas this interview has room for. */
  count: number;
  targetLevel: 'JUNIOR' | 'MID' | 'SENIOR';
}

/** Below this a concept counts as weak for interleaving purposes. */
const WEAK_THRESHOLD = 0.5;

/** An unpractised concept is treated as mid, not as zero. */
const UNKNOWN_MASTERY = 0.45;

const LEVEL_DIFFICULTY: Record<SelectionOptions['targetLevel'], number> = {
  JUNIOR: 2,
  MID: 3,
  SENIOR: 4,
};

/**
 * Ranks candidates, then interleaves strong and weak so the interview has a
 * shape. Returns at most `count` concepts, in the order they should be asked.
 */
export function selectInterviewConcepts(
  candidates: readonly SelectableConcept[],
  options: SelectionOptions,
): SelectableConcept[] {
  if (candidates.length === 0) return [];

  const targetDifficulty = LEVEL_DIFFICULTY[options.targetLevel];

  const ranked = [...candidates].sort((a, b) => score(b) - score(a));

  const strong: SelectableConcept[] = [];
  const weak: SelectableConcept[] = [];
  for (const concept of ranked) {
    (masteryOf(concept) >= WEAK_THRESHOLD ? strong : weak).push(concept);
  }

  // Open on something they can answer. Starting on a weakness produces an
  // interview where the candidate never settles, and a report measuring
  // nerves rather than knowledge.
  const ordered: SelectableConcept[] = [];
  let takeStrong = strong.length > 0;

  while (ordered.length < options.count && (strong.length > 0 || weak.length > 0)) {
    const pool = takeStrong ? strong : weak;
    const fallback = takeStrong ? weak : strong;
    const next = pool.shift() ?? fallback.shift();
    if (!next) break;
    ordered.push(next);
    takeStrong = !takeStrong;
  }

  return ordered;

  function score(concept: SelectableConcept): number {
    // Relevance dominates: an area that never comes up in interviews is not
    // worth interview time however shaky it is.
    const relevance = concept.interviewRelevance * 0.5;

    // Peak interest at the edge of competence. Certain knowledge and total
    // ignorance are both cheap to establish and neither needs four turns.
    const mastery = masteryOf(concept);
    const edge = (1 - Math.abs(mastery - 0.55) / 0.55) * 0.3;

    // Pitched at the level being interviewed for.
    const fit = (1 - Math.abs(concept.difficulty - targetDifficulty) / 4) * 0.2;

    return relevance + Math.max(0, edge) + fit;
  }
}

function masteryOf(concept: SelectableConcept): number {
  return concept.mastery ?? UNKNOWN_MASTERY;
}

/**
 * How many areas fit in an interview of this mode, and how deep each may go.
 *
 * Depth is capped because an interviewer who will not leave a topic stops
 * gathering information and starts grinding the candidate down.
 */
export function interviewShape(mode: string): { concepts: number; maxDepth: number } {
  switch (mode) {
    case 'QUICK':
      return { concepts: 3, maxDepth: 2 };
    case 'CODING':
    case 'DEBUGGING':
      return { concepts: 3, maxDepth: 3 };
    case 'SYSTEM_DESIGN':
      return { concepts: 2, maxDepth: 4 };
    case 'SENIOR':
      return { concepts: 5, maxDepth: 4 };
    case 'TECHNICAL':
    default:
      return { concepts: 4, maxDepth: 3 };
  }
}

/** Total turns before the interview ends regardless of how it is going. */
export function maxTurns(mode: string): number {
  const shape = interviewShape(mode);
  return shape.concepts * shape.maxDepth;
}
