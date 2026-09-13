import { describe, expect, it } from 'vitest';

import {
  currentConcept,
  gateSequence,
  sequenceProgress,
  type SequenceConcept,
} from './sequence.js';

/**
 * The gate decides what the user is allowed to open, so both ways of getting
 * it wrong are serious: letting them skip ahead defeats a basics-to-advanced
 * course, and walling them in behind something unclearable strands them with
 * no way out and no explanation.
 */

function concept(conceptId: string, orderIndex: number, hasPractice = true): SequenceConcept {
  return { conceptId, orderIndex, hasPractice };
}

const course = [concept('a', 0), concept('b', 1), concept('c', 2)];

const cleared = (...ids: string[]) => ({ clearedConceptIds: new Set(ids) });

describe('gateSequence', () => {
  it('opens only the first concept to a new user', () => {
    const gates = gateSequence(course, cleared());

    expect(gates.map((gate) => gate.unlocked)).toEqual([true, false, false]);
  });

  it('opens the next one as each is cleared', () => {
    expect(gateSequence(course, cleared('a')).map((g) => g.unlocked)).toEqual([true, true, false]);
    expect(gateSequence(course, cleared('a', 'b')).map((g) => g.unlocked)).toEqual([
      true,
      true,
      true,
    ]);
  });

  it('names what is blocking, so the UI can say why', () => {
    const gates = gateSequence(course, cleared());

    expect(gates[2]?.blockedByConceptId).toBe('a');
  });

  it('does not let a later success unlock what it skipped', () => {
    // Clearing 'c' somehow must not open 'b'. The whole point is that the
    // order is the curriculum.
    const gates = gateSequence(course, cleared('c'));

    expect(gates[1]?.unlocked).toBe(false);
  });

  it('sorts by orderIndex rather than trusting the input order', () => {
    const shuffled = [concept('c', 2), concept('a', 0), concept('b', 1)];
    const gates = gateSequence(shuffled, cleared());

    expect(gates.map((gate) => gate.conceptId)).toEqual(['a', 'b', 'c']);
    expect(gates[0]?.unlocked).toBe(true);
  });

  it('never blocks on a concept that cannot be cleared', () => {
    // A reading-only concept has nothing to pass. Letting it block would
    // wall the user in permanently with nothing they could do about it.
    const withReading = [concept('a', 0), concept('reading', 1, false), concept('c', 2)];
    const gates = gateSequence(withReading, cleared('a'));

    expect(gates[2]?.unlocked).toBe(true);
  });

  it('keeps a cleared concept open', () => {
    // Mastery decays; clearing is a historical fact. Re-locking finished
    // material is the most frustrating thing a course can do.
    const gates = gateSequence(course, cleared('a', 'b', 'c'));

    expect(gates.every((gate) => gate.unlocked)).toBe(true);
  });

  it('handles an empty technology', () => {
    expect(gateSequence([], cleared())).toEqual([]);
  });
});

describe('currentConcept', () => {
  it('is the first unfinished one', () => {
    expect(currentConcept(course, cleared('a'))).toBe('b');
  });

  it('skips a concept with nothing to do', () => {
    const withReading = [concept('a', 0), concept('reading', 1, false), concept('c', 2)];

    expect(currentConcept(withReading, cleared('a'))).toBe('c');
  });

  it('is null once the course is finished', () => {
    expect(currentConcept(course, cleared('a', 'b', 'c'))).toBeNull();
  });
});

describe('sequenceProgress', () => {
  it('counts only what can actually be cleared', () => {
    const withReading = [concept('a', 0), concept('reading', 1, false)];

    expect(sequenceProgress(withReading, cleared('a'))).toBe(1);
  });

  it('is zero for a technology with nothing to do', () => {
    expect(sequenceProgress([concept('reading', 0, false)], cleared())).toBe(0);
  });

  it('reports a fraction part way through', () => {
    expect(sequenceProgress(course, cleared('a', 'b'))).toBeCloseTo(2 / 3);
  });
});
