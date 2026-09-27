import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { AIContractViolation, AIUnavailable, describeAIFailure } from '../ai-provider.port.js';

import { ClaudeCodeProvider, resolveBinary } from './claude-code.provider.js';

/**
 * The provider that runs a process instead of calling an endpoint.
 *
 * Driven against a **stub CLI** rather than the real one: a test that needed
 * Claude Code installed and signed in would not run on CI, would cost the
 * user's rate limit every time, and would fail for reasons that have nothing
 * to do with this code. What is under test is everything between the prompt
 * and the parsed object — argument construction, the stdin pipe, the result
 * envelope, and each way the CLI can let us down.
 *
 * The stub is `node -e`, so it exists wherever the tests do.
 */

const ctx = { userId: 'u1', agent: 'test', promptVersion: 'v1' };

const prompt = (content = 'Say hello') => ({
  model: 'fast' as const,
  messages: [{ role: 'user' as const, content }],
});

/**
 * The provider with its argument list swapped for `node -e <script>`.
 *
 * Subclassed rather than mocked, so the real spawning, stdin piping and
 * envelope parsing are what the tests exercise — only the program at the end
 * of the pipe is fake.
 */
class StubbedProvider extends ClaudeCodeProvider {
  /** Captured so a case can assert what the real CLI would have been told. */
  lastArgs: string[] = [];

  constructor(
    private readonly script: string,
    timeoutMs = 20_000,
  ) {
    super({ modelFast: 'haiku', modelReasoning: 'opus', timeoutMs, binary: process.execPath });
  }

  protected override cliArgs(args: string[]): string[] {
    this.lastArgs = args;
    return ['-e', this.script];
  }
}

const withStub = (script: string, timeoutMs?: number) => new StubbedProvider(script, timeoutMs);

const OK_RESULT = `{"type":"result","is_error":false,"result":"hi","structured_output":{"answer":"hi","score":3},"usage":{"input_tokens":9,"output_tokens":20,"cache_read_input_tokens":12000,"cache_creation_input_tokens":3000}}`;

/**
 * What the user would actually be shown for a thrown failure.
 *
 * `AIUnavailable`'s own message is deliberately generic — the vendor's words
 * live in its cause chain, and `describeAIFailure` is what lifts them out. So
 * asserting through it tests the thing that matters: that the detail reaches a
 * reader rather than only the logs.
 */
async function failureOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return describeAIFailure(error);
  }

  throw new Error('expected a failure');
}

/** Echoes a fixed envelope, after draining stdin as the real CLI does. */
const stubEmitting = (json: string) =>
  `let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{process.stdout.write(${JSON.stringify(json)});});`;

const schema = z.object({ answer: z.string(), score: z.number() });

describe('Claude Code as a provider', () => {
  it('parses the schema-validated object the CLI hands back', async () => {
    const provider = withStub(stubEmitting(OK_RESULT));

    const result = await provider.structured({
      prompt: prompt(),
      schema,
      schemaName: 'Answer',
      context: ctx,
    });

    expect(result.data).toEqual({ answer: 'hi', score: 3 });
    // Never repaired: the CLI validates before returning, so there is no
    // round trip to count.
    expect(result.repairAttempts).toBe(0);
  });

  it('counts cached context as prompt tokens', async () => {
    const provider = withStub(stubEmitting(OK_RESULT));

    const result = await provider.structured({
      prompt: prompt(),
      schema,
      schemaName: 'Answer',
      context: ctx,
    });

    // 9 + 3000 + 12000. Reporting 9 would hide the ~20k of Claude Code
    // harness every call actually carries, which is the one number that
    // makes this provider's cost legible.
    expect(result.usage.promptTokens).toBe(15_009);
    expect(result.usage.completionTokens).toBe(20);
  });

  it('sends the prompt over stdin, not as an argument', async () => {
    // The reason: free-form text with quotes and newlines, and on Windows the
    // CLI is a .cmd shim that Node refuses to spawn with such arguments at all.
    const echoStdin = `let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{process.stdout.write(JSON.stringify({type:'result',is_error:false,result:s,structured_output:{answer:s,score:1}}))});`;
    const provider = withStub(echoStdin);
    const awkward = 'He said "no" & ran\nthen: stopped';

    const result = await provider.structured({
      prompt: prompt(awkward),
      schema,
      schemaName: 'Answer',
      context: ctx,
    });

    expect(result.data.answer).toBe(awkward);
    expect(provider.lastArgs.join(' ')).not.toContain(awkward);
  });

  it('asks for JSON output and denies every tool', async () => {
    const provider = withStub(stubEmitting(OK_RESULT));

    await provider.structured({ prompt: prompt(), schema, schemaName: 'Answer', context: ctx });

    const args = provider.lastArgs;
    expect(args).toContain('-p');
    expect(args).toContain('--json-schema');
    expect(args[args.indexOf('--output-format') + 1]).toBe('json');

    // A coding agent left with its tools will use them, slowly, on whatever
    // is in the working directory.
    const denied = args[args.indexOf('--disallowedTools') + 1] ?? '';
    for (const tool of ['Bash', 'Read', 'Write', 'Edit', 'WebFetch', 'Task']) {
      expect(denied).toContain(tool);
    }
  });

  it('honours the tier, and a caller’s model override over it', async () => {
    const provider = withStub(stubEmitting(OK_RESULT));

    await provider.structured({ prompt: prompt(), schema, schemaName: 'A', context: ctx });
    expect(provider.lastArgs[provider.lastArgs.indexOf('--model') + 1]).toBe('haiku');

    await provider.structured({
      prompt: { ...prompt(), model: 'reasoning' },
      schema,
      schemaName: 'A',
      context: ctx,
    });
    expect(provider.lastArgs[provider.lastArgs.indexOf('--model') + 1]).toBe('opus');

    await provider.structured({
      prompt: prompt(),
      schema,
      schemaName: 'A',
      context: { ...ctx, modelOverride: 'sonnet' },
    });
    expect(provider.lastArgs[provider.lastArgs.indexOf('--model') + 1]).toBe('sonnet');
  });

  it('takes CLAUDE_CODE_BIN over any search', async () => {
    // The escape hatch for a layout the search does not know about, and for a
    // server process whose PATH does not include the CLI.
    const previous = process.env.CLAUDE_CODE_BIN;
    process.env.CLAUDE_CODE_BIN = process.execPath;

    try {
      // Cleared between assertions because a successful resolution is cached
      // for the process — which is correct, and would otherwise hide this.
      expect(await resolveBinary()).toBe(process.execPath);
    } finally {
      if (previous === undefined) delete process.env.CLAUDE_CODE_BIN;
      else process.env.CLAUDE_CODE_BIN = previous;
    }
  });

  it('reports a missing CLI as something the user can act on', async () => {
    const provider = new ClaudeCodeProvider({
      modelFast: 'haiku',
      modelReasoning: 'opus',
      timeoutMs: 10_000,
      binary: 'definitely-not-a-real-binary-xyz',
    });

    // "spawn ENOENT" tells a user nothing. Naming the CLI and what to do
    // about it is the whole point of catching this.
    const detail = await failureOf(() =>
      provider.structured({ prompt: prompt(), schema, schemaName: 'A', context: ctx }),
    );

    // "spawn ENOENT" tells a user nothing, and "install it" is wrong for the
    // common case: an installed CLI that a service process cannot see. So the
    // message has to name the way out and what it actually searched.
    expect(detail).toContain('Claude Code CLI');
    expect(detail).toContain('CLAUDE_CODE_BIN');
    expect(detail).toContain('Looked in:');
  });

  it('passes the CLI’s own words through when it does not return JSON', async () => {
    const provider = withStub(
      `process.stdin.resume();process.stdin.on('end',()=>{process.stdout.write('Invalid API key. Please run /login')});`,
    );

    // The failure before the envelope exists — not signed in, unknown model,
    // a flag this version lacks. Its text is the only useful thing here.
    const detail = await failureOf(() =>
      provider.structured({ prompt: prompt(), schema, schemaName: 'A', context: ctx }),
    );

    expect(detail).toContain('Invalid API key');
  });

  it('surfaces an error envelope rather than treating it as an answer', async () => {
    const provider = withStub(
      stubEmitting(
        `{"type":"result","is_error":true,"subtype":"error_during_execution","result":"rate limit reached"}`,
      ),
    );

    const detail = await failureOf(() =>
      provider.structured({ prompt: prompt(), schema, schemaName: 'A', context: ctx }),
    );

    expect(detail).toContain('rate limit reached');
  });

  it('fails the contract when the CLI returns no structured output', async () => {
    const provider = withStub(
      stubEmitting(`{"type":"result","is_error":false,"result":"some prose instead"}`),
    );

    await expect(
      provider.structured({ prompt: prompt(), schema, schemaName: 'A', context: ctx }),
    ).rejects.toThrow(AIContractViolation);
  });

  it('fails the contract when the object does not match the schema', async () => {
    const provider = withStub(
      stubEmitting(`{"type":"result","is_error":false,"structured_output":{"answer":"hi"}}`),
    );

    await expect(
      provider.structured({ prompt: prompt(), schema, schemaName: 'A', context: ctx }),
    ).rejects.toThrow(AIContractViolation);
  });

  it('gives up rather than hanging forever', async () => {
    const provider = withStub(`process.stdin.resume();setTimeout(()=>{},60000);`, 900);

    const detail = await failureOf(() =>
      provider.structured({ prompt: prompt(), schema, schemaName: 'A', context: ctx }),
    );

    expect(detail).toContain('did not finish within');
  });

  it('refuses embeddings instead of inventing vectors', async () => {
    const provider = withStub(stubEmitting(OK_RESULT));

    // Zero vectors would quietly poison anything built on them.
    await expect(provider.embed({ inputs: ['a'], context: ctx })).rejects.toThrow(AIUnavailable);
  });

  it('offers aliases rather than pinned snapshots', async () => {
    const provider = withStub(stubEmitting(OK_RESULT));

    const models = await provider.listModels(ctx);

    // There is no key here to ask a vendor endpoint with, so the list is
    // ours — aliases, so it cannot name a snapshot that has been retired.
    expect(models.map((model) => model.id)).toEqual(['haiku', 'sonnet', 'opus']);
  });
});
