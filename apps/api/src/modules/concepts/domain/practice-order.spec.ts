import { interleave } from './practice-order.js';

/**
 * The properties that make a set finishable.
 *
 * Every one of these is a way a set gets abandoned rather than answered:
 * opening on the hardest question, four paragraphs of prose in a row, or —
 * worst and quietest — a question that never appears because the spacing
 * arithmetic swallowed it.
 */

const mcq = (difficulty: number, id = `m${difficulty}`) => ({ id, kind: 'MCQ', difficulty });
const theory = (difficulty: number, id = `t${difficulty}`) => ({ id, kind: 'THEORY', difficulty });

describe('practice set ordering', () => {
  it('keeps every question', () => {
    const questions = [mcq(3), theory(5), mcq(1), theory(2), mcq(4), mcq(2), theory(4)];

    const ordered = interleave(questions);

    expect(ordered).toHaveLength(questions.length);
    expect(new Set(ordered.map((q) => q.id))).toEqual(new Set(questions.map((q) => q.id)));
  });

  it('never asks two written questions in a row', () => {
    // The ratio that used to produce them: more prose than multiple choice.
    const questions = [mcq(1), mcq(2), theory(1), theory(2), theory(3), theory(4)];

    const ordered = interleave(questions);

    const runs = ordered.filter(
      (question, index) =>
        question.kind === 'THEORY' && ordered[index - 1]?.kind === 'THEORY' && index > 0,
    );
    // Four written against two multiple choice cannot be fully separated,
    // so the surplus lands at the end — but the interleaved part must not
    // double up before it gets there.
    expect(ordered.slice(0, 4).filter((q) => q.kind === 'THEORY')).toHaveLength(2);
    expect(runs.length).toBeLessThanOrEqual(2);
  });

  it('opens on the easiest question', () => {
    const ordered = interleave([mcq(5), mcq(1), mcq(3), theory(2)]);

    expect(ordered[0]).toMatchObject({ kind: 'MCQ', difficulty: 1 });
  });

  it('asks multiple choice in increasing difficulty', () => {
    const ordered = interleave([mcq(4), mcq(1), mcq(5), mcq(2), theory(3)]);

    const difficulties = ordered.filter((q) => q.kind === 'MCQ').map((q) => q.difficulty);
    expect(difficulties).toEqual([...difficulties].sort((a, b) => a - b));
  });

  it('spreads the written questions rather than stacking them at the end', () => {
    const ordered = interleave([
      mcq(1),
      mcq(2),
      mcq(3),
      mcq(4),
      mcq(5),
      mcq(1, 'm6'),
      theory(2),
      theory(3),
      theory(4),
    ]);

    const positions = ordered
      .map((question, index) => (question.kind === 'THEORY' ? index : -1))
      .filter((index) => index >= 0);

    // Not all bunched at the tail: the first written question arrives
    // within the first half.
    expect(positions[0]).toBeLessThan(ordered.length / 2);
  });

  it('handles a set of only one kind', () => {
    expect(interleave([mcq(2), mcq(1)]).map((q) => q.difficulty)).toEqual([1, 2]);
    expect(interleave([theory(2), theory(1)]).map((q) => q.difficulty)).toEqual([1, 2]);
    expect(interleave([])).toEqual([]);
  });

  it('does not reorder the caller’s array', () => {
    const questions = [mcq(3), mcq(1)];

    interleave(questions);

    expect(questions.map((q) => q.difficulty)).toEqual([3, 1]);
  });
});
