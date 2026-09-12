/**
 * Reference solutions, keyed by exercise slug.
 *
 * Two jobs:
 *
 *  1. They are what `SHOW_SOLUTION` serves when the user reaches the last rung
 *     of the assistance ladder, so the terminal step is not an empty promise.
 *  2. `reference-solutions.test.ts` executes every one of them against its own
 *     exercise's tests. An exercise whose tests cannot be satisfied is worse
 *     than no exercise: the user hunts for a mistake that is in *our* code.
 *
 * They are written the way a competent engineer would write them — not golfed,
 * not over-engineered — because the user reads them.
 */
export const REFERENCE_SOLUTIONS: Record<string, string> = {
  'counter-factory': `export default function createCounter(start = 0) {
  // The closure keeps \`count\` private: nothing outside can reach it.
  let count = start;
  return () => (count += 1);
}
`,

  memoize: `export default function memoize(fn) {
  const cache = new Map();

  return (...args) => {
    // JSON.stringify of the argument array keeps (1, 2) distinct from (12).
    const key = JSON.stringify(args);
    if (cache.has(key)) return cache.get(key);

    const result = fn(...args);
    cache.set(key, result);
    return result;
  };
}
`,

  debounce: `export default function debounce(fn, wait) {
  let timer;

  const debounced = (...args) => {
    // Clearing first is what collapses a burst into a single call.
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };

  debounced.cancel = () => clearTimeout(timer);

  return debounced;
}
`,

  throttle: `export default function throttle(fn, interval) {
  let lastRun = 0;

  return (...args) => {
    const now = Date.now();
    // Suppressed calls are dropped, not queued — that is what makes this
    // throttle rather than debounce.
    if (now - lastRun < interval) return;

    lastRun = now;
    return fn(...args);
  };
}
`,

  curry: `export default function curry(fn) {
  return function curried(...args) {
    if (args.length >= fn.length) return fn(...args);

    // A fresh closure per partial application, so reusing one does not
    // accumulate arguments from a previous completion.
    return (...rest) => curried(...args, ...rest);
  };
}
`,

  'promise-all': `export default function promiseAll(items) {
  return new Promise((resolve, reject) => {
    const results = new Array(items.length);
    let settled = 0;

    if (items.length === 0) {
      resolve([]);
      return;
    }

    items.forEach((item, index) => {
      // Promise.resolve normalises plain values, so they pass through.
      Promise.resolve(item).then((value) => {
        // Writing by index is what preserves input order despite
        // out-of-order completion.
        results[index] = value;
        settled += 1;
        if (settled === items.length) resolve(results);
      }, reject);
    });
  });
}
`,

  'deep-clone': `export default function deepClone(value, seen = new WeakMap()) {
  if (value === null || typeof value !== 'object') return value;

  // The seen-map terminates cycles and keeps shared references shared.
  if (seen.has(value)) return seen.get(value);

  if (value instanceof Date) return new Date(value.getTime());

  if (value instanceof Map) {
    const copy = new Map();
    seen.set(value, copy);
    for (const [k, v] of value) copy.set(deepClone(k, seen), deepClone(v, seen));
    return copy;
  }

  if (value instanceof Set) {
    const copy = new Set();
    seen.set(value, copy);
    for (const v of value) copy.add(deepClone(v, seen));
    return copy;
  }

  const copy = Array.isArray(value) ? [] : {};
  // Register before recursing, or a self-reference recurses forever.
  seen.set(value, copy);

  for (const [k, v] of Object.entries(value)) {
    copy[k] = deepClone(v, seen);
  }

  return copy;
}
`,

  'event-emitter': `export default class EventEmitter {
  #listeners = new Map();

  on(event, listener) {
    if (!this.#listeners.has(event)) this.#listeners.set(event, []);
    this.#listeners.get(event).push(listener);
    return this;
  }

  off(event, listener) {
    const listeners = this.#listeners.get(event);
    if (!listeners) return this;

    const index = listeners.indexOf(listener);
    if (index !== -1) listeners.splice(index, 1);
    return this;
  }

  once(event, listener) {
    const wrapper = (...args) => {
      // Remove before calling, so a listener that re-emits does not recurse.
      this.off(event, wrapper);
      listener(...args);
    };
    return this.on(event, wrapper);
  }

  emit(event, ...args) {
    const listeners = this.#listeners.get(event);
    if (!listeners || listeners.length === 0) return false;

    // Iterate a copy: a listener that removes itself must not shift the
    // array out from under the loop and skip the next one.
    for (const listener of [...listeners]) listener(...args);
    return true;
  }
}
`,

  'retry-with-backoff': `export default async function retry(fn, { attempts = 3, baseDelayMs = 10 } = {}) {
  let lastError;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // No wait after the final attempt: there is nothing left to wait for.
      if (attempt < attempts - 1) {
        const delay = baseDelayMs * 2 ** attempt;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}
`,

  'lru-cache': `export default class LRUCache {
  #capacity;
  #entries = new Map();

  constructor(capacity) {
    this.#capacity = capacity;
  }

  get size() {
    return this.#entries.size;
  }

  get(key) {
    if (!this.#entries.has(key)) return undefined;

    // A read counts as a use: delete and re-set moves it to the newest end,
    // because Map iterates in insertion order.
    const value = this.#entries.get(key);
    this.#entries.delete(key);
    this.#entries.set(key, value);
    return value;
  }

  set(key, value) {
    // Delete first so an update refreshes recency instead of growing the map.
    this.#entries.delete(key);
    this.#entries.set(key, value);

    if (this.#entries.size > this.#capacity) {
      const oldest = this.#entries.keys().next().value;
      this.#entries.delete(oldest);
    }

    return this;
  }
}
`,

  'async-pool': `export default async function pool(tasks, limit) {
  const results = new Array(tasks.length);
  let next = 0;

  // Each worker pulls the next index as soon as it is free, so a slot refills
  // immediately rather than waiting for a whole batch to drain.
  async function worker() {
    while (next < tasks.length) {
      const index = next;
      next += 1;
      results[index] = await tasks[index]();
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, worker);
  await Promise.all(workers);

  return results;
}
`,

  'ordering-microtasks': `export default async function recordOrder() {
  const order = [];

  setTimeout(() => order.push('timeout'), 0);
  Promise.resolve().then(() => order.push('microtask'));
  order.push('sync');

  // Wait past the timers phase so the timeout has genuinely run before we
  // report what happened.
  await new Promise((resolve) => setTimeout(resolve, 10));

  return order;
}
`,

  'rate-limiter-middleware': `export default function rateLimit({ windowMs, max }) {
  // State lives here, in the closure, so it survives between requests.
  const hits = new Map();

  return function middleware(req, res, next) {
    const now = Date.now();
    const recent = (hits.get(req.ip) ?? []).filter((time) => now - time < windowMs);

    if (recent.length >= max) {
      res.status(429).json({ error: 'Too many requests' });
      return;
    }

    recent.push(now);
    hits.set(req.ip, recent);
    next();
  };
}
`,

  'cache-middleware': `export default function cacheMiddleware({ ttlMs }) {
  const store = new Map();

  return function middleware(req, res, next) {
    if (req.method !== 'GET') {
      next();
      return;
    }

    const key = req.url;
    const entry = store.get(key);

    if (entry && Date.now() - entry.storedAt < ttlMs) {
      res.json(entry.body);
      return;
    }

    // Wrap res.json so the handler's response is captured on the way out.
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      store.set(key, { body, storedAt: Date.now() });
      return originalJson(body);
    };

    next();
  };
}
`,

  // -- Debugging exercises: the repaired code -------------------------------

  'debug-loop-closure': `export default function makeHandlers(items) {
  const handlers = [];

  // \`let\` creates a fresh binding per iteration, so each closure captures
  // its own \`i\` rather than sharing one that ends at items.length.
  for (let i = 0; i < items.length; i++) {
    handlers.push(() => items[i]);
  }

  return handlers;
}
`,

  'debug-splice-while-iterating': `export default function removeEvens(numbers) {
  // Building a new array sidesteps the problem entirely: nothing shifts
  // underneath the traversal.
  return numbers.filter((n) => n % 2 !== 0);
}
`,

  'debug-unawaited-async-map': `export default async function notifyAll(users, sendEmail) {
  // Promise.all waits for every send and propagates the first rejection,
  // so the returned count is a fact rather than a guess.
  await Promise.all(users.map((user) => sendEmail(user.email)));
  return users.length;
}
`,
};

export function referenceSolutionFor(slug: string): string | null {
  return REFERENCE_SOLUTIONS[slug] ?? null;
}
