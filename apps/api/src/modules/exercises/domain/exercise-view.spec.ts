import type { AssistanceLevel } from '@forgeroutine/shared-types';

import { type StoredExercise, projectExercise } from './exercise-view.js';

/**
 * The assistance ladder is the product. A leak here silently destroys the value of
 * every exercise above level 1, and would do so without any visible failure — so
 * it is tested exhaustively rather than by example.
 */
const exercise: StoredExercise = {
  id: 'ex1',
  slug: 'debounce',
  title: 'Implement debounce',
  kind: 'CODING',
  difficulty: 3,
  language: 'javascript',
  objective: 'Write a debounce function from scratch.',
  requirements: 'Export a default function debounce(fn, wait).',
  functionSignature: 'export default function debounce(fn, wait) {}',
  starterCode: 'export default function debounce(fn, wait) {\n  // ...\n}\n',
  examples: ['const save = debounce(persist, 200);'],
  estimatedMinutes: 15,
  testCases: [
    { name: 'collapses rapid calls', hidden: false },
    { name: 'cancel() prevents invocation', hidden: true },
  ],
};

const levels: AssistanceLevel[] = [1, 2, 3, 4, 5];

describe('projectExercise', () => {
  it.each(levels)('always shows the objective at level %i', (level) => {
    const view = projectExercise(exercise, { level, blindMode: false });
    expect(view.objective).toBe(exercise.objective);
  });

  describe('level 1 (Guided)', () => {
    const view = projectExercise(exercise, { level: 1, blindMode: false });

    it('gives requirements, signature, starter code and examples', () => {
      expect(view.requirements).toBe(exercise.requirements);
      expect(view.functionSignature).toBe(exercise.functionSignature);
      expect(view.starterCode).toBe(exercise.starterCode);
      expect(view.examples).toEqual(exercise.examples);
    });
  });

  describe('level 2 (Partial)', () => {
    const view = projectExercise(exercise, { level: 2, blindMode: false });

    it('gives the signature but withholds the starter code', () => {
      expect(view.functionSignature).toBe(exercise.functionSignature);
      expect(view.starterCode).toBeNull();
      expect(view.examples).toEqual([]);
    });
  });

  describe('level 3 (Recall)', () => {
    const view = projectExercise(exercise, { level: 3, blindMode: false });

    it('gives the problem statement only', () => {
      expect(view.requirements).toBe(exercise.requirements);
      expect(view.functionSignature).toBeNull();
      expect(view.starterCode).toBeNull();
    });

    it('withholds test names, which would hand over the structure', () => {
      expect(view.visibleTestNames).toEqual([]);
    });
  });

  describe('level 4 (Blank)', () => {
    const view = projectExercise(exercise, { level: 4, blindMode: false });

    it('gives nothing but the one-line objective', () => {
      expect(view.requirements).toBeNull();
      expect(view.functionSignature).toBeNull();
      expect(view.starterCode).toBeNull();
      expect(view.examples).toEqual([]);
      expect(view.visibleTestNames).toEqual([]);
    });
  });

  describe('level 5 (Interview)', () => {
    const view = projectExercise(exercise, { level: 5, blindMode: false });

    it('restores the full problem statement, as a real interview would', () => {
      expect(view.requirements).toBe(exercise.requirements);
    });

    it('turns AI assistance off by default', () => {
      expect(view.aiAssistanceEnabled).toBe(false);
    });
  });

  describe('leak guards', () => {
    it.each(levels)('never exposes hidden test names at level %i', (level) => {
      const view = projectExercise(exercise, { level, blindMode: false });
      expect(view.visibleTestNames).not.toContain('cancel() prevents invocation');
    });

    it.each([2, 3, 4, 5] as AssistanceLevel[])(
      'never exposes starter code above level 1 (level %i)',
      (level) => {
        expect(projectExercise(exercise, { level, blindMode: false }).starterCode).toBeNull();
      },
    );

    it.each([3, 4, 5] as AssistanceLevel[])(
      'never exposes the function signature above level 2 (level %i)',
      (level) => {
        expect(
          projectExercise(exercise, { level, blindMode: false }).functionSignature,
        ).toBeNull();
      },
    );
  });

  describe('blind mode', () => {
    it.each(levels)('disables AI assistance at every level (level %i)', (level) => {
      const view = projectExercise(exercise, { level, blindMode: true });
      expect(view.aiAssistanceEnabled).toBe(false);
    });

    it('hides test names even at level 1', () => {
      const view = projectExercise(exercise, { level: 1, blindMode: true });
      expect(view.visibleTestNames).toEqual([]);
    });
  });

  it('enables AI assistance below level 5 outside blind mode', () => {
    for (const level of [1, 2, 3, 4] as AssistanceLevel[]) {
      expect(projectExercise(exercise, { level, blindMode: false }).aiAssistanceEnabled).toBe(
        true,
      );
    }
  });
});
