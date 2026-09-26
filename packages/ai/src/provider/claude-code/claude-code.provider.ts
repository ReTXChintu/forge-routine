import { spawn } from 'node:child_process';
import { access, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

import { zodToJsonSchema } from 'zod-to-json-schema';

import {
  AIContractViolation,
  AIUnavailable,
  type AIProvider,
  type CallContext,
  type EmbedRequest,
  type EmbedResult,
  type GenerateRequest,
  type GenerateResult,
  type ModelOption,
  type PromptSpec,
  type StreamChunk,
  type StructuredRequest,
  type StructuredResult,
} from '../ai-provider.port.js';
import { stripAbsent, toStrictSchema } from '../openai/strict-schema.js';

/**
 * Claude through the locally installed Claude Code CLI, with no API key.
 *
 * The one vendor here that is a *process*, not an HTTP client. It runs
 * `claude -p` and reads its JSON, which means it answers as whatever the CLI
 * on this machine is signed in as — so a user who already has Claude Code can
 * use it here without pasting a key anywhere.
 *
 * Three consequences worth knowing before choosing it:
 *
 *   It only works where the API process itself runs. The CLI has to be on the
 *   same machine, so this is for a local or desktop build. On a deployed
 *   server there is no `claude` to run and the vendor is not offered.
 *
 *   Every call carries Claude Code's own harness — roughly 20–25k tokens of
 *   system prompt and tool definitions, mostly served from its cache. That is
 *   irreducible: an empty working directory and a replacement system prompt
 *   do not remove it (measured, not assumed). Fine for a conversation,
 *   expensive for bulk generation.
 *
 *   It is slower. Process start plus an agent loop is seconds, where the API
 *   is well under one.
 *
 * Structured output is real, not scraped: `--json-schema` makes the CLI
 * validate against the schema and hand it back in a `structured_output` field
 * of its own. That is what makes this a usable provider rather than a prose
 * parser — every agent in this product needs a typed object back.
 */

export interface ClaudeCodeProviderOptions {
  modelFast: string;
  modelReasoning: string;
  timeoutMs: number;
  /** Absolute path to the CLI, for a machine where it is not on PATH. */
  binary?: string;
}

/**
 * Everything the CLI can do to a filesystem, denied.
 *
 * This product asks Claude to explain concepts and write questions. It has no
 * business reading files, running commands or searching the web to do that,
 * and a coding agent left with its tools will use them — slowly, and with
 * whatever happens to be in the working directory.
 *
 * Belt and braces alongside the empty working directory below: the directory
 * limits what could be reached, this removes the means.
 */
const DENIED_TOOLS = [
  'Bash',
  'BashOutput',
  'KillShell',
  'Read',
  'Write',
  'Edit',
  'NotebookEdit',
  'Glob',
  'Grep',
  'WebFetch',
  'WebSearch',
  'Task',
  'TodoWrite',
];

/** The CLI's own result envelope, as `--output-format json` emits it. */
interface CliResult {
  type: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  structured_output?: unknown;
  session_id?: string;
  total_cost_usd?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

export class ClaudeCodeProvider implements AIProvider {
  readonly name = 'claude-code';

  constructor(private readonly options: ClaudeCodeProviderOptions) {}

  /**
   * The model for one call.
   *
   * A caller-supplied `modelOverride` wins over the prompt's tier, the same
   * as every other provider — the assistant's model picker uses it.
   */
  private resolveModel(prompt: PromptSpec, context?: CallContext): string {
    if (context?.modelOverride) return context.modelOverride;

    return prompt.model === 'reasoning' ? this.options.modelReasoning : this.options.modelFast;
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const startedAt = Date.now();
    const model = this.resolveModel(req.prompt, req.context);
    const result = await this.run(req.prompt, model, req.context, null);

    return {
      text: result.result ?? '',
      usage: usageOf(result),
      model,
      latencyMs: Date.now() - startedAt,
    };
  }

  /**
   * One chunk, then done.
   *
   * The CLI can stream, but nothing in this product consumes `stream()` — only
   * the recording decorator forwards it. Rather than maintain an NDJSON event
   * parser with no reader, this satisfies the port honestly: the text arrives
   * in one piece because that is genuinely when it arrives.
   */
  async *stream(req: GenerateRequest): AsyncIterable<StreamChunk> {
    const { text } = await this.generate(req);

    if (text) yield { delta: text, done: false };
    yield { delta: '', done: true };
  }

  async structured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const startedAt = Date.now();
    const model = this.resolveModel(req.prompt, req.context);

    // The same conversion the OpenAI and Anthropic providers use: every
    // property required, `additionalProperties: false`, optionals turned
    // nullable with a map of which ones so the invented nulls can be deleted
    // again before Zod sees them.
    const { schema: jsonSchema, absence } = toStrictSchema(
      zodToJsonSchema(req.schema, { target: 'jsonSchema7', $refStrategy: 'none' }) as Record<
        string,
        unknown
      >,
    );

    const result = await this.run(req.prompt, model, req.context, jsonSchema);

    if (result.structured_output === undefined || result.structured_output === null) {
      // The CLI validated against the schema and still produced nothing under
      // that key, so there is no object to salvage and no point retrying the
      // same prompt. Said plainly rather than as a parse error on `result`,
      // which for a schema call holds a stringified copy at best.
      throw new AIContractViolation(
        req.context.agent,
        [`no structured output (${result.subtype ?? result.type})`],
        result.result ?? '',
      );
    }

    const parsed = req.schema.safeParse(stripAbsent(result.structured_output, absence));
    if (!parsed.success) {
      throw new AIContractViolation(
        req.context.agent,
        parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
        JSON.stringify(result.structured_output).slice(0, 2_000),
      );
    }

    return {
      data: parsed.data,
      usage: usageOf(result),
      model,
      latencyMs: Date.now() - startedAt,
      // Never repaired: the CLI validates against the schema before it hands
      // anything back, so there is no round trip to count.
      repairAttempts: 0,
    };
  }

  async embed(req: EmbedRequest): Promise<EmbedResult> {
    // Same as the Anthropic provider: no embeddings endpoint exists, and
    // saying so beats returning zero vectors that quietly poison whatever is
    // built on them.
    throw new AIUnavailable(
      req.context.agent,
      new Error('Claude Code does not provide embeddings; configure OpenAI for that'),
    );
  }

  /**
   * The models the CLI accepts, as aliases rather than dated ids.
   *
   * Not asked of a vendor endpoint, because there is no key here to ask with —
   * the CLI answers as whoever is signed in, and which models that account may
   * use is not something it exposes. Aliases rather than pinned versions so
   * this list cannot name a snapshot that has been retired.
   */
  async listModels(_context: CallContext): Promise<ModelOption[]> {
    return [
      { id: 'haiku', label: 'Haiku — fastest, cheapest' },
      { id: 'sonnet', label: 'Sonnet — balanced' },
      { id: 'opus', label: 'Opus — most capable' },
    ];
  }

  // -- The process ----------------------------------------------------------

  /**
   * Runs one prompt and returns the CLI's result envelope.
   *
   * Two details are load-bearing and were both learned the hard way in a
   * sibling project:
   *
   *   The prompt goes over **stdin**, never as an argument. It is free-form
   *   text containing quotes and newlines, and on Windows the CLI is a `.cmd`
   *   shim that Node refuses to spawn once an argument holds characters it
   *   cannot safely escape against cmd.exe's quoting rules — the fix for
   *   CVE-2024-24576 makes that an outright failure rather than an injection
   *   risk. Piping avoids it on every platform.
   *
   *   stdin is written while stdout is being read, not before. A long prompt
   *   can exceed the OS pipe buffer and the CLI may start writing before it
   *   has finished reading, so doing one then the other deadlocks both.
   */
  private async run(
    prompt: PromptSpec,
    model: string,
    context: CallContext,
    jsonSchema: Record<string, unknown> | null,
  ): Promise<CliResult> {
    const { system, conversation } = flatten(prompt);

    // An empty directory, so the CLI has no project to discover: run it in the
    // API's own working directory and it would load this repository's
    // CLAUDE.md into every call about closures.
    const cwd = await mkdtemp(join(tmpdir(), 'forgeroutine-claude-'));

    const args = [
      '-p',
      '--output-format',
      'json',
      '--model',
      model,
      '--disallowedTools',
      DENIED_TOOLS.join(','),
    ];

    if (system) args.push('--system-prompt', system);
    if (jsonSchema) args.push('--json-schema', JSON.stringify(jsonSchema));

    const raw = await this.spawnCli(args, conversation, cwd, context);

    let parsed: CliResult;
    try {
      parsed = JSON.parse(raw) as CliResult;
    } catch {
      // Not JSON at all: the CLI failed before it got as far as its own
      // envelope — not signed in, no such model, a flag this version does not
      // have. Its text is the only useful thing here, so it is passed through
      // rather than replaced with a shrug.
      throw new AIUnavailable(
        context.agent,
        new Error(`Claude Code did not return JSON: ${raw.slice(0, 400) || '(no output)'}`),
      );
    }

    if (parsed.is_error) {
      throw new AIUnavailable(
        context.agent,
        new Error(parsed.result ?? `Claude Code failed (${parsed.subtype ?? 'unknown'})`),
      );
    }

    return parsed;
  }

  /**
   * The argument list actually handed to the binary.
   *
   * A seam, so the tests can drive the real spawning, piping and parsing
   * against a stub program instead of requiring Claude Code to be installed
   * and signed in — which would make them unrunnable on CI and charge the
   * user's rate limit for every run.
   */
  protected cliArgs(args: string[]): string[] {
    return args;
  }

  private async spawnCli(
    args: readonly string[],
    input: string,
    cwd: string,
    context: CallContext,
  ): Promise<string> {
    const binary = this.options.binary ?? (await resolveBinary());

    return new Promise<string>((resolve, reject) => {
      const child = spawn(binary, this.cliArgs([...args]), {
        cwd,
        // Never through a shell. cmd.exe re-splits the argument list, which
        // turns `--json-schema {"type":"object",...}` into a dozen tokens and
        // the call fails in a way that looks like the model misbehaving.
        // Resolving the real executable instead is what makes that avoidable
        // — see `resolveBinary`.
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let settled = false;

      const finish = (run: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        run();
      };

      const timer = setTimeout(() => {
        finish(() => {
          child.kill();
          reject(
            new AIUnavailable(
              context.agent,
              new Error(`Claude Code did not finish within ${this.options.timeoutMs}ms`),
            ),
          );
        });
      }, this.options.timeoutMs);

      // An aborted request should not leave a process running for a minute.
      const onAbort = () =>
        finish(() => {
          child.kill();
          reject(new AIUnavailable(context.agent, new Error('Cancelled')));
        });
      context.signal?.addEventListener('abort', onAbort, { once: true });

      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      child.on('error', (error) =>
        finish(() =>
          reject(
            new AIUnavailable(
              context.agent,
              // The common case by far: the CLI is not installed, or this
              // process cannot see it on PATH. Named, because "spawn ENOENT"
              // tells a user nothing they can act on.
              new Error(
                `Could not start the Claude Code CLI (${error.message}). ` +
                  'Install it and sign in, or choose a different provider.',
              ),
            ),
          ),
        ),
      );

      child.on('close', (code) =>
        finish(() => {
          context.signal?.removeEventListener('abort', onAbort);

          if (code === 0 || stdout.trim().length > 0) {
            resolve(stdout.trim());
            return;
          }

          reject(
            new AIUnavailable(
              context.agent,
              new Error(
                `Claude Code exited with ${code}: ${stderr.trim().slice(0, 400) || '(no output)'}`,
              ),
            ),
          );
        }),
      );

      // Written concurrently with the readers above. Closing the pipe is how
      // the CLI knows the prompt is complete — it reads to EOF rather than to
      // a length it was told in advance.
      child.stdin.on('error', () => undefined);
      child.stdin.end(input);
    });
  }
}

/**
 * Flattens a prompt into one system string and one user turn.
 *
 * `claude -p` takes a single prompt, so a conversation has to be written out
 * rather than sent as turns. Roles are labelled so the model can still tell
 * who said what; this is a real fidelity loss against the Messages API and
 * the reason this provider suits a chat better than a long transcript.
 */
function flatten(prompt: PromptSpec): { system: string | null; conversation: string } {
  const system = prompt.messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n\n');

  const rest = prompt.messages.filter((message) => message.role !== 'system');

  // A lone user message is by far the common case — every generation agent —
  // and sending it unlabelled keeps those prompts exactly as written.
  const conversation =
    rest.length === 1
      ? rest[0]!.content
      : rest
          .map(
            (message) =>
              `${message.role === 'assistant' ? 'Assistant' : 'User'}: ${message.content}`,
          )
          .join('\n\n');

  return { system: system.length > 0 ? system : null, conversation };
}

/**
 * Prompt tokens as this product counts them.
 *
 * Cache reads and writes are folded in: they are real context the call paid
 * for, and leaving them out would report a few dozen tokens for a call that
 * actually carried twenty thousand — which is the one number that makes this
 * provider's cost legible.
 */
function usageOf(result: CliResult) {
  const usage = result.usage ?? {};

  return {
    promptTokens:
      (usage.input_tokens ?? 0) +
      (usage.cache_creation_input_tokens ?? 0) +
      (usage.cache_read_input_tokens ?? 0),
    completionTokens: usage.output_tokens ?? 0,
  };
}

/**
 * Something `spawn` can run without a shell.
 *
 * On macOS and Linux `claude` is an executable script and the name is enough.
 * On Windows npm installs three shims — `claude`, `claude.cmd`, `claude.ps1` —
 * and Node cannot execute any of them without a shell, while a shell would
 * re-split the JSON schema argument. The `.cmd` is a fixed-shape npm wrapper
 * around a real `claude.exe`, so reading the path out of it gives something
 * spawnable directly, and the quoting problem disappears rather than being
 * escaped around.
 *
 * Cached: it is a couple of stat calls, but it runs on every AI call.
 */
let cachedBinary: string | null = null;

export async function resolveBinary(): Promise<string> {
  if (cachedBinary) return cachedBinary;
  if (process.platform !== 'win32') {
    cachedBinary = 'claude';
    return cachedBinary;
  }

  const dirs = (process.env.PATH ?? '').split(delimiter).filter(Boolean);

  for (const dir of dirs) {
    // An .exe on PATH is directly spawnable and needs no unwrapping.
    const exe = join(dir, 'claude.exe');
    if (await exists(exe)) {
      cachedBinary = exe;
      return cachedBinary;
    }

    const cmd = join(dir, 'claude.cmd');
    if (!(await exists(cmd))) continue;

    const target = await targetOf(cmd);
    if (target && (await exists(target))) {
      cachedBinary = target;
      return cachedBinary;
    }
  }

  // Nothing found. Returned rather than thrown so the failure arrives from
  // the spawn, where it is already reported as "install it and sign in"
  // instead of as a resolver detail nobody asked about.
  cachedBinary = 'claude';
  return cachedBinary;
}

/** The executable an npm `.cmd` shim calls, if it names one. */
async function targetOf(shim: string): Promise<string | null> {
  let contents: string;
  try {
    contents = await readFile(shim, 'utf8');
  } catch {
    return null;
  }

  // The npm shim's own line, verbatim:
  //   "%dp0%\node_modules\@anthropic-ai\claude-code\bin\claude.exe"   %*
  //
  // `\\?` is an optional literal backslash; `\.exe` is a literal dot. An
  // earlier version wrote `\\.exe`, which asks for a backslash followed by any
  // character — so it never matched and every call fell back to spawning a
  // name Windows cannot execute.
  const match = /"%dp0%\\?(.+?\.exe)"/i.exec(contents);
  if (!match?.[1]) return null;

  // Separators normalised so `join` treats it as one relative path on any
  // platform, rather than a single segment containing backslashes.
  return join(shim, '..', match[1].replace(/\\/g, '/'));
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
