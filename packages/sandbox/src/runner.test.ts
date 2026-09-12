import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type SandboxOptions, detectPermissionFlag, runInSandbox } from './runner.js';

/**
 * These tests execute real child processes. They are slower than unit tests and
 * they are worth it: the isolation guarantees are the ones that matter most, and
 * asserting them against a mock would prove nothing.
 */

let workDir: string;
let options: SandboxOptions;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'forge-sandbox-test-'));
  const permissionFlag = await detectPermissionFlag();

  options = {
    workDir,
    timeoutMs: 5_000,
    maxMemoryMb: 128,
    maxOutputBytes: 8_192,
    permissionFlag,
  };
});

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true });
});

const counterTests = [
  {
    name: 'increments from zero',
    hidden: false,
    code: `const next = solution();
assert.equal(next(), 1);
assert.equal(next(), 2);`,
  },
  {
    name: 'counters are independent',
    hidden: true,
    code: `const a = solution();
const b = solution();
a(); a();
assert.equal(b(), 1);`,
  },
];

describe('runInSandbox: correct solutions', () => {
  it('passes every case for a correct implementation', async () => {
    const result = await runInSandbox(
      {
        language: 'javascript',
        code: `export default function createCounter(start = 0) {
  let count = start;
  return () => ++count;
}`,
        testCases: counterTests,
      },
      options,
    );

    expect(result.status).toBe('PASSED');
    expect(result.passed).toBe(true);
    expect(result.testsPassed).toBe(2);
    expect(result.testsTotal).toBe(2);
  }, 20_000);

  it('supports async solutions and awaited assertions', async () => {
    const result = await runInSandbox(
      {
        language: 'javascript',
        code: `export default async function double(n) { return n * 2; }`,
        testCases: [
          {
            name: 'doubles',
            hidden: false,
            code: `assert.equal(await solution(21), 42);`,
          },
        ],
      },
      options,
    );

    expect(result.passed).toBe(true);
  }, 20_000);
});

describe('runInSandbox: failing solutions', () => {
  it('reports which cases failed and why', async () => {
    const result = await runInSandbox(
      {
        language: 'javascript',
        code: `export default function createCounter() {
  let count = 0;
  return () => count;
}`,
        testCases: counterTests,
      },
      options,
    );

    expect(result.status).toBe('FAILED');
    expect(result.passed).toBe(false);
    expect(result.testsPassed).toBe(0);
    expect(result.cases[0]?.error).toContain('Expected 1');
    expect(result.cases[0]?.expected).toBe('1');
    expect(result.cases[0]?.received).toBe('0');
  }, 20_000);

  it('keeps running later cases after an earlier one fails', async () => {
    const result = await runInSandbox(
      {
        language: 'javascript',
        code: `export default () => 1;`,
        testCases: [
          { name: 'fails', hidden: false, code: `assert.equal(solution(), 2);` },
          { name: 'passes', hidden: false, code: `assert.equal(solution(), 1);` },
        ],
      },
      options,
    );

    expect(result.testsTotal).toBe(2);
    expect(result.testsPassed).toBe(1);
    expect(result.cases[1]?.passed).toBe(true);
  }, 20_000);

  it('classifies a syntax error as COMPILE_ERROR, not a crash', async () => {
    const result = await runInSandbox(
      {
        language: 'javascript',
        code: `export default function ( { this is not javascript`,
        testCases: counterTests,
      },
      options,
    );

    expect(result.status).toBe('COMPILE_ERROR');
    expect(result.stderr.length).toBeGreaterThan(0);
  }, 20_000);

  it('tells the user plainly when nothing was exported', async () => {
    const result = await runInSandbox(
      {
        language: 'javascript',
        code: `const createCounter = () => {};`,
        testCases: counterTests,
      },
      options,
    );

    expect(result.status).toBe('COMPILE_ERROR');
    expect(result.stderr).toContain('export default');
  }, 20_000);
});

describe('runInSandbox: isolation guarantees', () => {
  it('kills an infinite loop at the timeout', async () => {
    const result = await runInSandbox(
      {
        language: 'javascript',
        code: `export default function spin() { while (true) {} }`,
        testCases: [{ name: 'spins', hidden: false, code: `solution();` }],
      },
      { ...options, timeoutMs: 1_500 },
    );

    expect(result.status).toBe('TIMEOUT');
    expect(result.passed).toBe(false);
  }, 20_000);

  it('does not let the parent process be affected by a user crash', async () => {
    const result = await runInSandbox(
      {
        language: 'javascript',
        code: `process.exit(1); export default () => 1;`,
        testCases: [{ name: 'never runs', hidden: false, code: `assert.ok(true);` }],
      },
      options,
    );

    // The parent is still alive to make this assertion, which is the point.
    expect(result.passed).toBe(false);
    expect(['RUNTIME_ERROR', 'COMPILE_ERROR', 'MEMORY_EXCEEDED']).toContain(result.status);
  }, 20_000);

  it('does not leak parent environment variables to user code', async () => {
    process.env.FORGE_SECRET_CANARY = 'super-secret-value';

    const result = await runInSandbox(
      {
        language: 'javascript',
        code: `export default () => process.env.FORGE_SECRET_CANARY ?? 'absent';`,
        testCases: [
          {
            name: 'cannot read parent secrets',
            hidden: true,
            code: `assert.equal(solution(), 'absent');`,
          },
        ],
      },
      options,
    );

    delete process.env.FORGE_SECRET_CANARY;
    expect(result.passed).toBe(true);
  }, 20_000);

  it('captures console output instead of letting it corrupt the result channel', async () => {
    const result = await runInSandbox(
      {
        language: 'javascript',
        code: `export default function noisy() {
  console.log('}{ not json at all ]]');
  console.log('{"outcome":"COMPLETED","cases":[]}');
  return 7;
}`,
        testCases: [{ name: 'returns 7', hidden: false, code: `assert.equal(solution(), 7);` }],
      },
      options,
    );

    expect(result.passed).toBe(true);
    expect(result.stdout).toContain('not json at all');
  }, 20_000);

  it('truncates runaway output rather than buffering without bound', async () => {
    const result = await runInSandbox(
      {
        language: 'javascript',
        code: `export default function flood() {
  for (let i = 0; i < 20000; i += 1) console.log('x'.repeat(200));
  return 1;
}`,
        testCases: [{ name: 'floods', hidden: false, code: `assert.equal(solution(), 1);` }],
      },
      { ...options, maxOutputBytes: 4_096 },
    );

    expect(result.truncated).toBe(true);
    expect(result.stdout.length).toBeLessThan(6_000);
  }, 25_000);

  it('runs concurrent submissions without interference', async () => {
    const makeJob = (value: number) => ({
      language: 'javascript' as const,
      code: `export default () => ${value};`,
      testCases: [
        { name: `returns ${value}`, hidden: false, code: `assert.equal(solution(), ${value});` },
      ],
    });

    const results = await Promise.all([
      runInSandbox(makeJob(1), options),
      runInSandbox(makeJob(2), options),
      runInSandbox(makeJob(3), options),
    ]);

    expect(results.every((r) => r.passed)).toBe(true);
  }, 30_000);
});

describe('runInSandbox: harness helpers', () => {
  it('provides sleep for timing-sensitive exercises', async () => {
    const result = await runInSandbox(
      {
        language: 'javascript',
        code: `export default function debounce(fn, wait) {
  let timer;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
  wrapped.cancel = () => clearTimeout(timer);
  return wrapped;
}`,
        testCases: [
          {
            name: 'collapses rapid calls',
            hidden: false,
            code: `let calls = 0;
const d = solution(() => { calls += 1; }, 30);
d(); d(); d();
await helpers.sleep(80);
assert.equal(calls, 1);`,
          },
        ],
      },
      options,
    );

    expect(result.passed).toBe(true);
  }, 20_000);

  it('provides an Express-like response double for middleware exercises', async () => {
    const result = await runInSandbox(
      {
        language: 'javascript',
        code: `export default function rateLimit({ windowMs, max }) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const recent = (hits.get(req.ip) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= max) { res.status(429).json({ error: 'Too many requests' }); return; }
    recent.push(now);
    hits.set(req.ip, recent);
    next();
  };
}`,
        testCases: [
          {
            name: 'rejects over the limit with 429',
            hidden: false,
            code: `const mw = solution({ windowMs: 1000, max: 1 });
const req = { ip: '1.1.1.1' };
let nexts = 0;
mw(req, helpers.mockRes(), () => { nexts += 1; });
const res = helpers.mockRes();
mw(req, res, () => { nexts += 1; });
assert.equal(nexts, 1);
assert.equal(res.statusCode, 429);`,
          },
        ],
      },
      options,
    );

    expect(result.passed).toBe(true);
  }, 20_000);

  it('deepEqual distinguishes Dates, Maps and Sets from plain objects', async () => {
    const result = await runInSandbox(
      {
        language: 'javascript',
        code: `export default (v) => v;`,
        testCases: [
          {
            name: 'structural comparison',
            hidden: false,
            code: `assert.deepEqual(solution({ a: [1, 2] }), { a: [1, 2] });
assert.deepEqual(solution(new Map([['k', 1]])), new Map([['k', 1]]));
assert.deepEqual(solution(new Set([1])), new Set([1]));
assert.throws(() => assert.deepEqual({ a: 1 }, { a: 2 }));`,
          },
        ],
      },
      options,
    );

    expect(result.passed).toBe(true);
  }, 20_000);
});

describe('detectPermissionFlag', () => {
  it('returns a flag this runtime actually accepts, or null', async () => {
    const flag = await detectPermissionFlag();

    expect([null, '--permission', '--experimental-permission']).toContain(flag);
  }, 20_000);

  it('resolves to the same answer every time', async () => {
    const [a, b] = await Promise.all([detectPermissionFlag(), detectPermissionFlag()]);

    expect(a).toBe(b);
  }, 20_000);

  it('reports null rather than throwing when the executable is missing', async () => {
    // A wrong NODE path must degrade to "no isolation" with a warning, not
    // crash every submission.
    expect(await detectPermissionFlag('definitely-not-a-real-node-binary')).toBeNull();
  }, 20_000);

  it('never returns a flag the runtime rejects', async () => {
    // The bug this guards: Node renamed --experimental-permission to
    // --permission in 23.5+. Probing only one name silently disables
    // filesystem isolation on every version that uses the other.
    const flag = await detectPermissionFlag();
    if (flag === null) return;

    const result = await runInSandbox(
      {
        language: 'javascript',
        code: 'export default () => 42;',
        testCases: [
          {
            name: 'runs under the permission model',
            hidden: false,
            code: 'assert.equal(solution(), 42);',
          },
        ],
      },
      { ...options, permissionFlag: flag },
    );

    expect(result.status).toBe('PASSED');
  }, 20_000);

  it('still executes correctly with the permission model disabled', async () => {
    const result = await runInSandbox(
      {
        language: 'javascript',
        code: 'export default () => 42;',
        testCases: [{ name: 'runs', hidden: false, code: 'assert.equal(solution(), 42);' }],
      },
      { ...options, permissionFlag: null },
    );

    expect(result.status).toBe('PASSED');
  }, 20_000);
});
