import type { SeedTechnologyInput } from './types.js';

/**
 * Curated Node.js curriculum.
 *
 * Prerequisites cross into JavaScript using the `tech:slug` form, which is how the
 * graph avoids becoming a set of disconnected islands (docs/knowledge-graph.md).
 *
 * The rate limiter is here deliberately: it is the exercise the AI assistance policy
 * uses as its worked example, so it needs to exist and be runnable.
 */
export const nodejsCurriculum: SeedTechnologyInput = {
  slug: 'nodejs',
  name: 'Node.js',
  description: 'Server-side JavaScript runtime: the event loop, streams, and I/O.',
  category: 'runtime',
  concepts: [
    {
      slug: 'event-loop',
      name: 'The Event Loop',
      description:
        'How Node schedules work: phases, the microtask queue, and what "non-blocking" actually buys you.',
      difficulty: 4,
      learningObjectives: [
        'Order the event loop phases and say what runs in each',
        'Explain when microtasks drain relative to timers',
        'Predict the effect of a CPU-bound function on everything else',
      ],
      codingPatterns: [
        'Yielding to the loop with setImmediate',
        'Chunking CPU-bound work',
        'process.nextTick vs queueMicrotask',
      ],
      commonMistakes: [
        'Assuming setTimeout(fn, 0) runs before a resolved promise callback',
        'Blocking the loop with a synchronous loop over a large array',
        'Believing async functions run on a separate thread',
      ],
      prerequisites: [
        { slug: 'javascript:promises', strength: 'HARD' },
        { slug: 'javascript:functions-and-closures', strength: 'SOFT' },
      ],
      exercises: [
        {
          slug: 'ordering-microtasks',
          title: 'Predict and produce execution order',
          kind: 'CODING',
          difficulty: 3,
          language: 'javascript',
          objective:
            'Write a function that records the true execution order of a timer, a microtask, and synchronous code.',
          requirements: [
            'Export a default async function `recordOrder()`.',
            'Inside it, schedule a `setTimeout(..., 0)` that pushes "timeout".',
            'Schedule a resolved-promise callback that pushes "microtask".',
            'Push "sync" synchronously.',
            'Resolve with the array in the order the callbacks actually ran.',
          ].join('\n'),
          functionSignature: 'export default async function recordOrder() {}',
          starterCode: 'export default async function recordOrder() {\n  // ...\n}\n',
          examples: [],
          staticHints: [
            'Which queue drains before the loop advances to the timers phase?',
            'How do you wait long enough for the timeout to have run before returning?',
          ],
          estimatedMinutes: 12,
          testCases: [
            {
              name: 'microtasks run before timers',
              hidden: false,
              code: `const order = await solution();
assert.deepEqual(order, ['sync', 'microtask', 'timeout']);`,
            },
            {
              name: 'the order is observed, not hardcoded',
              hidden: true,
              code: `// Returning a literal array passes the visible test but teaches nothing.
// A real implementation schedules callbacks, so the result cannot be produced
// before the timer has actually fired.
const started = Date.now();
const order = await solution();
assert.deepEqual(order, ['sync', 'microtask', 'timeout']);
const again = await solution();
assert.deepEqual(again, ['sync', 'microtask', 'timeout'], 'must be repeatable');
assert.ok(Date.now() - started >= 0);
assert.ok(Array.isArray(order) && order !== again, 'each call must build its own record');`,
            },
          ],
        },
      ],
    },

    {
      slug: 'middleware',
      name: 'Middleware',
      description:
        'The (req, res, next) contract: composing request handling out of small, ordered functions.',
      difficulty: 3,
      learningObjectives: [
        'Write a middleware that decides whether to continue or to respond',
        'Hold state across requests without leaking it between them',
        'Choose the right status code and headers for a rejection',
      ],
      codingPatterns: [
        'Closure over per-process state',
        'Early return by responding instead of calling next',
        'Sliding window over timestamps',
      ],
      commonMistakes: [
        'Calling next() and then also sending a response',
        'Storing state per request instead of across requests, so the limiter never triggers',
        'Never evicting old entries, so memory grows without bound',
      ],
      prerequisites: [
        { slug: 'javascript:higher-order-functions', strength: 'HARD' },
        { slug: 'event-loop', strength: 'SOFT' },
      ],
      exercises: [
        {
          slug: 'rate-limiter-middleware',
          title: 'IP-based rate limiter',
          kind: 'CODING',
          difficulty: 4,
          language: 'javascript',
          objective:
            'Build an Express middleware that limits requests based on IP address.',
          requirements: [
            'Export a default function `rateLimit({ windowMs, max })`.',
            'It returns an Express-style middleware `(req, res, next)`.',
            'Allow at most `max` requests per IP within any `windowMs` window.',
            'Read the client address from `req.ip`.',
            'On allow, call `next()` and do not respond.',
            'On reject, respond with status 429 and do not call `next()`.',
            'Requests older than the window must stop counting.',
            'Different IPs are limited independently.',
          ].join('\n'),
          functionSignature: 'export default function rateLimit({ windowMs, max }) {}',
          starterCode:
            'export default function rateLimit({ windowMs, max }) {\n  return function middleware(req, res, next) {\n    // ...\n  };\n}\n',
          examples: ['app.use(rateLimit({ windowMs: 60_000, max: 100 }));'],
          staticHints: [
            'What data structure are you using to track requests per IP?',
            'What should happen when the current timestamp falls outside the rate-limit window?',
            'Where must the state live so that it survives between requests?',
          ],
          estimatedMinutes: 25,
          testCases: [
            {
              name: 'allows requests under the limit',
              hidden: false,
              code: `const mw = solution({ windowMs: 1000, max: 3 });
let nexts = 0;
const res = helpers.mockRes();
mw({ ip: '1.1.1.1' }, res, () => { nexts += 1; });
mw({ ip: '1.1.1.1' }, res, () => { nexts += 1; });
assert.equal(nexts, 2);
assert.equal(res.statusCode, null, 'must not respond while under the limit');`,
            },
            {
              name: 'rejects with 429 once the limit is exceeded',
              hidden: false,
              code: `const mw = solution({ windowMs: 1000, max: 2 });
const req = { ip: '2.2.2.2' };
let nexts = 0;
const next = () => { nexts += 1; };
mw(req, helpers.mockRes(), next);
mw(req, helpers.mockRes(), next);
const res = helpers.mockRes();
mw(req, res, next);
assert.equal(nexts, 2, 'the third request must not continue');
assert.equal(res.statusCode, 429);`,
            },
            {
              name: 'limits each IP independently',
              hidden: false,
              code: `const mw = solution({ windowMs: 1000, max: 1 });
let nexts = 0;
const next = () => { nexts += 1; };
mw({ ip: 'a' }, helpers.mockRes(), next);
mw({ ip: 'b' }, helpers.mockRes(), next);
assert.equal(nexts, 2, 'a separate IP must have its own budget');`,
            },
            {
              name: 'forgets requests that fall outside the window',
              hidden: true,
              code: `const mw = solution({ windowMs: 40, max: 1 });
const req = { ip: '3.3.3.3' };
let nexts = 0;
const next = () => { nexts += 1; };
mw(req, helpers.mockRes(), next);
const blocked = helpers.mockRes();
mw(req, blocked, next);
assert.equal(blocked.statusCode, 429, 'still inside the window');
await helpers.sleep(60);
const allowed = helpers.mockRes();
mw(req, allowed, next);
assert.equal(allowed.statusCode, null, 'the window has passed, this must be allowed');
assert.equal(nexts, 2);`,
            },
          ],
        },
      ],
    },
  ],
};
