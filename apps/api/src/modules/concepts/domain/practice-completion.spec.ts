import { completionState, isAnswered } from './practice-completion.js';

/**
 * The rule a concept's auto-completion turns on.
 *
 * Every case here is a way it fails silently rather than loudly: a concept
 * that completes without the work, one that can never complete at all, or one
 * whose completion depends on what somebody else generated.
 */

const q = (id: string, answered: boolean) => ({ questionId: id, answered });
const e = (id: string, passed: boolean) => ({ exerciseId: id, passed });

describe('concept practice completion', () => {
  it('completes when everything served has been dealt with', () => {
    const state = completionState([q('a', true), q('b', true)], [e('x', true)]);

    expect(state.complete).toBe(true);
    expect(state.outstanding).toEqual({ questions: 0, exercises: 0 });
  });

  it('does not complete a concept nobody has practised', () => {
    // The dangerous case: an empty set is vacuously "all answered", and a
    // concept would auto-complete its routine item the moment anything asked.
    expect(completionState([], []).complete).toBe(false);
  });

  it('waits for the coding exercise', () => {
    const state = completionState([q('a', true), q('b', true)], [e('x', false)]);

    expect(state.complete).toBe(false);
    expect(state.outstanding.exercises).toBe(1);
  });

  it('waits for the unanswered question', () => {
    const state = completionState([q('a', true), q('b', false)], [e('x', true)]);

    expect(state.complete).toBe(false);
    expect(state.outstanding.questions).toBe(1);
  });

  it('counts a wrong answer as answered', () => {
    // Deliberate: the explanation is where the learning is, and blocking on a
    // wrong answer would make it an obstacle instead.
    const state = completionState([q('a', true)], [e('x', true)]);

    expect(state.complete).toBe(true);
  });

  it('completes on questions alone when a concept has no code', () => {
    // Docker, Linux, SQL — nothing the sandbox can run.
    expect(completionState([q('a', true), q('b', true)], []).complete).toBe(true);
  });

  it('completes on code alone when no questions were served', () => {
    expect(completionState([], [e('x', true)]).complete).toBe(true);
  });

  it('reports progress, not just the verdict', () => {
    const state = completionState([q('a', true), q('b', false), q('c', true)], [e('x', false)]);

    expect(state).toMatchObject({
      questionsAnswered: 2,
      questionsServed: 3,
      exercisesPassed: 0,
      exercisesServed: 1,
    });
  });
});

describe('what counts as answered', () => {
  it('counts a multiple-choice pick', () => {
    expect(isAnswered({ selectedIndex: 0, selfRating: null })).toBe(true);
    // Index 0 is a real choice. A falsy check here would ignore option A.
    expect(isAnswered({ selectedIndex: 2, selfRating: null })).toBe(true);
  });

  it('counts a written answer only once it has been judged', () => {
    expect(isAnswered({ selectedIndex: null, selfRating: null })).toBe(false);
    // Rating 0 is "missed it" — a judgement, and it counts.
    expect(isAnswered({ selectedIndex: null, selfRating: 0 })).toBe(true);
    expect(isAnswered({ selectedIndex: null, selfRating: 2 })).toBe(true);
  });
});
