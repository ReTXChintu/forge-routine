import type { SeedTechnologyInput } from './types.js';

/**
 * Curated JavaScript curriculum.
 *
 * Hand-written rather than generated because this is the technology the first user
 * starts on, and the quality of the first three exercises decides whether they trust
 * the product. The §42 recall exercises live here: debounce, throttle, deep clone,
 * Promise.all, event emitter, memoise, retry with backoff.
 *
 * Test-case `code` is the body of `async (solution, assert, helpers) => { ... }`,
 * executed inside the sandbox. It must throw on failure.
 */
export const javascriptCurriculum: SeedTechnologyInput = {
  slug: 'javascript',
  name: 'JavaScript',
  description: 'The language underneath everything else in the stack.',
  category: 'language',
  concepts: [
    {
      slug: 'functions-and-closures',
      name: 'Functions and Closures',
      description:
        'How functions capture the scope they were defined in, and why that capture is the foundation of almost every JavaScript pattern worth knowing.',
      difficulty: 2,
      learningObjectives: [
        'Explain what a closure captures and when the captured value is read',
        'Use a closure to hold private state across calls',
        'Recognise closures inside loops and the classic var/let difference',
      ],
      codingPatterns: [
        'Factory function returning a closure over private state',
        'Module pattern',
        'Partial application',
      ],
      commonMistakes: [
        'Capturing a loop variable declared with var and reading the final value',
        'Assuming the closure copies the value rather than the binding',
        'Creating a new closure per render or per call and losing the retained state',
      ],
      prerequisites: [],
      exercises: [
        {
          slug: 'counter-factory',
          title: 'Counter factory',
          kind: 'CODING',
          difficulty: 1,
          language: 'javascript',
          objective:
            'Write a factory that returns independent counter functions, each with its own private count.',
          requirements: [
            'Export a default function `createCounter(start = 0)`.',
            'Calling the returned function increments the count and returns the new value.',
            'Two counters created separately must not share state.',
            'The count must not be reachable from outside the returned function.',
          ].join('\n'),
          functionSignature: 'export default function createCounter(start = 0) {}',
          starterCode:
            'export default function createCounter(start = 0) {\n  // Keep the count private to this call.\n}\n',
          examples: [
            'const next = createCounter();\nnext(); // 1\nnext(); // 2',
            'const a = createCounter(10);\nconst b = createCounter(10);\na(); // 11\nb(); // 11',
          ],
          staticHints: [
            'What survives after the outer function returns?',
            'Where must the variable be declared so that only the inner function can reach it?',
          ],
          estimatedMinutes: 8,
          testCases: [
            {
              name: 'increments from zero by default',
              hidden: false,
              code: `const next = solution();
assert.equal(next(), 1, 'first call');
assert.equal(next(), 2, 'second call');
assert.equal(next(), 3, 'third call');`,
            },
            {
              name: 'honours the starting value',
              hidden: false,
              code: `const next = solution(10);
assert.equal(next(), 11);`,
            },
            {
              name: 'counters are independent',
              hidden: false,
              code: `const a = solution();
const b = solution();
a(); a(); a();
assert.equal(b(), 1, 'b must not see a\\'s increments');`,
            },
            {
              name: 'state is not exposed as a property',
              hidden: true,
              code: `const next = solution();
next();
assert.equal(next.count, undefined, 'count must be private, not a property');`,
            },
          ],
        },
      ],
    },

    {
      slug: 'higher-order-functions',
      name: 'Higher-Order Functions',
      description:
        'Functions that take or return other functions, and the wrapping patterns built on them.',
      difficulty: 2,
      learningObjectives: [
        'Wrap a function while preserving its arguments, `this`, and return value',
        'Decide what a wrapper should return before the wrapped function has run',
      ],
      codingPatterns: [
        'Decorator/wrapper',
        'Rest and spread forwarding',
        'Cache keyed by arguments',
      ],
      commonMistakes: [
        'Dropping `this` when forwarding the call',
        'Forgetting that the wrapper must return something before the inner call happens',
        'Keying a cache on a value that stringifies identically for different inputs',
      ],
      prerequisites: [{ slug: 'functions-and-closures', strength: 'HARD' }],
      exercises: [
        {
          slug: 'memoize',
          title: 'Implement memoize',
          kind: 'CODING',
          difficulty: 3,
          language: 'javascript',
          objective: 'Implement a memoize function that caches results by argument list.',
          requirements: [
            'Export a default function `memoize(fn)`.',
            'Return a wrapped function that calls `fn` at most once per distinct argument list.',
            'Repeated calls with the same arguments return the cached value without calling `fn` again.',
            'Different argument lists must not collide.',
          ].join('\n'),
          functionSignature: 'export default function memoize(fn) {}',
          starterCode: 'export default function memoize(fn) {\n  // ...\n}\n',
          examples: [
            'const slow = (n) => n * 2;\nconst fast = memoize(slow);\nfast(2); // 4, computed\nfast(2); // 4, cached',
          ],
          staticHints: [
            'What structure maps an argument list to a result?',
            'Two different calls must produce two different keys — what happens with (1,2) and (12)?',
          ],
          estimatedMinutes: 12,
          testCases: [
            {
              name: 'returns the same result as the wrapped function',
              hidden: false,
              code: `const memo = solution((n) => n * 3);
assert.equal(memo(4), 12);`,
            },
            {
              name: 'calls the wrapped function only once per distinct input',
              hidden: false,
              code: `let calls = 0;
const memo = solution((n) => { calls += 1; return n * 2; });
memo(5); memo(5); memo(5);
assert.equal(calls, 1, 'expected exactly one underlying call');
assert.equal(memo(5), 10);`,
            },
            {
              name: 'distinguishes different arguments',
              hidden: false,
              code: `let calls = 0;
const memo = solution((n) => { calls += 1; return n; });
memo(1); memo(2); memo(3);
assert.equal(calls, 3);`,
            },
            {
              name: 'does not collide on multi-argument calls',
              hidden: true,
              code: `const memo = solution((a, b) => \`\${a}|\${b}\`);
assert.equal(memo(1, 2), '1|2');
assert.equal(memo(12, undefined), '12|undefined', 'keys for (1,2) and (12) must differ');`,
            },
          ],
        },
      ],
    },

    {
      slug: 'timers-and-scheduling',
      name: 'Timers and Scheduling',
      description:
        'setTimeout, clearTimeout, and the rate-control patterns every frontend and backend eventually needs.',
      difficulty: 3,
      learningObjectives: [
        'Cancel and reschedule a pending timer correctly',
        'Distinguish debouncing from throttling and choose between them',
        'Preserve the most recent arguments across a delayed call',
      ],
      codingPatterns: ['Debounce', 'Throttle', 'Trailing-edge invocation'],
      commonMistakes: [
        'Forgetting to clear the previous timer, so every call fires',
        'Capturing the first call arguments instead of the latest',
        'Confusing debounce (wait for quiet) with throttle (at most once per window)',
      ],
      prerequisites: [{ slug: 'higher-order-functions', strength: 'HARD' }],
      exercises: [
        {
          slug: 'debounce',
          title: 'Implement debounce',
          kind: 'CODING',
          difficulty: 3,
          language: 'javascript',
          objective:
            'Write a debounce function from scratch: delay invocation until calls stop for a given wait.',
          requirements: [
            'Export a default function `debounce(fn, wait)`.',
            'Rapid successive calls must result in exactly one invocation of `fn`.',
            'The invocation happens `wait` ms after the *last* call.',
            'The invocation receives the arguments of the last call.',
            'The returned function must expose a `cancel()` that prevents a pending invocation.',
          ].join('\n'),
          functionSignature: 'export default function debounce(fn, wait) {}',
          starterCode:
            'export default function debounce(fn, wait) {\n  // Return a function that delays calling fn.\n}\n',
          examples: [
            'const save = debounce(persist, 200);\nsave(1); save(2); save(3);\n// 200ms after save(3): persist(3) runs once',
          ],
          staticHints: [
            'What do you need to keep between calls so the next call can cancel the previous one?',
            'Which call’s arguments should reach fn — the first or the last?',
          ],
          estimatedMinutes: 15,
          testCases: [
            {
              name: 'does not call immediately',
              hidden: false,
              code: `let calls = 0;
const d = solution(() => { calls += 1; }, 50);
d();
assert.equal(calls, 0, 'debounced function must not run synchronously');`,
            },
            {
              name: 'collapses rapid calls into one invocation',
              hidden: false,
              code: `let calls = 0;
const d = solution(() => { calls += 1; }, 30);
d(); d(); d(); d();
await helpers.sleep(80);
assert.equal(calls, 1, 'expected exactly one call after the quiet period');`,
            },
            {
              name: 'passes the latest arguments',
              hidden: false,
              code: `let received = null;
const d = solution((v) => { received = v; }, 30);
d(1); d(2); d(3);
await helpers.sleep(80);
assert.equal(received, 3, 'expected the arguments of the final call');`,
            },
            {
              name: 'runs again after a quiet period',
              hidden: false,
              code: `let calls = 0;
const d = solution(() => { calls += 1; }, 25);
d();
await helpers.sleep(60);
d();
await helpers.sleep(60);
assert.equal(calls, 2);`,
            },
            {
              name: 'cancel() prevents a pending invocation',
              hidden: true,
              code: `let calls = 0;
const d = solution(() => { calls += 1; }, 30);
d();
assert.equal(typeof d.cancel, 'function', 'expected a cancel method');
d.cancel();
await helpers.sleep(70);
assert.equal(calls, 0, 'cancel must prevent the pending call');`,
            },
          ],
        },
      ],
    },

    {
      slug: 'promises',
      name: 'Promises',
      description:
        'The promise state machine, composition, and what it actually takes to implement the combinators yourself.',
      difficulty: 3,
      learningObjectives: [
        'Describe the three promise states and the transitions between them',
        'Compose concurrent work without losing result order',
        'Reject as early as possible without leaving work unaccounted for',
      ],
      codingPatterns: ['Promise.all', 'Sequential vs concurrent execution', 'Settled counter'],
      commonMistakes: [
        'Resolving with results in completion order instead of input order',
        'Awaiting inside a loop and serialising work that could be concurrent',
        'Never resolving on an empty input array',
      ],
      prerequisites: [{ slug: 'functions-and-closures', strength: 'HARD' }],
      exercises: [
        {
          slug: 'promise-all',
          title: 'Implement Promise.all',
          kind: 'CODING',
          difficulty: 4,
          language: 'javascript',
          objective: 'Implement Promise.all from scratch, without using Promise.all.',
          requirements: [
            'Export a default function `promiseAll(items)`.',
            'Resolve with an array of results in the same order as the input.',
            'All items must run concurrently, not one after another.',
            'Reject immediately with the first rejection reason.',
            'Resolve with an empty array when given an empty input.',
            'Non-promise values are allowed and pass through.',
          ].join('\n'),
          functionSignature: 'export default function promiseAll(items) {}',
          starterCode: 'export default function promiseAll(items) {\n  // ...\n}\n',
          examples: ['await promiseAll([Promise.resolve(1), 2, Promise.resolve(3)]); // [1, 2, 3]'],
          staticHints: [
            'How do you know when the last one has finished, given they finish out of order?',
            'Where should each result be written so the output order matches the input order?',
          ],
          estimatedMinutes: 20,
          testCases: [
            {
              name: 'resolves in input order, not completion order',
              hidden: false,
              code: `const slow = new Promise((res) => setTimeout(() => res('slow'), 40));
const fast = Promise.resolve('fast');
const result = await solution([slow, fast]);
assert.deepEqual(result, ['slow', 'fast'], 'order must follow the input array');`,
            },
            {
              name: 'runs concurrently rather than sequentially',
              hidden: false,
              code: `const start = Date.now();
const make = () => new Promise((res) => setTimeout(res, 40));
await solution([make(), make(), make()]);
const elapsed = Date.now() - start;
assert.ok(elapsed < 110, \`expected concurrent execution, took \${elapsed}ms\`);`,
            },
            {
              name: 'passes non-promise values through',
              hidden: false,
              code: `assert.deepEqual(await solution([1, Promise.resolve(2), 3]), [1, 2, 3]);`,
            },
            {
              name: 'resolves to an empty array for empty input',
              hidden: false,
              code: `assert.deepEqual(await solution([]), []);`,
            },
            {
              name: 'rejects with the first rejection reason',
              hidden: true,
              code: `await assert.rejects(
  () => solution([Promise.resolve(1), Promise.reject(new Error('boom')), Promise.resolve(3)]),
  'boom',
);`,
            },
          ],
        },
      ],
    },

    {
      slug: 'objects-and-references',
      name: 'Objects and References',
      description:
        'Reference semantics, structural copying, and the edge cases that break naive clone implementations.',
      difficulty: 3,
      learningObjectives: [
        'Distinguish shallow from deep copying',
        'Handle arrays, dates, maps, sets, and cycles when copying',
        'Recognise when JSON round-tripping is not good enough',
      ],
      codingPatterns: ['Recursive traversal', 'Seen-set for cycle detection', 'Type dispatch'],
      commonMistakes: [
        'Using JSON.parse(JSON.stringify(x)) and silently losing Dates, Maps, and undefined',
        'Infinite recursion on a cyclic object',
        'Copying an array into a plain object',
      ],
      prerequisites: [],
      exercises: [
        {
          slug: 'deep-clone',
          title: 'Implement deep clone',
          kind: 'CODING',
          difficulty: 4,
          language: 'javascript',
          objective:
            'Implement a deep clone that handles nested objects, arrays, Dates, Maps, Sets, and cycles.',
          requirements: [
            'Export a default function `deepClone(value)`.',
            'Nested objects and arrays must be copied, not shared.',
            'Date, Map, and Set instances must be cloned as the same type.',
            'Cyclic references must not cause infinite recursion, and must stay cyclic in the copy.',
            'Primitives are returned as-is.',
            'Do not use JSON.parse/JSON.stringify or structuredClone.',
          ].join('\n'),
          functionSignature: 'export default function deepClone(value) {}',
          starterCode: 'export default function deepClone(value) {\n  // ...\n}\n',
          examples: ['const copy = deepClone({ a: { b: [1, 2] } });\ncopy.a.b !== original.a.b'],
          staticHints: [
            'What do you need to remember while recursing so a cycle terminates?',
            'How do you tell an Array from a Date from a plain object?',
          ],
          estimatedMinutes: 25,
          testCases: [
            {
              name: 'returns primitives unchanged',
              hidden: false,
              code: `assert.equal(solution(42), 42);
assert.equal(solution('x'), 'x');
assert.equal(solution(null), null);`,
            },
            {
              name: 'copies nested objects rather than sharing them',
              hidden: false,
              code: `const original = { a: { b: { c: 1 } } };
const copy = solution(original);
assert.deepEqual(copy, original);
copy.a.b.c = 99;
assert.equal(original.a.b.c, 1, 'mutating the copy must not touch the original');`,
            },
            {
              name: 'copies arrays as arrays',
              hidden: false,
              code: `const copy = solution({ list: [1, [2, 3]] });
assert.ok(Array.isArray(copy.list), 'expected an array');
assert.ok(Array.isArray(copy.list[1]), 'expected a nested array');
assert.deepEqual(copy.list, [1, [2, 3]]);`,
            },
            {
              name: 'clones Dates, Maps, and Sets as their own types',
              hidden: true,
              code: `const d = new Date('2026-01-01T00:00:00Z');
const copy = solution({ d, m: new Map([['k', 1]]), s: new Set([1, 2]) });
assert.ok(copy.d instanceof Date, 'Date must stay a Date');
assert.equal(copy.d.getTime(), d.getTime());
assert.ok(copy.m instanceof Map, 'Map must stay a Map');
assert.equal(copy.m.get('k'), 1);
assert.ok(copy.s instanceof Set, 'Set must stay a Set');
assert.ok(copy.s.has(2));`,
            },
            {
              name: 'survives a cyclic reference',
              hidden: true,
              code: `const node = { name: 'root' };
node.self = node;
const copy = solution(node);
assert.equal(copy.name, 'root');
assert.ok(copy.self === copy, 'the cycle must be preserved and point at the copy');`,
            },
          ],
        },
      ],
    },

    {
      slug: 'event-emitter',
      name: 'The Observer Pattern',
      description:
        'Publish/subscribe as implemented by Node’s EventEmitter, and the bookkeeping it requires.',
      difficulty: 3,
      learningObjectives: [
        'Maintain listener lists keyed by event name',
        'Remove exactly the right listener, including during emission',
        'Implement once() in terms of on() and off()',
      ],
      codingPatterns: ['Listener registry', 'Self-removing listener', 'Snapshot before iterate'],
      commonMistakes: [
        'Mutating the listener array while iterating it during emit',
        'off() removing every listener instead of the one supplied',
        'once() leaking the wrapper so off() with the original function does nothing',
      ],
      prerequisites: [{ slug: 'objects-and-references', strength: 'HARD' }],
      exercises: [
        {
          slug: 'event-emitter',
          title: 'Implement an event emitter',
          kind: 'CODING',
          difficulty: 3,
          language: 'javascript',
          objective: 'Build an event emitter supporting on, off, once, and emit.',
          requirements: [
            'Export a default class `EventEmitter`.',
            '`on(event, listener)` registers a listener.',
            '`off(event, listener)` removes that specific listener only.',
            '`once(event, listener)` fires at most once.',
            '`emit(event, ...args)` calls listeners in registration order and returns whether any ran.',
            'Removing a listener during emit must not skip the next listener.',
          ].join('\n'),
          functionSignature: 'export default class EventEmitter {}',
          starterCode: 'export default class EventEmitter {\n  // ...\n}\n',
          examples: [
            "const bus = new EventEmitter();\nbus.on('tick', (n) => console.log(n));\nbus.emit('tick', 1);",
          ],
          staticHints: [
            'What data structure maps an event name to many listeners?',
            'What happens to the loop index if a listener removes itself mid-emit?',
          ],
          estimatedMinutes: 20,
          testCases: [
            {
              name: 'calls registered listeners with the emitted arguments',
              hidden: false,
              code: `const Bus = solution;
const bus = new Bus();
let seen = null;
bus.on('x', (a, b) => { seen = [a, b]; });
bus.emit('x', 1, 2);
assert.deepEqual(seen, [1, 2]);`,
            },
            {
              name: 'calls listeners in registration order',
              hidden: false,
              code: `const bus = new solution();
const order = [];
bus.on('x', () => order.push('first'));
bus.on('x', () => order.push('second'));
bus.emit('x');
assert.deepEqual(order, ['first', 'second']);`,
            },
            {
              name: 'off removes only the given listener',
              hidden: false,
              code: `const bus = new solution();
let a = 0, b = 0;
const fnA = () => { a += 1; };
const fnB = () => { b += 1; };
bus.on('x', fnA);
bus.on('x', fnB);
bus.off('x', fnA);
bus.emit('x');
assert.equal(a, 0, 'removed listener must not run');
assert.equal(b, 1, 'remaining listener must still run');`,
            },
            {
              name: 'once fires exactly once',
              hidden: false,
              code: `const bus = new solution();
let calls = 0;
bus.once('x', () => { calls += 1; });
bus.emit('x');
bus.emit('x');
bus.emit('x');
assert.equal(calls, 1);`,
            },
            {
              name: 'removing a listener during emit does not skip the next one',
              hidden: true,
              code: `const bus = new solution();
const ran = [];
const first = () => { ran.push('first'); bus.off('x', first); };
const second = () => { ran.push('second'); };
bus.on('x', first);
bus.on('x', second);
bus.emit('x');
assert.deepEqual(ran, ['first', 'second'], 'the second listener must still run');`,
            },
          ],
        },
      ],
    },

    {
      slug: 'async-error-handling',
      name: 'Async Error Handling',
      description: 'Retries, backoff, and deciding what is worth retrying at all.',
      difficulty: 4,
      learningObjectives: [
        'Implement bounded retries with exponential backoff',
        'Distinguish attempts from retries when counting',
        'Surface the final error rather than swallowing it',
      ],
      codingPatterns: ['Exponential backoff', 'Bounded retry loop', 'Error propagation'],
      commonMistakes: [
        'Off-by-one between "3 retries" and "3 attempts"',
        'Retrying forever because the failure is permanent',
        'Losing the original error and throwing a generic one',
      ],
      prerequisites: [{ slug: 'promises', strength: 'HARD' }],
      exercises: [
        {
          slug: 'retry-with-backoff',
          title: 'Retry with exponential backoff',
          kind: 'CODING',
          difficulty: 4,
          language: 'javascript',
          objective:
            'Implement a retry helper with exponential backoff that gives up after a bounded number of attempts.',
          requirements: [
            'Export a default async function `retry(fn, { attempts = 3, baseDelayMs = 10 } = {})`.',
            '`attempts` is the total number of calls, not the number of retries after the first.',
            'Wait `baseDelayMs * 2 ** (attemptIndex)` between attempts.',
            'Resolve with the first successful result.',
            'Reject with the final error if every attempt fails.',
            'Do not wait after the final failed attempt.',
          ].join('\n'),
          functionSignature:
            'export default async function retry(fn, { attempts = 3, baseDelayMs = 10 } = {}) {}',
          starterCode:
            'export default async function retry(fn, { attempts = 3, baseDelayMs = 10 } = {}) {\n  // ...\n}\n',
          examples: ['await retry(() => fetchFlaky(), { attempts: 4, baseDelayMs: 50 });'],
          staticHints: [
            'If attempts is 3, how many times does fn run in the worst case?',
            'After the last failure, is there anything left to wait for?',
          ],
          estimatedMinutes: 18,
          testCases: [
            {
              name: 'returns immediately on first success',
              hidden: false,
              code: `let calls = 0;
const result = await solution(async () => { calls += 1; return 'ok'; });
assert.equal(result, 'ok');
assert.equal(calls, 1);`,
            },
            {
              name: 'retries until it succeeds',
              hidden: false,
              code: `let calls = 0;
const result = await solution(async () => {
  calls += 1;
  if (calls < 3) throw new Error('flaky');
  return 'ok';
}, { attempts: 5, baseDelayMs: 1 });
assert.equal(result, 'ok');
assert.equal(calls, 3);`,
            },
            {
              name: 'treats attempts as total calls',
              hidden: false,
              code: `let calls = 0;
await assert.rejects(
  () => solution(async () => { calls += 1; throw new Error('always'); }, { attempts: 3, baseDelayMs: 1 }),
  'always',
);
assert.equal(calls, 3, 'attempts: 3 must mean exactly 3 calls');`,
            },
            {
              name: 'rejects with the final error',
              hidden: true,
              code: `let n = 0;
await assert.rejects(
  () => solution(async () => { n += 1; throw new Error('fail-' + n); }, { attempts: 2, baseDelayMs: 1 }),
  'fail-2',
);`,
            },
            {
              name: 'delay grows exponentially',
              hidden: true,
              code: `const start = Date.now();
await assert.rejects(
  () => solution(async () => { throw new Error('x'); }, { attempts: 3, baseDelayMs: 20 }),
  'x',
);
const elapsed = Date.now() - start;
// Waits after attempt 1 and 2 only: 20 + 40 = 60ms, never after the last.
assert.ok(elapsed >= 50, \`expected backoff waits, took \${elapsed}ms\`);
assert.ok(elapsed < 200, \`expected no wait after the final attempt, took \${elapsed}ms\`);`,
            },
          ],
        },
      ],
    },
  ],
};
