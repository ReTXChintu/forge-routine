import {
  interviewShape,
  maxTurns,
  selectInterviewConcepts,
  type SelectableConcept,
} from './concept-selector.js';

/**
 * The selector decides what an interview is *about*, which is most of what
 * makes it useful. Two failure modes matter and neither shows up as an error:
 * an interview that only probes weaknesses (demoralising, tells the user
 * nothing new) and one that only probes strengths (flattery).
 */
function concept(overrides: Partial<SelectableConcept> = {}): SelectableConcept {
  return {
    conceptId: overrides.conceptId ?? 'c1',
    name: overrides.name ?? 'Closures',
    description: 'A function that captures its lexical scope.',
    commonMistakes: [],
    mastery: overrides.mastery ?? 0.5,
    interviewRelevance: overrides.interviewRelevance ?? 0.5,
    difficulty: overrides.difficulty ?? 3,
    ...overrides,
  };
}

describe('selectInterviewConcepts', () => {
  it('returns nothing when there is nothing to ask about', () => {
    expect(selectInterviewConcepts([], { count: 4, targetLevel: 'MID' })).toEqual([]);
  });

  it('never returns more than the interview has room for', () => {
    const candidates = Array.from({ length: 20 }, (_, index) =>
      concept({ conceptId: `c${index}`, name: `Concept ${index}` }),
    );

    expect(selectInterviewConcepts(candidates, { count: 3, targetLevel: 'MID' })).toHaveLength(3);
  });

  it('returns everything it has when there are fewer candidates than slots', () => {
    const candidates = [concept({ conceptId: 'a' }), concept({ conceptId: 'b' })];

    expect(selectInterviewConcepts(candidates, { count: 5, targetLevel: 'MID' })).toHaveLength(2);
  });

  it('opens on something answerable rather than on a weakness', () => {
    // Starting on a weakness produces an interview where the candidate never
    // settles, and a report that measures nerves rather than knowledge.
    const candidates = [
      concept({ conceptId: 'weak', mastery: 0.1, interviewRelevance: 1 }),
      concept({ conceptId: 'strong', mastery: 0.85, interviewRelevance: 1 }),
    ];

    const [first] = selectInterviewConcepts(candidates, { count: 2, targetLevel: 'MID' });

    expect(first?.conceptId).toBe('strong');
  });

  it('interleaves so two weak areas never run back to back', () => {
    const candidates = [
      concept({ conceptId: 'w1', mastery: 0.1 }),
      concept({ conceptId: 'w2', mastery: 0.15 }),
      concept({ conceptId: 'w3', mastery: 0.2 }),
      concept({ conceptId: 's1', mastery: 0.8 }),
      concept({ conceptId: 's2', mastery: 0.9 }),
    ];

    const selected = selectInterviewConcepts(candidates, { count: 4, targetLevel: 'MID' });
    const isWeak = selected.map((c) => (c.mastery ?? 0) < 0.5);

    for (let index = 1; index < isWeak.length; index += 1) {
      expect(isWeak[index] && isWeak[index - 1]).toBe(false);
    }
  });

  it('falls back to the other pool rather than returning short', () => {
    // Four weak concepts and no strong ones must still fill four slots.
    const candidates = Array.from({ length: 4 }, (_, index) =>
      concept({ conceptId: `w${index}`, mastery: 0.1 }),
    );

    expect(selectInterviewConcepts(candidates, { count: 4, targetLevel: 'MID' })).toHaveLength(4);
  });

  it('prefers relevant areas over irrelevant ones at equal mastery', () => {
    const candidates = [
      concept({ conceptId: 'irrelevant', interviewRelevance: 0.1, mastery: 0.55 }),
      concept({ conceptId: 'relevant', interviewRelevance: 1, mastery: 0.55 }),
    ];

    const [first] = selectInterviewConcepts(candidates, { count: 1, targetLevel: 'MID' });

    expect(first?.conceptId).toBe('relevant');
  });

  it('treats an unpractised concept as mid, not as zero', () => {
    // Unknown is not the same as weak: never practised means no evidence,
    // and scoring it as 0 would flood every interview with new material.
    const [first] = selectInterviewConcepts(
      [
        concept({ conceptId: 'unknown', mastery: null, interviewRelevance: 0.5 }),
        concept({ conceptId: 'known-weak', mastery: 0.05, interviewRelevance: 0.5 }),
      ],
      { count: 1, targetLevel: 'MID' },
    );

    expect(first?.conceptId).toBe('unknown');
  });

  it('pitches difficulty at the level being interviewed for', () => {
    const candidates = [
      concept({ conceptId: 'easy', difficulty: 1, interviewRelevance: 0.5, mastery: 0.55 }),
      concept({ conceptId: 'hard', difficulty: 5, interviewRelevance: 0.5, mastery: 0.55 }),
    ];

    const [forJunior] = selectInterviewConcepts(candidates, { count: 1, targetLevel: 'JUNIOR' });
    const [forSenior] = selectInterviewConcepts(candidates, { count: 1, targetLevel: 'SENIOR' });

    expect(forJunior?.conceptId).toBe('easy');
    expect(forSenior?.conceptId).toBe('hard');
  });

  it('does not mutate the caller-supplied array', () => {
    const candidates = [concept({ conceptId: 'a' }), concept({ conceptId: 'b' })];
    const before = candidates.map((c) => c.conceptId);

    selectInterviewConcepts(candidates, { count: 2, targetLevel: 'MID' });

    expect(candidates.map((c) => c.conceptId)).toEqual(before);
  });
});

describe('interviewShape', () => {
  it('gives a quick interview breadth and a system-design one depth', () => {
    expect(interviewShape('QUICK').concepts).toBeGreaterThan(
      interviewShape('SYSTEM_DESIGN').concepts,
    );
    expect(interviewShape('SYSTEM_DESIGN').maxDepth).toBeGreaterThan(
      interviewShape('QUICK').maxDepth,
    );
  });

  it('falls back to the technical shape for an unknown mode', () => {
    expect(interviewShape('NONSENSE')).toEqual(interviewShape('TECHNICAL'));
  });

  it('caps every mode, so no interview can run forever', () => {
    for (const mode of ['QUICK', 'TECHNICAL', 'CODING', 'DEBUGGING', 'SYSTEM_DESIGN', 'SENIOR']) {
      expect(maxTurns(mode)).toBeGreaterThan(0);
      expect(maxTurns(mode)).toBeLessThanOrEqual(20);
    }
  });
});
