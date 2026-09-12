import type { SeedExerciseInput } from './types.js';

/**
 * Debugging exercises (§13).
 *
 * Finding a fault you did not create is a distinct ability from writing code,
 * and it decays differently. These are not toy bugs: every one is drawn from
 * the `commonMistakes` recorded on its concept, which is where real faults come
 * from in practice.
 *
 * The flow is deliberately two-part — diagnose, then fix — because a user who
 * repairs code by shuffling it until the tests pass has learned nothing. The
 * diagnosis is graded separately from the fix.
 *
 * Keyed by `technologySlug:conceptSlug`.
 */
export const DEBUGGING_EXERCISES: Record<string, SeedExerciseInput[]> = {
  'javascript:functions-and-closures': [
    {
      slug: 'debug-loop-closure',
      title: 'Handlers that all return the same thing',
      kind: 'DEBUGGING',
      difficulty: 3,
      language: 'javascript',
      objective: 'Every handler returns the wrong item. Find out why, then fix it.',
      requirements: [
        'Each handler at index i must return items[i] when called.',
        'Explain the fault before you change anything.',
        'Fix the cause, not the symptom.',
      ].join('\n'),
      brokenCode: `export default function makeHandlers(items) {
  const handlers = [];

  for (var i = 0; i < items.length; i++) {
    handlers.push(() => items[i]);
  }

  return handlers;
}
`,
      bugExplanation:
        '`var` is function-scoped, so all three closures capture the same binding of `i`. ' +
        'By the time any handler runs the loop has finished and `i === items.length`, so ' +
        'every closure reads `items[items.length]`, which is `undefined`. `let` creates a ' +
        'fresh binding per iteration and fixes it.',
      staticHints: [
        'How many separate variables named `i` exist by the time the loop ends?',
        'When does a closure read a captured variable: when it is created, or when it is called?',
      ],
      estimatedMinutes: 12,
      testCases: [
        {
          name: 'each handler returns its own item',
          hidden: false,
          code: `const handlers = solution(['a', 'b', 'c']);
assert.equal(handlers.length, 3);
assert.equal(handlers[0](), 'a');
assert.equal(handlers[1](), 'b');
assert.equal(handlers[2](), 'c');`,
        },
        {
          name: 'works for a single item',
          hidden: false,
          code: `const handlers = solution(['only']);
assert.equal(handlers[0](), 'only');`,
        },
        {
          name: 'returns an empty list for empty input',
          hidden: true,
          code: `assert.deepEqual(solution([]), []);`,
        },
        {
          name: 'handlers stay correct when called out of order and repeatedly',
          hidden: true,
          code: `const handlers = solution([10, 20, 30]);
assert.equal(handlers[2](), 30);
assert.equal(handlers[0](), 10);
assert.equal(handlers[2](), 30, 'calling twice must give the same answer');`,
        },
      ],
    },
  ],

  'javascript:objects-and-references': [
    {
      slug: 'debug-splice-while-iterating',
      title: 'The filter that misses every other match',
      kind: 'DEBUGGING',
      difficulty: 3,
      language: 'javascript',
      objective: 'This removes some even numbers but not all of them. Work out why, then fix it.',
      requirements: [
        'Return an array containing only the odd numbers, in their original order.',
        'Explain the fault before you change anything.',
      ].join('\n'),
      brokenCode: `export default function removeEvens(numbers) {
  for (let i = 0; i < numbers.length; i++) {
    if (numbers[i] % 2 === 0) {
      numbers.splice(i, 1);
    }
  }

  return numbers;
}
`,
      bugExplanation:
        '`splice` shifts every later element down one index while `i` still advances, so the ' +
        'element immediately after a removed one is skipped. Two adjacent even numbers means ' +
        'the second survives. Iterating backwards, or building a new array with `filter`, ' +
        'avoids mutating the collection being traversed.',
      staticHints: [
        'What happens to the index of the next element when you remove the current one?',
        'Trace it by hand with [2, 4, 6]. Which values does the loop actually look at?',
      ],
      estimatedMinutes: 12,
      testCases: [
        {
          name: 'removes a single even number',
          hidden: false,
          code: `assert.deepEqual(solution([1, 2, 3]), [1, 3]);`,
        },
        {
          name: 'removes adjacent even numbers',
          hidden: false,
          code: `assert.deepEqual(solution([2, 4, 6, 7]), [7], 'adjacent evens are the failing case');`,
        },
        {
          name: 'handles an all-even list',
          hidden: false,
          code: `assert.deepEqual(solution([2, 4, 6, 8]), []);`,
        },
        {
          name: 'preserves order and leaves odd-only lists alone',
          hidden: true,
          code: `assert.deepEqual(solution([9, 7, 5]), [9, 7, 5]);
assert.deepEqual(solution([]), []);`,
        },
        {
          name: 'handles negatives and zero',
          hidden: true,
          code: `assert.deepEqual(solution([-4, -3, 0, 1]), [-3, 1]);`,
        },
      ],
    },
  ],

  'nodejs:middleware': [
    {
      slug: 'debug-unawaited-async-map',
      title: 'The endpoint that responds before its work is done',
      kind: 'DEBUGGING',
      difficulty: 4,
      language: 'javascript',
      objective:
        'This reports success before the emails have actually been sent. Find the fault and fix it.',
      requirements: [
        'Export a default async function `notifyAll(users, sendEmail)`.',
        'It must resolve only once every email has been sent.',
        'It must resolve with the number of emails sent.',
        'If any send fails, the returned promise must reject.',
        'Explain the fault before you change anything.',
      ].join('\n'),
      brokenCode: `export default async function notifyAll(users, sendEmail) {
  users.map(async (user) => {
    await sendEmail(user.email);
  });

  return users.length;
}
`,
      bugExplanation:
        '`map` with an async callback produces an array of promises that nothing awaits. The ' +
        'function returns immediately, the count is a guess rather than a fact, and a failing ' +
        'send becomes an unhandled rejection instead of an error the caller can see. ' +
        '`await Promise.all(users.map(...))` waits for all of them and propagates the first ' +
        'failure. This is the §13 example: the same shape as an Express handler that calls ' +
        '`res.json()` before its side effects have completed.',
      staticHints: [
        'What does an async callback passed to `.map` actually return?',
        'Who is waiting for those return values?',
        'What happens to an error thrown inside one of those callbacks?',
      ],
      estimatedMinutes: 18,
      testCases: [
        {
          name: 'sends an email to every user',
          hidden: false,
          code: `const sent = [];
const sendEmail = async (email) => { sent.push(email); };
await solution([{ email: 'a@x.com' }, { email: 'b@x.com' }], sendEmail);
assert.deepEqual(sent.sort(), ['a@x.com', 'b@x.com']);`,
        },
        {
          name: 'does not resolve until the sends have finished',
          hidden: false,
          code: `let completed = 0;
const sendEmail = async () => {
  await helpers.sleep(30);
  completed += 1;
};
await solution([{ email: 'a' }, { email: 'b' }, { email: 'c' }], sendEmail);
assert.equal(completed, 3, 'resolved before the sends completed');`,
        },
        {
          name: 'returns how many were sent',
          hidden: false,
          code: `const result = await solution([{ email: 'a' }, { email: 'b' }], async () => {});
assert.equal(result, 2);`,
        },
        {
          name: 'rejects when a send fails',
          hidden: true,
          code: `await assert.rejects(
  () => solution([{ email: 'a' }], async () => { throw new Error('smtp down'); }),
  'smtp down',
);`,
        },
        {
          name: 'sends concurrently rather than one at a time',
          hidden: true,
          code: `const start = Date.now();
const sendEmail = async () => { await helpers.sleep(40); };
await solution([{ email: 'a' }, { email: 'b' }, { email: 'c' }], sendEmail);
const elapsed = Date.now() - start;
assert.ok(elapsed < 110, \`expected concurrent sends, took \${elapsed}ms\`);`,
        },
        {
          name: 'handles an empty list',
          hidden: true,
          code: `assert.equal(await solution([], async () => {}), 0);`,
        },
      ],
    },
  ],
};

/** Attaches debugging exercises to the concept they belong to. */
export function debuggingExercisesFor(
  technologySlug: string,
  conceptSlug: string,
): SeedExerciseInput[] {
  return DEBUGGING_EXERCISES[`${technologySlug}:${conceptSlug}`] ?? [];
}
