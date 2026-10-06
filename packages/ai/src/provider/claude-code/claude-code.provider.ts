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
import { flattenPrompt, runCli } from '../cli/run-cli.js';
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
    const { system, conversation } = flattenPrompt(prompt);

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

  /**
   * Runs the CLI and returns its stdout, failing as Claude Code fails.
   *
   * The process handling itself is shared with Codex in `runCli`; what is
   * specific here is the reading of the exit: a run that printed something is
   * worth parsing whatever its code, because Claude Code reports most of its
   * own failures inside a JSON envelope on stdout rather than through it.
   */
  private async spawnCli(
    args: readonly string[],
    input: string,
    cwd: string,
    context: CallContext,
  ): Promise<string> {
    const { stdout, stderr, code } = await runCli({
      binary: this.options.binary ?? (await resolveBinary()),
      args: this.cliArgs([...args]),
      input,
      cwd,
      timeoutMs: this.options.timeoutMs,
      context,
      tool: 'Claude Code',
      describeMissing: describeMissingBinary,
    });

    if (code === 0 || stdout.trim().length > 0) return stdout.trim();

    throw new AIUnavailable(
      context.agent,
      new Error(`Claude Code exited with ${code}: ${stderr.trim().slice(0, 400) || '(no output)'}`),
    );
  }
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

/** Where the last search looked, so a failure can say so rather than shrug. */
let lastSearched: string[] = [];

/**
 * Where a globally installed CLI ends up, beyond PATH.
 *
 * PATH is the right answer and usually the only one needed — but a server
 * started by a process manager, a service, or an IDE often inherits a
 * different environment from the shell the CLI was installed from, and then
 * "not on PATH" means "this process cannot see it" rather than "it is not
 * installed". These are the npm and Claude Code install locations, checked
 * only after PATH has failed.
 */
function fallbackDirs(): string[] {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
  const dirs: string[] = [];

  if (process.platform === 'win32') {
    // nvm-for-windows points this at whichever version is active.
    if (process.env.NVM_SYMLINK) dirs.push(process.env.NVM_SYMLINK);
    if (process.env.APPDATA) dirs.push(join(process.env.APPDATA, 'npm'));
    if (process.env.ProgramFiles) dirs.push(join(process.env.ProgramFiles, 'nodejs'));
  } else {
    dirs.push('/usr/local/bin', '/usr/bin', '/opt/homebrew/bin');
  }

  if (home) dirs.push(join(home, '.local', 'bin'), join(home, '.claude', 'local'));

  return dirs;
}

/**
 * Something `spawn` can run without a shell.
 *
 * On macOS and Linux `claude` is an executable script and the name is enough,
 * so PATH resolution is left to the OS. On Windows npm installs three shims —
 * `claude`, `claude.cmd`, `claude.ps1` — none of which Node can execute
 * without a shell, while a shell would re-split the JSON schema argument. The
 * `.cmd` is a fixed-shape wrapper around a real `claude.exe`, so reading the
 * path out of it gives something spawnable directly and the quoting problem
 * disappears rather than being escaped around.
 *
 * `CLAUDE_CODE_BIN` overrides the search outright, which is the answer for any
 * layout this does not know about.
 *
 * Only a *successful* result is cached. Caching the fallback was a bug: one
 * failed lookup — the CLI installed after the server started, a process whose
 * environment was still warming up — left the process permanently convinced
 * it was missing, with a restart the only cure.
 */
export async function resolveBinary(): Promise<string> {
  // The bare name when nothing was found: the spawn then produces the failure,
  // which is where it can be reported with everything that was tried.
  return (await findBinary()) ?? 'claude';
}

/**
 * The CLI's path, or null when this machine does not have one.
 *
 * Separate from `resolveBinary` because the settings screen needs the honest
 * answer rather than a value to attempt. A provider that cannot possibly work
 * here should say so before it is chosen, not fail on the first question —
 * which is exactly what happened when this shipped offering itself on a
 * deployed server that has no CLI on it.
 */
export async function findBinary(): Promise<string | null> {
  if (cachedBinary) return cachedBinary;

  const configured = process.env.CLAUDE_CODE_BIN?.trim();
  if (configured) {
    // Taken as given. If it is wrong the spawn says so, naming it, which beats
    // silently searching past an explicit instruction.
    cachedBinary = configured;
    return cachedBinary;
  }

  const fromPath = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
  const dirs = [...fromPath, ...fallbackDirs()];
  lastSearched = dirs;

  for (const dir of dirs) {
    const found = await lookIn(dir);
    if (found) {
      cachedBinary = found;
      return cachedBinary;
    }
  }

  // Deliberately not cached: the CLI may be installed after the server starts.
  return null;
}

/** Whatever in this directory is directly spawnable, if anything. */
async function lookIn(dir: string): Promise<string | null> {
  if (process.platform !== 'win32') {
    const direct = join(dir, 'claude');
    return (await exists(direct)) ? direct : null;
  }

  // An .exe needs no unwrapping.
  const exe = join(dir, 'claude.exe');
  if (await exists(exe)) return exe;

  const cmd = join(dir, 'claude.cmd');
  if (!(await exists(cmd))) return null;

  const target = await targetOf(cmd);

  return target && (await exists(target)) ? target : null;
}

/**
 * What to tell the user when it could not be started.
 *
 * "Install it and sign in" is actively misleading to somebody who has done
 * both — the usual cause is a server process whose environment does not
 * include the directory the CLI lives in. So the message says what was
 * searched and how to settle it, rather than assuming which it is.
 */
export function describeMissingBinary(): string {
  const configured = process.env.CLAUDE_CODE_BIN?.trim();
  if (configured) {
    return `CLAUDE_CODE_BIN is set to "${configured}", and that could not be run.`;
  }

  const shown = lastSearched.slice(0, 8).join(', ');

  return (
    'Could not find the Claude Code CLI. If it is installed, this process cannot see it — ' +
    'a server started outside your shell often has a different PATH. Set CLAUDE_CODE_BIN to ' +
    'the full path of the executable (`where claude` on Windows, `which claude` elsewhere). ' +
    `Looked in: ${shown || '(PATH was empty)'}.`
  );
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
