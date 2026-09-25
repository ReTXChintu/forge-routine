import { needsGeneration } from './practice-quota.js';

/**
 * A rule about spending, so the cases that matter are the ones that would
 * spend twice.
 */

const QUOTA = { mcqs: 6, theory: 3 };
const V = 'v1';

const seeded = (kind: string, count: number) =>
  Array.from({ length: count }, () => ({ kind, promptVersion: null }));
const generated = (kind: string, count: number, version = V) =>
  Array.from({ length: count }, () => ({ kind, promptVersion: version }));

describe('deciding whether to write questions', () => {
  it('writes for a concept that has none', () => {
    expect(needsGeneration([], V, QUOTA)).toBe(true);
  });

  it('writes for a concept with seeded multiple choice but nothing written', () => {
    expect(needsGeneration(seeded('MCQ', 8), V, QUOTA)).toBe(true);
  });

  it('does not write twice when the model returned fewer than asked', () => {
    // The money leak: four of six arrived, and counting the shortfall would
    // buy another six on every open, for ever.
    const short = [...generated('MCQ', 4), ...generated('THEORY', 2)];

    expect(needsGeneration(short, V, QUOTA)).toBe(false);
  });

  it('does not write when the quotas are already met', () => {
    const full = [...generated('MCQ', 6), ...generated('THEORY', 3)];

    expect(needsGeneration(full, V, QUOTA)).toBe(false);
  });

  it('costs nothing when the seed alone covers both quotas', () => {
    const rich = [...seeded('MCQ', 6), ...seeded('THEORY', 3)];

    expect(needsGeneration(rich, V, QUOTA)).toBe(false);
  });

  it('writes once more when the prompt version moves on', () => {
    const old = [...generated('MCQ', 6, 'v1'), ...generated('THEORY', 3, 'v1')];

    expect(needsGeneration(old, 'v2', QUOTA)).toBe(true);
    // And then stops again.
    expect(needsGeneration([...old, ...generated('MCQ', 1, 'v2')], 'v2', QUOTA)).toBe(false);
  });
});
