import { existsSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { AIContractViolation, AIUnavailable, describeAIFailure } from '../ai-provider.port.js';

import { CODEX_DEFAULT_MODEL, CodexProvider } from './codex.provider.js';

/**
 * ChatGPT through the Codex CLI, driven against a **stub CLI**.
 *
 * Same reasoning as the Claude Code tests: a test that needed Codex installed
 * and signed in would not run on CI and would spend the user's plan on every
 * run. The stub is `node -e`, handed the real argument list, and behaves like
 * Codex where it matters — it drains stdin, prints JSON events, and writes its
 * final answer to the file named after `-o`. So the argument list, the schema
 * file, the answer file and the clean-up are all exercised for real.
 */

const ctx = { userId: 'u1', agent: 'test', promptVersion: 'v1' };

const prompt = (content = 'Say hello', system?: string) => ({
  model: 'fast' as const,
  messages: [
    ...(system ? [{ role: 'system' as const, content: system }] : []),
    { role: 'user' as const, content },
  ],
});

interface StubBehaviour {
  /**
   * Written to the `-o` file. `'echo'` writes back what the stub was given;
   * `'schema'` answers `{"answer": <the schema file's text>}`.
   */
  answer?: string | 'echo' | 'schema' | null;
  /** JSON events printed on stdout, one per line. */
  events?: unknown[];
  stderr?: string;
  exitCode?: number;
  /** Never exits, for the timeout case. */
  hang?: boolean;
}

/**
 * A Codex stand-in. With `answer: 'echo'` the answer is a JSON record of the
 * stdin, the schema file and the working directory, so a case can assert what
 * the real CLI would have been given.
 */
function stubScript(behaviour: StubBehaviour): string {
  return `
const fs = require('fs');
const argv = process.argv;
const after = (flag) => { const i = argv.indexOf(flag); return i < 0 ? null : argv[i + 1]; };
const b = ${JSON.stringify(behaviour)};
let input = '';
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  if (b.hang) { setInterval(() => {}, 1000); return; }
  const out = after('-o');
  const schemaPath = after('--output-schema');
  if (b.answer === 'echo') {
    fs.writeFileSync(out, JSON.stringify({
      stdin: input,
      schema: schemaPath ? JSON.parse(fs.readFileSync(schemaPath, 'utf8')) : null,
      cwd: process.cwd(),
    }));
  } else if (b.answer === 'schema') {
    fs.writeFileSync(out, JSON.stringify({ answer: fs.readFileSync(schemaPath, 'utf8') }));
  } else if (typeof b.answer === 'string') {
    fs.writeFileSync(out, b.answer);
  }
  for (const e of b.events || []) process.stdout.write(JSON.stringify(e) + '\\n');
  if (b.stderr) process.stderr.write(b.stderr);
  process.exit(b.exitCode || 0);
});`;
}

/** Subclassed rather than mocked: only the program at the end of the pipe is fake. */
class StubbedCodex extends CodexProvider {
  lastArgs: string[] = [];

  constructor(
    private readonly script: string,
    timeoutMs = 20_000,
    modelFast = CODEX_DEFAULT_MODEL,
  ) {
    super({ modelFast, modelReasoning: CODEX_DEFAULT_MODEL, timeoutMs, binary: process.execPath });
  }

  protected override cliArgs(args: string[]): string[] {
    this.lastArgs = args;
    return ['-e', this.script, '--', ...args];
  }
}

const withStub = (behaviour: StubBehaviour, timeoutMs?: number, modelFast?: string) =>
  new StubbedCodex(stubScript(behaviour), timeoutMs, modelFast);

async function failureOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return describeAIFailure(error);
  }

  throw new Error('expected a failure');
}

const USAGE_EVENTS = [
  { type: 'thread.started' },
  { type: 'turn.started' },
  {
    type: 'turn.completed',
    usage: { input_tokens: 15_491, cached_input_tokens: 1_408, output_tokens: 42 },
  },
];

describe('Codex as a provider', () => {
  it('answers from the -o file, with the token counts from the final event', async () => {
    const provider = withStub({ answer: '  hello there\n', events: USAGE_EVENTS });

    const result = await provider.generate({ prompt: prompt(), context: ctx });

    expect(result.text).toBe('hello there');
    expect(result.model).toBe(CODEX_DEFAULT_MODEL);
    // Face value: cached tokens are a subset of input, so they are not added.
    expect(result.usage).toEqual({ promptTokens: 15_491, completionTokens: 42 });
  });

  it('runs read-only, ephemeral, in a scratch directory, reading the prompt from stdin', async () => {
    const provider = withStub({ answer: 'echo' });

    const result = await provider.generate({ prompt: prompt('Q?', 'Be brief.'), context: ctx });
    const seen = JSON.parse(result.text) as { stdin: string; cwd: string };

    const args = provider.lastArgs;
    expect(args[0]).toBe('exec');
    expect(args).toEqual(
      expect.arrayContaining(['--json', '--ephemeral', '--skip-git-repo-check']),
    );
    expect(args[args.indexOf('--sandbox') + 1]).toBe('read-only');
    expect(args.at(-1)).toBe('-');
    // The default model is Codex's own choice, so no -m is passed.
    expect(args).not.toContain('-m');

    // No system-prompt flag exists, so the instructions lead the input.
    expect(seen.stdin).toBe('Be brief.\n\n---\n\nQ?');

    // The scratch directory is the working directory, and is gone afterwards.
    expect(args[args.indexOf('-C') + 1]).toBe(seen.cwd);
    expect(existsSync(seen.cwd)).toBe(false);
  });

  it('passes a named model, and a per-call override wins over it', async () => {
    const named = withStub({ answer: 'ok' }, undefined, 'gpt-5-codex');
    await named.generate({ prompt: prompt(), context: ctx });
    expect(named.lastArgs[named.lastArgs.indexOf('-m') + 1]).toBe('gpt-5-codex');

    const overridden = withStub({ answer: 'ok' }, undefined, 'gpt-5-codex');
    const result = await overridden.generate({
      prompt: prompt(),
      context: { ...ctx, modelOverride: 'gpt-5' },
    });
    expect(overridden.lastArgs[overridden.lastArgs.indexOf('-m') + 1]).toBe('gpt-5');
    expect(result.model).toBe('gpt-5');
  });

  it('hands the schema over as a strict file and parses the answer against it', async () => {
    const schema = z.object({ answer: z.string(), hint: z.string().optional() });
    const provider = withStub({ answer: 'schema' });

    const result = await provider.structured({
      prompt: prompt(),
      schema,
      schemaName: 'probe',
      context: ctx,
    });
    const fileSchema = JSON.parse(result.data.answer) as Record<string, unknown>;

    // Strict: every property required (the optional one made nullable), nothing extra.
    expect(fileSchema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: expect.arrayContaining(['answer', 'hint']),
    });
    expect(provider.lastArgs).toContain('--output-schema');
  });

  it('removes the nulls strict mode forced onto optional fields', async () => {
    const schema = z.object({ answer: z.string(), hint: z.string().optional() });
    const provider = withStub({ answer: '{"answer":"42","hint":null}', events: USAGE_EVENTS });

    const result = await provider.structured({
      prompt: prompt(),
      schema,
      schemaName: 'probe',
      context: ctx,
    });

    expect(result.data).toEqual({ answer: '42' });
    expect(result.repairAttempts).toBe(0);
    expect(result.usage.completionTokens).toBe(42);
  });

  it('refuses an answer that is not JSON, or not the right shape', async () => {
    const schema = z.object({ answer: z.string() });

    await expect(
      withStub({ answer: 'sure, here you go' }).structured({
        prompt: prompt(),
        schema,
        schemaName: 'probe',
        context: ctx,
      }),
    ).rejects.toBeInstanceOf(AIContractViolation);

    await expect(
      withStub({ answer: '{"answer":7}' }).structured({
        prompt: prompt(),
        schema,
        schemaName: 'probe',
        context: ctx,
      }),
    ).rejects.toBeInstanceOf(AIContractViolation);
  });

  it("reports the CLI's own error event when it fails", async () => {
    const provider = withStub({
      exitCode: 1,
      events: [
        { type: 'turn.failed', error: { message: 'You are not signed in. Run codex login.' } },
      ],
    });

    const message = await failureOf(() => provider.generate({ prompt: prompt(), context: ctx }));

    expect(message).toContain('exit 1');
    expect(message).toContain('codex login');
  });

  it('falls back to stderr when there are no events to explain a failure', async () => {
    const provider = withStub({ exitCode: 2, stderr: 'error: unexpected argument' });

    const message = await failureOf(() => provider.generate({ prompt: prompt(), context: ctx }));

    expect(message).toContain('unexpected argument');
  });

  it('treats a clean exit with no answer file as a failure, not an empty answer', async () => {
    const provider = withStub({ answer: null });

    await expect(provider.generate({ prompt: prompt(), context: ctx })).rejects.toBeInstanceOf(
      AIUnavailable,
    );
  });

  it('says how to fix a missing CLI instead of "spawn ENOENT"', async () => {
    const provider = new CodexProvider({
      modelFast: CODEX_DEFAULT_MODEL,
      modelReasoning: CODEX_DEFAULT_MODEL,
      timeoutMs: 5_000,
      binary: 'definitely-not-a-real-codex-binary',
    });

    const message = await failureOf(() => provider.generate({ prompt: prompt(), context: ctx }));

    expect(message).not.toContain('ENOENT');
    expect(message).toMatch(/Codex/);
  });

  it('gives up on a CLI that never finishes', async () => {
    const provider = withStub({ hang: true }, 1_500);

    const message = await failureOf(() => provider.generate({ prompt: prompt(), context: ctx }));

    expect(message).toContain('did not finish');
  });

  it('streams the whole answer as one chunk, then done', async () => {
    const provider = withStub({ answer: 'all at once' });

    const chunks = [];
    for await (const chunk of provider.stream({ prompt: prompt(), context: ctx }))
      chunks.push(chunk);

    expect(chunks).toEqual([
      { delta: 'all at once', done: false },
      { delta: '', done: true },
    ]);
  });

  it('offers only the default model, and no embeddings', async () => {
    const provider = withStub({});

    expect(await provider.listModels(ctx)).toEqual([
      { id: CODEX_DEFAULT_MODEL, label: 'Codex default model' },
    ]);
    await expect(provider.embed({ texts: ['x'], context: ctx } as never)).rejects.toBeInstanceOf(
      AIUnavailable,
    );
  });
});
