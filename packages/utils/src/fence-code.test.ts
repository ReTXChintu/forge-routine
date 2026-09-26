import { describe, expect, it } from 'vitest';

import { fenceCode } from './fence-code.js';

/**
 * Fencing code a model wrote without fences.
 *
 * The prompts below are real ones, taken from the database after a user
 * reported that multiple-choice questions showed their code as a single
 * unreadable line.
 *
 * The risk runs both ways, and the second direction is the worse one: code
 * left unfenced is hard to read, but prose wrongly fenced is unreadable *and*
 * looks like a bug. Most of these cases guard that side.
 */

const COUNTERS = [
  'Consider the following code snippet:',
  '',
  'function createCounters() {',
  '  var functions = [];',
  '  for (var i = 0; i < 3; i++) {',
  '    functions.push(function() {',
  '      return i;',
  '    });',
  '  }',
  '  return functions;',
  '}',
  '',
  'const counters = createCounters();',
  'console.log([counters[0](), counters[1](), counters[2]()]);',
  '',
  'What is logged to the console, and why?',
].join('\n');

describe('fencing code in a question', () => {
  it('fences the snippet and leaves the question alone', () => {
    const result = fenceCode(COUNTERS);

    expect(result).toContain('```js\nfunction createCounters() {');
    expect(result).toContain('```\n\nWhat is logged to the console, and why?');
    // The prose either side stays prose.
    expect(result.startsWith('Consider the following code snippet:')).toBe(true);
  });

  it('fences a second, separate snippet in the same prompt', () => {
    // The counters prompt has two: the function, then the two calls.
    const fences = (fenceCode(COUNTERS).match(/```/g) ?? []).length;

    expect(fences).toBe(4);
  });

  it('keeps every line of the code', () => {
    const result = fenceCode(COUNTERS);

    for (const line of ['var functions = [];', '    functions.push(function() {', '  }']) {
      expect(result).toContain(line);
    }
  });

  it('leaves an already-fenced prompt untouched', () => {
    const already = 'Look at this:\n\n```js\nconst a = 1;\n```\n\nWhat is a?';

    expect(fenceCode(already)).toBe(already);
  });

  it('leaves a prompt with no code alone', () => {
    const prose =
      'Why does a closure hold a reference rather than a copy?\n\n' +
      'Answer in terms of the variable binding, not the value.';

    expect(fenceCode(prose)).toBe(prose);
  });

  it('does not fence a single line that merely ends in a semicolon', () => {
    // One line is a mention, not a snippet, and fencing it mid-sentence
    // breaks the sentence in half.
    const text = 'Some people write const a = 1;\n\nIs that valid at the top level?';

    expect(fenceCode(text)).toBe(text);
  });

  it('does not fence a paragraph that talks about code', () => {
    const text = [
      'Consider what happens here.',
      '',
      'A function declared with the function keyword is hoisted, and a const is not.',
      'That difference matters when you return a closure from a factory.',
      '',
      'Which statement is true?',
    ].join('\n');

    expect(fenceCode(text)).not.toContain('```');
  });

  it('does not fence a question that spans two lines', () => {
    const text = [
      'Consider the closure below and the variable it captures.',
      '',
      'What is logged, and why does the loop variable behave that way?',
      'Explain in terms of the binding rather than the value.',
    ].join('\n');

    expect(fenceCode(text)).not.toContain('```');
  });

  it('handles a prompt that is only code', () => {
    // No blank line to split on, so there is nothing to distinguish and it is
    // left as it is rather than guessed at.
    const text = 'const a = 1;\nconsole.log(a);';

    expect(fenceCode(text)).toBe(text);
  });

  it('takes the language it is given', () => {
    const text = 'Look:\n\nSELECT id FROM users;\nWHERE id = 1;\n\nWhat is wrong?';

    expect(fenceCode(text, 'sql')).toContain('```sql');
  });

  it('is idempotent', () => {
    const once = fenceCode(COUNTERS);

    expect(fenceCode(once)).toBe(once);
  });
});
