import type { SeedExerciseInput } from './types.js';

/**
 * Additional §42 recall exercises, kept separate from the concept definitions so
 * the curriculum file stays readable as it grows.
 *
 * Keyed by `technologySlug:conceptSlug`.
 */
export const EXTRA_EXERCISES: Record<string, SeedExerciseInput[]> = {
  'javascript:timers-and-scheduling': [
    {
      slug: 'throttle',
      title: 'Implement throttle',
      kind: 'CODING',
      difficulty: 3,
      language: 'javascript',
      objective:
        'Write a throttle function: allow at most one call per interval, no matter how often it is invoked.',
      requirements: [
        'Export a default function `throttle(fn, interval)`.',
        'The first call runs immediately.',
        'Further calls within `interval` ms are ignored, not queued.',
        'Once the interval has passed, the next call runs immediately again.',
        'The wrapped function receives the arguments of the call that actually ran.',
      ].join('\n'),
      functionSignature: 'export default function throttle(fn, interval) {}',
      starterCode: 'export default function throttle(fn, interval) {\n  // ...\n}\n',
      examples: [
        'const onScroll = throttle(measure, 100);\n// 50 calls in 100ms → measure runs once',
      ],
      staticHints: [
        'What do you need to remember between calls to know whether the interval has passed?',
        'Throttle drops calls; debounce postpones them. Which is being asked for here?',
      ],
      estimatedMinutes: 15,
      testCases: [
        {
          name: 'runs the first call immediately',
          hidden: false,
          code: `let calls = 0;
const t = solution(() => { calls += 1; }, 50);
t();
assert.equal(calls, 1, 'throttle runs on the leading edge');`,
        },
        {
          name: 'ignores calls inside the interval',
          hidden: false,
          code: `let calls = 0;
const t = solution(() => { calls += 1; }, 60);
t(); t(); t(); t();
assert.equal(calls, 1);`,
        },
        {
          name: 'allows another call after the interval',
          hidden: false,
          code: `let calls = 0;
const t = solution(() => { calls += 1; }, 40);
t();
await helpers.sleep(70);
t();
assert.equal(calls, 2);`,
        },
        {
          name: 'passes through the arguments of the call that ran',
          hidden: true,
          code: `let seen = null;
const t = solution((v) => { seen = v; }, 50);
t('first');
t('ignored');
assert.equal(seen, 'first');`,
        },
        {
          name: 'drops rather than queues — a suppressed call never fires late',
          hidden: true,
          code: `let calls = 0;
const t = solution(() => { calls += 1; }, 40);
t(); t(); t();
await helpers.sleep(100);
assert.equal(calls, 1, 'suppressed calls must be dropped, not deferred');`,
        },
      ],
    },
  ],

  'javascript:higher-order-functions': [
    {
      slug: 'curry',
      title: 'Implement curry',
      kind: 'CODING',
      difficulty: 4,
      language: 'javascript',
      objective:
        'Write a curry function that accepts arguments one at a time until the original arity is satisfied.',
      requirements: [
        'Export a default function `curry(fn)`.',
        'Calling with fewer arguments than `fn.length` returns a function awaiting the rest.',
        'Calling with enough arguments invokes `fn` and returns its result.',
        'Arguments may arrive in any grouping: f(1)(2)(3), f(1, 2)(3) and f(1)(2, 3) are equivalent.',
        'A partially applied function may be reused for several completions.',
      ].join('\n'),
      functionSignature: 'export default function curry(fn) {}',
      starterCode: 'export default function curry(fn) {\n  // ...\n}\n',
      examples: [
        'const add = curry((a, b, c) => a + b + c);\nadd(1)(2)(3); // 6\nadd(1, 2)(3); // 6',
      ],
      staticHints: [
        'How do you know how many arguments the original function still needs?',
        'What must a partial application close over, and what must it not share?',
      ],
      estimatedMinutes: 20,
      testCases: [
        {
          name: 'applies one argument at a time',
          hidden: false,
          code: `const add = solution((a, b, c) => a + b + c);
assert.equal(add(1)(2)(3), 6);`,
        },
        {
          name: 'accepts any grouping of arguments',
          hidden: false,
          code: `const add = solution((a, b, c) => a + b + c);
assert.equal(add(1, 2)(3), 6);
assert.equal(add(1)(2, 3), 6);
assert.equal(add(1, 2, 3), 6);`,
        },
        {
          name: 'a partial application can be reused',
          hidden: true,
          code: `const add = solution((a, b, c) => a + b + c);
const addOne = add(1);
assert.equal(addOne(2)(3), 6);
assert.equal(addOne(10)(100), 111, 'reusing a partial must not accumulate state');`,
        },
        {
          name: 'works for a single-argument function',
          hidden: true,
          code: `const double = solution((n) => n * 2);
assert.equal(double(21), 42);`,
        },
      ],
    },
  ],

  'javascript:objects-and-references': [
    {
      slug: 'lru-cache',
      title: 'Implement an LRU cache',
      kind: 'CODING',
      difficulty: 4,
      language: 'javascript',
      objective:
        'Build a fixed-capacity cache that evicts the least recently used entry when it is full.',
      requirements: [
        'Export a default class `LRUCache` constructed with a capacity.',
        '`get(key)` returns the value, or undefined if absent, and counts as a use.',
        '`set(key, value)` inserts or updates, and counts as a use.',
        'When capacity is exceeded, evict the least recently used key.',
        'Expose a `size` property.',
      ].join('\n'),
      functionSignature: 'export default class LRUCache { constructor(capacity) {} }',
      starterCode:
        'export default class LRUCache {\n  constructor(capacity) {\n    // ...\n  }\n}\n',
      examples: [
        'const cache = new LRUCache(2);\ncache.set("a", 1);\ncache.set("b", 2);\ncache.get("a");\ncache.set("c", 3); // evicts "b", not "a"',
      ],
      staticHints: [
        'Which JavaScript structure already preserves insertion order and lets you delete by key?',
        'A read has to change the order too. How do you move an existing key to the most-recent end?',
      ],
      estimatedMinutes: 25,
      testCases: [
        {
          name: 'stores and retrieves values',
          hidden: false,
          code: `const Cache = solution;
const cache = new Cache(2);
cache.set('a', 1);
assert.equal(cache.get('a'), 1);
assert.equal(cache.get('missing'), undefined);`,
        },
        {
          name: 'evicts the least recently used entry at capacity',
          hidden: false,
          code: `const cache = new solution(2);
cache.set('a', 1);
cache.set('b', 2);
cache.set('c', 3);
assert.equal(cache.get('a'), undefined, 'a was least recently used');
assert.equal(cache.get('b'), 2);
assert.equal(cache.get('c'), 3);`,
        },
        {
          name: 'a read counts as a use',
          hidden: false,
          code: `const cache = new solution(2);
cache.set('a', 1);
cache.set('b', 2);
cache.get('a');
cache.set('c', 3);
assert.equal(cache.get('a'), 1, 'reading a should have protected it');
assert.equal(cache.get('b'), undefined);`,
        },
        {
          name: 'updating an existing key does not grow the cache',
          hidden: true,
          code: `const cache = new solution(2);
cache.set('a', 1);
cache.set('a', 2);
assert.equal(cache.size, 1);
assert.equal(cache.get('a'), 2);`,
        },
        {
          name: 'handles capacity 1',
          hidden: true,
          code: `const cache = new solution(1);
cache.set('a', 1);
cache.set('b', 2);
assert.equal(cache.get('a'), undefined);
assert.equal(cache.get('b'), 2);
assert.equal(cache.size, 1);`,
        },
      ],
    },
  ],

  'javascript:promises': [
    {
      slug: 'async-pool',
      title: 'Limit concurrency',
      kind: 'CODING',
      difficulty: 5,
      language: 'javascript',
      objective:
        'Run a list of async tasks with at most N in flight at any moment, preserving result order.',
      requirements: [
        'Export a default async function `pool(tasks, limit)` where each task is a zero-argument function returning a promise.',
        'At most `limit` tasks may be running at once.',
        'Resolve with results in the same order as the input.',
        'Start the next task as soon as a slot frees, not in fixed batches.',
        'Reject if any task rejects.',
      ].join('\n'),
      functionSignature: 'export default async function pool(tasks, limit) {}',
      starterCode: 'export default async function pool(tasks, limit) {\n  // ...\n}\n',
      examples: ['await pool([fetchA, fetchB, fetchC, fetchD], 2); // never more than 2 at once'],
      staticHints: [
        'How would you know, at any instant, how many tasks are currently running?',
        'Batching is easier but slower. What has to happen the moment a single task finishes?',
      ],
      estimatedMinutes: 30,
      testCases: [
        {
          name: 'returns results in input order',
          hidden: false,
          code: `const tasks = [
  () => new Promise((r) => setTimeout(() => r('slow'), 40)),
  () => Promise.resolve('fast'),
];
assert.deepEqual(await solution(tasks, 2), ['slow', 'fast']);`,
        },
        {
          name: 'never exceeds the concurrency limit',
          hidden: false,
          code: `let running = 0;
let peak = 0;
const make = () => async () => {
  running += 1;
  peak = Math.max(peak, running);
  await helpers.sleep(20);
  running -= 1;
  return 1;
};
await solution([make(), make(), make(), make(), make(), make()], 2);
assert.ok(peak <= 2, \`peak concurrency was \${peak}, expected at most 2\`);`,
        },
        {
          name: 'handles an empty task list',
          hidden: false,
          code: `assert.deepEqual(await solution([], 3), []);`,
        },
        {
          name: 'rejects when a task rejects',
          hidden: true,
          code: `await assert.rejects(
  () => solution([async () => 1, async () => { throw new Error('nope'); }], 2),
  'nope',
);`,
        },
        {
          name: 'refills slots as they free rather than working in batches',
          hidden: true,
          code: `// Three 40ms tasks at limit 2: a batching implementation takes ~80ms,
// a correct one starts the third as soon as the first finishes.
const make = () => async () => { await helpers.sleep(40); return 1; };
const start = Date.now();
await solution([make(), make(), make()], 2);
const elapsed = Date.now() - start;
assert.ok(elapsed < 110, \`took \${elapsed}ms; slots should refill immediately\`);`,
        },
      ],
    },
  ],

  'nodejs:middleware': [
    {
      slug: 'cache-middleware',
      title: 'Response caching middleware',
      kind: 'CODING',
      difficulty: 4,
      language: 'javascript',
      objective: 'Build an Express middleware that caches GET responses in memory for a given TTL.',
      requirements: [
        'Export a default function `cacheMiddleware({ ttlMs })`.',
        'It returns an Express-style middleware `(req, res, next)`.',
        'Cache only GET requests; everything else calls `next()` untouched.',
        'The cache key is the request URL.',
        'On a hit, respond with the cached body and do not call `next()`.',
        'On a miss, call `next()` and capture whatever the handler passes to `res.json`.',
        'Entries expire after `ttlMs`.',
      ].join('\n'),
      functionSignature: 'export default function cacheMiddleware({ ttlMs }) {}',
      starterCode:
        'export default function cacheMiddleware({ ttlMs }) {\n  return function middleware(req, res, next) {\n    // ...\n  };\n}\n',
      examples: ['app.use(cacheMiddleware({ ttlMs: 30_000 }));'],
      staticHints: [
        'A miss has to capture the response the handler produces. How do you observe `res.json` being called?',
        'What distinguishes a cache entry that is still valid from one that has expired?',
      ],
      estimatedMinutes: 25,
      testCases: [
        {
          name: 'passes non-GET requests straight through',
          hidden: false,
          code: `const mw = solution({ ttlMs: 1000 });
let nexts = 0;
const res = helpers.mockRes();
mw({ method: 'POST', url: '/a' }, res, () => { nexts += 1; });
assert.equal(nexts, 1);
assert.equal(res.statusCode, null);`,
        },
        {
          name: 'calls through on a miss and serves the cached body on a hit',
          hidden: false,
          code: `const mw = solution({ ttlMs: 1000 });
const req = { method: 'GET', url: '/users' };

const first = helpers.mockRes();
let nexts = 0;
mw(req, first, () => { nexts += 1; first.json({ ok: true }); });
assert.equal(nexts, 1);
assert.deepEqual(first.body, { ok: true });

const second = helpers.mockRes();
mw(req, second, () => { nexts += 1; });
assert.equal(nexts, 1, 'a hit must not reach the handler');
assert.deepEqual(second.body, { ok: true });`,
        },
        {
          name: 'caches per URL',
          hidden: false,
          code: `const mw = solution({ ttlMs: 1000 });
let nexts = 0;
const handler = (res) => () => { nexts += 1; res.json({ url: 'x' }); };

const a = helpers.mockRes();
mw({ method: 'GET', url: '/a' }, a, handler(a));
const b = helpers.mockRes();
mw({ method: 'GET', url: '/b' }, b, handler(b));
assert.equal(nexts, 2, 'different URLs are different entries');`,
        },
        {
          name: 'entries expire after the TTL',
          hidden: true,
          code: `const mw = solution({ ttlMs: 40 });
const req = { method: 'GET', url: '/expiring' };
let nexts = 0;

const first = helpers.mockRes();
mw(req, first, () => { nexts += 1; first.json({ n: 1 }); });

await helpers.sleep(70);

const second = helpers.mockRes();
mw(req, second, () => { nexts += 1; second.json({ n: 2 }); });
assert.equal(nexts, 2, 'the entry should have expired');
assert.deepEqual(second.body, { n: 2 });`,
        },
      ],
    },
  ],
};

export function extraExercisesFor(
  technologySlug: string,
  conceptSlug: string,
): SeedExerciseInput[] {
  return EXTRA_EXERCISES[`${technologySlug}:${conceptSlug}`] ?? [];
}
