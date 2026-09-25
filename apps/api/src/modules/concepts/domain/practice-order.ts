/**
 * The order a practice set is asked in.
 *
 * Two rules, both from how people actually abandon a set:
 *
 *   Easiest first. A set that opens with its hardest question is one people
 *   conclude they are not ready for, and close.
 *
 *   Never two written questions in a row. A run of prose turns practice into
 *   an essay paper; spacing them out also means each arrives after some
 *   multiple choice has warmed the concept up.
 */

export interface Orderable {
  kind: string;
  difficulty: number;
}

/**
 * Multiple choice easiest-first, with the written questions spread through
 * it. Anything left over goes at the end, so nothing is ever dropped —
 * a question that vanished because the arithmetic did not divide evenly
 * would be a silently shorter set.
 */
export function interleave<T extends Orderable>(questions: readonly T[]): T[] {
  const mcqs = [...questions].filter((q) => q.kind === 'MCQ').sort(byDifficulty);
  const theory = [...questions].filter((q) => q.kind === 'THEORY').sort(byDifficulty);

  if (mcqs.length === 0) return theory;
  if (theory.length === 0) return mcqs;

  // Spaced by the ratio, so the written ones land evenly however many of
  // each there happen to be.
  const spacing = Math.max(1, Math.ceil(mcqs.length / theory.length));

  const ordered: T[] = [];
  let next = 0;

  mcqs.forEach((mcq, index) => {
    ordered.push(mcq);
    if ((index + 1) % spacing === 0 && next < theory.length) {
      ordered.push(theory[next]!);
      next += 1;
    }
  });

  return [...ordered, ...theory.slice(next)];
}

function byDifficulty(a: Orderable, b: Orderable): number {
  return a.difficulty - b.difficulty;
}
