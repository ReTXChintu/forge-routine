import { execFile } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { promisify } from 'node:util';

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
  type TokenUsage,
} from '../ai-provider.port.js';
import {
  flattenPrompt,
  runCli,
  type CliExecutor,
  type CliJob,
  type CliOutcome,
} from '../cli/run-cli.js';
import { stripAbsent, toStrictSchema } from '../openai/strict-schema.js';

/**
 * ChatGPT through the locally installed Codex CLI, with no API key.
 *
 * OpenAI's counterpart to the Claude Code provider, and built the same way: it
 * runs `codex exec` and answers as whatever account that CLI is signed in as —
 * a ChatGPT plan, with nothing to paste. Everything about the Claude Code
 * provider's trade-offs applies here too:
 *
 *   It only works where the API process itself runs, because the CLI has to
 *   be on the same machine. On a deployed server it is not offered.
 *
 *   Each call carries Codex's own harness — about 15k input tokens in a live
 *   probe, mostly cached — and takes several seconds. It suits the assistant
 *   better than bulk generation.
 *
 * Structured output is enforced by the CLI: `--output-schema` takes the schema
 * as a file and the final answer is written to another, so nothing about the
 * schema has to survive being an argument. Verified live, including a nullable
 * field coming back as null rather than invented.
 *
 * OpenAI's Codex documentation neither permits nor forbids a ChatGPT sign-in
 * being used this way; it describes `codex exec` for scripted runs. Personal
 * use matches that; serving other people from one sign-in is not something it
 * addresses.
 */

export interface CodexProviderOptions {
  modelFast: string;
  modelReasoning: string;
  timeoutMs: number;
  /** Absolute path to the CLI, for a machine where it cannot be found. */
  binary?: string;
  /** Runs the CLI elsewhere — the user's machine, through the desktop app. */
  executor?: CliExecutor;
}

/**
 * "Use whatever model Codex is configured for."
 *
 * There is no command that lists the models a ChatGPT sign-in may use, so this
 * provider does not invent a list of names that could be wrong or retired. It
 * leaves the choice to Codex unless one is picked by name.
 */
export const CODEX_DEFAULT_MODEL = 'codex-default';

/** One line of `codex exec --json` output, as far as this reads it. */
interface CodexEvent {
  type?: string;
  message?: string;
  error?: { message?: string } | string;
  usage?: {
    input_tokens?: number;
    cached_input_tokens?: number;
    cache_write_input_tokens?: number;
    output_tokens?: number;
    reasoning_output_tokens?: number;
  };
}

export class CodexProvider implements AIProvider {
  readonly name = 'codex';

  constructor(private readonly options: CodexProviderOptions) {}

  /** A caller-supplied `modelOverride` wins over the prompt's tier. */
  private resolveModel(prompt: PromptSpec, context?: CallContext): string {
    if (context?.modelOverride) return context.modelOverride;

    return prompt.model === 'reasoning' ? this.options.modelReasoning : this.options.modelFast;
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const startedAt = Date.now();
    const model = this.resolveModel(req.prompt, req.context);
    const { text, usage } = await this.run(req.prompt, model, req.context, null);

    return { text, usage, model, latencyMs: Date.now() - startedAt };
  }

  /**
   * One chunk, then done — nothing in this product consumes `stream()`, so the
   * text arrives in one piece because that is genuinely when it arrives.
   */
  async *stream(req: GenerateRequest): AsyncIterable<StreamChunk> {
    const { text } = await this.generate(req);

    if (text) yield { delta: text, done: false };
    yield { delta: '', done: true };
  }

  async structured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const startedAt = Date.now();
    const model = this.resolveModel(req.prompt, req.context);

    // The same strict conversion the API providers use: every property
    // required, no extras, optionals nullable with a map of which ones so the
    // invented nulls can be removed again before Zod sees them.
    const { schema: jsonSchema, absence } = toStrictSchema(
      zodToJsonSchema(req.schema, { target: 'jsonSchema7', $refStrategy: 'none' }) as Record<
        string,
        unknown
      >,
    );

    const { text, usage } = await this.run(req.prompt, model, req.context, jsonSchema);

    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw new AIContractViolation(req.context.agent, ['Codex did not return JSON'], text);
    }

    const parsed = req.schema.safeParse(stripAbsent(value, absence));
    if (!parsed.success) {
      throw new AIContractViolation(
        req.context.agent,
        parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
        text.slice(0, 2_000),
      );
    }

    // Never repaired: the CLI holds the answer to the schema before writing it.
    return { data: parsed.data, usage, model, latencyMs: Date.now() - startedAt, repairAttempts: 0 };
  }

  async embed(req: EmbedRequest): Promise<EmbedResult> {
    throw new AIUnavailable(
      req.context.agent,
      new Error('Codex does not provide embeddings; configure OpenAI for that'),
    );
  }

  /**
   * Just the default, honestly labelled.
   *
   * Codex has no command that lists models, and a ChatGPT sign-in does not
   * expose one either, so any longer list here would be names guessed from
   * memory — which is exactly how a picker ends up offering a model that
   * fails on the first question.
   */
  async listModels(_context: CallContext): Promise<ModelOption[]> {
    return [{ id: CODEX_DEFAULT_MODEL, label: 'Codex default model' }];
  }

  /**
   * The argument list actually handed to the binary. A seam, so the tests can
   * drive real spawning and file handling against a stub program instead of
   * needing Codex installed and spending the user's plan on every run.
   */
  protected cliArgs(args: string[]): string[] {
    return args;
  }

  private async run(
    prompt: PromptSpec,
    model: string,
    context: CallContext,
    jsonSchema: Record<string, unknown> | null,
  ): Promise<{ text: string; usage: TokenUsage }> {
    const { system, conversation } = flattenPrompt(prompt);
    const job: CliJob = {
      tool: 'CODEX',
      system,
      conversation,
      jsonSchema,
      model,
      timeoutMs: this.options.timeoutMs,
    };

    // Here, or on the user's own machine through the desktop app, which runs
    // the identical command and returns the answer file's contents.
    const { stdout, stderr, code, answer } = this.options.executor
      ? await this.options.executor(job, context)
      : await this.runLocally(job, context);

    const events = parseEvents(stdout);

    if (code !== 0 || answer === null) {
      // The CLI's own words, from its events when it said anything there,
      // otherwise from stderr. "Exited with 1" alone is not something anyone
      // can act on — the common causes are being signed out and a model
      // name the plan cannot use, and both say so plainly.
      throw new AIUnavailable(
        context.agent,
        new Error(
          `Codex failed (exit ${code}): ${
            lastError(events) ?? (stderr.trim().slice(0, 400) || '(no output)')
          }`,
        ),
      );
    }

    return { text: answer.trim(), usage: usageOf(events) };
  }

  /** Runs the job on this machine. */
  private async runLocally(job: CliJob, context: CallContext): Promise<CliOutcome> {
    // An empty directory, so there is no project for Codex to read, and a
    // read-only sandbox, so it could not change one if there were.
    const cwd = await mkdtemp(join(tmpdir(), 'forgeroutine-codex-'));
    const answerPath = join(cwd, 'answer.txt');
    const schemaPath = join(cwd, 'schema.json');

    try {
      if (job.jsonSchema) await writeFile(schemaPath, JSON.stringify(job.jsonSchema), 'utf8');

      const { stdout, stderr, code } = await runCli({
        binary: this.options.binary ?? (await resolveCodexBinary()),
        args: this.cliArgs(codexArgs(job, { cwd, answerPath, schemaPath })),
        input: codexInput(job),
        cwd,
        timeoutMs: job.timeoutMs,
        context,
        tool: 'Codex',
        describeMissing: describeMissingCodex,
      });

      const answer = await readFile(answerPath, 'utf8').catch(() => null);
      return { stdout, stderr, code, answer };
    } finally {
      // Holds the question and the answer; nothing in it is worth keeping.
      await rm(cwd, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

/**
 * The CLI's arguments for one job. Mirrored exactly by the desktop app
 * (`apps/desktop/src-tauri/src/tools.rs`); change both together.
 */
export function codexArgs(
  job: CliJob,
  paths: { cwd: string; answerPath: string; schemaPath: string },
): string[] {
  const args = [
    'exec',
    // Events on stdout, which is where the token counts are.
    '--json',
    '--sandbox',
    'read-only',
    // Nothing saved to Codex's own session history: these are one-off
    // questions, and a hundred of them in the user's Codex sidebar would be
    // clutter they never asked for.
    '--ephemeral',
    '--skip-git-repo-check',
    '-C',
    paths.cwd,
    '-o',
    paths.answerPath,
  ];

  if (job.jsonSchema) args.push('--output-schema', paths.schemaPath);
  if (job.model && job.model !== CODEX_DEFAULT_MODEL) args.push('-m', job.model);

  // Read from stdin.
  args.push('-');
  return args;
}

/**
 * What goes to stdin. There is no separate system-prompt flag, so the
 * operator's instructions go first and are marked as such.
 */
export function codexInput(job: CliJob): string {
  return job.system ? `${job.system}

---

${job.conversation}` : job.conversation;
}

function parseEvents(stdout: string): CodexEvent[] {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as CodexEvent];
      } catch {
        return [];
      }
    });
}

function lastError(events: readonly CodexEvent[]): string | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!;
    if (!event.type?.includes('error') && !event.type?.includes('failed')) continue;

    if (typeof event.error === 'string') return event.error;
    if (event.error?.message) return event.error.message;
    if (event.message) return event.message;
  }

  return null;
}

/**
 * Token counts from the turn's final event, taken at face value.
 *
 * Not summed with the cached or reasoning figures beside them. In OpenAI's
 * reporting cached tokens are a subset of `input_tokens` — a live probe showed
 * 15,491 input with 1,408 cached — so adding them would double-count, and
 * there is no documentation saying the other two are not subsets as well.
 * Under-reporting by an unknown margin is better than inventing one.
 */
function usageOf(events: readonly CodexEvent[]): TokenUsage {
  const usage = [...events].reverse().find((event) => event.usage)?.usage ?? {};

  return {
    promptTokens: usage.input_tokens ?? 0,
    completionTokens: usage.output_tokens ?? 0,
  };
}

// -- Finding the CLI ----------------------------------------------------------

const run = promisify(execFile);

let cachedBinary: string | null = null;
let lastSearched: string[] = [];

/**
 * The Codex CLI's path, or null when this machine does not have one.
 *
 * `CODEX_BIN` first, taken as given. Then, on Windows, the CLI bundled inside
 * the Codex desktop app — found by asking Windows where that package is
 * installed. Its folder name carries the app's version, so it moves with every
 * update and cannot be stored; and an ordinary process is not allowed to list
 * the folder those packages live in, so it cannot be searched for either.
 * Finally PATH and the usual install locations, for a standalone install.
 *
 * Only a success is cached: Codex may be installed after the server starts.
 */
export async function findCodexBinary(): Promise<string | null> {
  if (cachedBinary) return cachedBinary;

  const configured = process.env.CODEX_BIN?.trim();
  if (configured) {
    cachedBinary = configured;
    return cachedBinary;
  }

  const searched: string[] = [];

  if (process.platform === 'win32') {
    const bundled = await bundledWithDesktopApp();
    if (bundled) {
      searched.push(bundled);
      if (await exists(bundled)) {
        cachedBinary = bundled;
        return cachedBinary;
      }
    }
  }

  const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
  const dirs = [
    ...(process.env.PATH ?? '').split(delimiter).filter(Boolean),
    ...(home ? [join(home, '.local', 'bin')] : []),
    ...(process.platform === 'win32' ? [] : ['/usr/local/bin', '/opt/homebrew/bin']),
  ];

  for (const dir of dirs) {
    const candidate = join(dir, process.platform === 'win32' ? 'codex.exe' : 'codex');
    searched.push(dir);
    if (await exists(candidate)) {
      cachedBinary = candidate;
      lastSearched = searched;
      return cachedBinary;
    }
  }

  lastSearched = searched;
  return null;
}

/** For spawning: the path if found, else the bare name so the spawn reports it. */
export async function resolveCodexBinary(): Promise<string> {
  return (await findCodexBinary()) ?? 'codex';
}

export function describeMissingCodex(): string {
  const configured = process.env.CODEX_BIN?.trim();
  if (configured) return `CODEX_BIN is set to "${configured}", and that could not be run.`;

  return (
    'Could not find the Codex CLI. Install the Codex app or the Codex CLI and sign in with ' +
    '`codex login`, or set CODEX_BIN to the full path of codex.exe. Looked in: ' +
    `${lastSearched.slice(0, 6).join(', ') || '(nothing to search)'}.`
  );
}

/** Where the Codex desktop app keeps its bundled CLI, or null without the app. */
async function bundledWithDesktopApp(): Promise<string | null> {
  try {
    const { stdout } = await run(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', '(Get-AppxPackage OpenAI.Codex).InstallLocation'],
      { timeout: 10_000, windowsHide: true },
    );

    const location = stdout.trim();
    return location ? join(location, 'app', 'resources', 'codex.exe') : null;
  } catch {
    return null;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
