import { spawn } from 'node:child_process';

import { AIUnavailable, type CallContext, type PromptSpec } from '../ai-provider.port.js';

/**
 * Runs a locally installed AI command-line tool and returns what it printed.
 *
 * Shared by every provider that is a process rather than an HTTP client —
 * Claude Code and Codex — because the hard part is the same for both and was
 * learned the hard way once already:
 *
 *   Never through a shell. cmd.exe re-splits the argument list, which turns a
 *   JSON schema or any quoted argument into a dozen tokens, and the call then
 *   fails in a way that looks like the model misbehaving.
 *
 *   The prompt goes over stdin, never as an argument, for the same reason —
 *   it is free-form text full of quotes and newlines.
 *
 *   stdin is written while stdout is being read, not before. A prompt larger
 *   than the OS pipe buffer deadlocks both sides otherwise: the tool may start
 *   writing before it has finished reading, and nobody is reading yet.
 *
 * Everything that can go wrong is reported as `AIUnavailable` with a message
 * a user can act on, because "spawn ENOENT" tells nobody anything.
 */

/** The two local AI tools a CLI provider can drive. */
export type CliTool = 'CLAUDE_CODE' | 'CODEX';

/**
 * One prompt for a CLI tool, described by meaning rather than by argv.
 *
 * Described this way so the same job can run in two places: here, where the
 * provider builds the argument list itself, or on the user's own machine
 * through the desktop app, which builds the identical list in Rust and refuses
 * to run anything else — a page that could hand it arbitrary arguments could
 * hand it arbitrary commands.
 */
export interface CliJob {
  tool: CliTool;
  system: string | null;
  conversation: string;
  /** Already strict. Null for a plain-text answer. */
  jsonSchema: Record<string, unknown> | null;
  /** A model name the tool understands, or the tool's own default marker. */
  model: string;
  timeoutMs: number;
}

/** What a run left behind; each provider reads its own success out of it. */
export interface CliOutcome {
  stdout: string;
  stderr: string;
  code: number | null;
  /** Codex writes its final answer to a file; this is that file's contents. */
  answer: string | null;
}

/**
 * Runs a job somewhere other than this process. Rejects with `AIUnavailable`
 * when it could not run at all — not connected, tool missing, timed out.
 */
export type CliExecutor = (job: CliJob, context: CallContext) => Promise<CliOutcome>;

export interface CliRun {
  binary: string;
  args: readonly string[];
  /** Written to stdin, then closed: the tool reads to EOF. */
  input: string;
  cwd: string;
  timeoutMs: number;
  context: CallContext;
  /** "Claude Code", "Codex" — named in every error. */
  tool: string;
  /** What to say when the binary is not there, with what was searched. */
  describeMissing: () => string;
}

export interface CliOutput {
  stdout: string;
  stderr: string;
  code: number | null;
}

/**
 * Resolves with the tool's output once it exits, whatever the exit code —
 * each provider knows what its own failure looks like better than this does.
 * Rejects only when the process could not run, was cancelled, or overran.
 */
export function runCli(run: CliRun): Promise<CliOutput> {
  const { context, tool } = run;

  return new Promise<CliOutput>((resolve, reject) => {
    const child = spawn(run.binary, [...run.args], {
      cwd: run.cwd,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (then: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      context.signal?.removeEventListener('abort', onAbort);
      then();
    };

    const timer = setTimeout(() => {
      finish(() => {
        child.kill();
        reject(
          new AIUnavailable(
            context.agent,
            new Error(`${tool} did not finish within ${run.timeoutMs}ms`),
          ),
        );
      });
    }, run.timeoutMs);

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
            new Error(
              isMissing(error)
                ? run.describeMissing()
                : `Could not start the ${tool} CLI (${error.message}).`,
            ),
          ),
        ),
      ),
    );

    child.on('close', (code) => finish(() => resolve({ stdout, stderr, code })));

    // Written concurrently with the readers above. Closing the pipe is how
    // the tool knows the prompt is complete.
    child.stdin.on('error', () => undefined);
    child.stdin.end(run.input);
  });
}

/** ENOENT specifically — the file is not there, as opposed to refusing to run. */
function isMissing(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === 'ENOENT';
}

/**
 * Flattens a prompt into one system string and one user turn.
 *
 * These tools take a single prompt, so a conversation has to be written out
 * rather than sent as turns. Roles are labelled so the model can still tell
 * who said what; this is a real fidelity loss against an API and the reason
 * these providers suit a chat better than a long transcript.
 */
export function flattenPrompt(prompt: PromptSpec): { system: string | null; conversation: string } {
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
