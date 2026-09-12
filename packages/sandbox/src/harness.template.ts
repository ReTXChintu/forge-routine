/**
 * The sandbox harness, as a string so it is always available to the runner
 * regardless of how the package was bundled or where it was installed from.
 *
 * It is written into each run directory and executed by a short-lived child
 * process. It imports the user's solution and the exercise's test cases, runs
 * each case, and writes the result to `result.json`.
 *
 * The result never travels over stdout: user code is free to print anything,
 * including a stray `}`, and a contaminated protocol channel would turn a user
 * mistake into a harness error.
 */
export const HARNESS_SOURCE = `import { writeFileSync } from 'node:fs';

const RESULT_PATH = new URL('./result.json', import.meta.url);
const MAX_OUTPUT = Number(process.env.FORGE_MAX_OUTPUT ?? 65536);

// Capture anything the solution prints. Keeping it out of the real stdout means
// the parent never has to disentangle user output from protocol data.
let captured = '';
let consoleCalls = 0;
let outputTruncated = false;

function capture(...args) {
  consoleCalls += 1;
  if (captured.length >= MAX_OUTPUT) {
    outputTruncated = true;
    return;
  }
  const line = args
    .map((a) => {
      if (typeof a === 'string') return a;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(' ');
  captured += line + '\\n';
  if (captured.length > MAX_OUTPUT) {
    captured = captured.slice(0, MAX_OUTPUT);
    outputTruncated = true;
  }
}

console.log = capture;
console.info = capture;
console.warn = capture;
console.error = capture;
console.debug = capture;

class AssertionFailure extends Error {
  constructor(message, expected, received) {
    super(message);
    this.name = 'AssertionFailure';
    this.expected = expected;
    this.received = received;
  }
}

function show(value) {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'function') return '[Function]';
  if (value instanceof Error) return value.name + ': ' + value.message;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function deepEquals(a, b) {
  if (Object.is(a, b)) return true;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (a instanceof Map && b instanceof Map) {
    if (a.size !== b.size) return false;
    for (const [k, v] of a) if (!b.has(k) || !deepEquals(v, b.get(k))) return false;
    return true;
  }
  if (a instanceof Set && b instanceof Set) {
    if (a.size !== b.size) return false;
    for (const v of a) if (!b.has(v)) return false;
    return true;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEquals(a[k], b[k]));
}

const assert = {
  ok(value, message) {
    if (!value) throw new AssertionFailure(message ?? 'Expected a truthy value', 'truthy', show(value));
  },
  equal(received, expected, message) {
    if (!Object.is(received, expected)) {
      throw new AssertionFailure(
        message ?? 'Expected ' + show(expected) + ' but received ' + show(received),
        show(expected),
        show(received),
      );
    }
  },
  deepEqual(received, expected, message) {
    if (!deepEquals(received, expected)) {
      throw new AssertionFailure(
        message ?? 'Expected ' + show(expected) + ' but received ' + show(received),
        show(expected),
        show(received),
      );
    }
  },
  async rejects(fn, expectedMessage) {
    let threw = false;
    let error;
    try {
      await fn();
    } catch (e) {
      threw = true;
      error = e;
    }
    if (!threw) throw new AssertionFailure('Expected the call to reject, but it resolved');
    if (expectedMessage && !String(error?.message ?? error).includes(expectedMessage)) {
      throw new AssertionFailure(
        'Expected a rejection matching ' + show(expectedMessage) + ' but got ' + show(error?.message ?? error),
        expectedMessage,
        String(error?.message ?? error),
      );
    }
  },
  throws(fn, expectedMessage) {
    let threw = false;
    let error;
    try {
      fn();
    } catch (e) {
      threw = true;
      error = e;
    }
    if (!threw) throw new AssertionFailure('Expected the call to throw, but it returned');
    if (expectedMessage && !String(error?.message ?? error).includes(expectedMessage)) {
      throw new AssertionFailure(
        'Expected a throw matching ' + show(expectedMessage),
        expectedMessage,
        String(error?.message ?? error),
      );
    }
  },
};

const helpers = {
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  /** Minimal Express-like response double for middleware exercises. */
  mockRes() {
    return {
      statusCode: null,
      body: null,
      headers: {},
      status(code) {
        this.statusCode = code;
        return this;
      },
      set(key, value) {
        this.headers[key] = value;
        return this;
      },
      setHeader(key, value) {
        this.headers[key] = value;
        return this;
      },
      json(payload) {
        this.body = payload;
        if (this.statusCode === null) this.statusCode = 200;
        return this;
      },
      send(payload) {
        this.body = payload;
        if (this.statusCode === null) this.statusCode = 200;
        return this;
      },
      end() {
        if (this.statusCode === null) this.statusCode = 200;
        return this;
      },
    };
  },
};

function write(payload) {
  writeFileSync(RESULT_PATH, JSON.stringify(payload));
}

async function main() {
  let solution;
  let cases;

  let mod;
  try {
    mod = await import('./solution.mjs');
  } catch (error) {
    write({
      outcome: 'COMPILE_ERROR',
      message: error?.message ?? String(error),
      stack: String(error?.stack ?? ''),
      cases: [],
      stdout: captured,
      consoleCalls,
      outputTruncated,
    });
    return;
  }

  // Be precise about a missing default export. Falling back to the module namespace
  // object would be truthy, and the user would then face a confusing assertion
  // failure instead of being told the actual problem.
  if (mod.default === undefined) {
    const named = Object.keys(mod).filter((k) => k !== 'default');
    write({
      outcome: 'COMPILE_ERROR',
      message:
        named.length === 0
          ? 'Your file does not export anything. Add \`export default\` to the function being tested.'
          : 'No default export found. Found named exports (' +
            named.join(', ') +
            '), but the tests need \`export default\`.',
      cases: [],
      stdout: captured,
      consoleCalls,
      outputTruncated,
    });
    return;
  }

  solution = mod.default;

  try {
    ({ cases } = await import('./tests.mjs'));
  } catch (error) {
    write({
      outcome: 'HARNESS_ERROR',
      message: 'Failed to load test cases: ' + (error?.message ?? String(error)),
      cases: [],
      stdout: captured,
      consoleCalls,
      outputTruncated,
    });
    return;
  }

  const results = [];

  for (const testCase of cases) {
    const startedAt = Date.now();
    try {
      await testCase.run(solution, assert, helpers);
      results.push({ name: testCase.name, hidden: testCase.hidden, passed: true, durationMs: Date.now() - startedAt });
    } catch (error) {
      results.push({
        name: testCase.name,
        hidden: testCase.hidden,
        passed: false,
        durationMs: Date.now() - startedAt,
        error: error?.message ?? String(error),
        expected: error?.expected,
        received: error?.received,
        isAssertion: error?.name === 'AssertionFailure',
      });
    }
  }

  write({
    outcome: 'COMPLETED',
    cases: results,
    stdout: captured,
    consoleCalls,
    outputTruncated,
  });
}

main().catch((error) => {
  write({
    outcome: 'HARNESS_ERROR',
    message: error?.message ?? String(error),
    stack: String(error?.stack ?? ''),
    cases: [],
    stdout: captured,
    consoleCalls,
    outputTruncated,
  });
});
`;

/** Builds `tests.mjs` from the exercise's stored test cases. */
export function buildTestsModule(
  cases: readonly { name: string; hidden: boolean; code: string }[],
): string {
  const entries = cases
    .map(
      (testCase) =>
        `  {\n` +
        `    name: ${JSON.stringify(testCase.name)},\n` +
        `    hidden: ${testCase.hidden ? 'true' : 'false'},\n` +
        `    run: async (solution, assert, helpers) => {\n${testCase.code}\n    },\n` +
        `  },`,
    )
    .join('\n');

  return `export const cases = [\n${entries}\n];\n`;
}
