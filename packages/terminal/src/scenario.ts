import type { DirectorySpec } from './filesystem.js';
import { Shell, type CommandResult } from './shell.js';

/**
 * A terminal scenario: a starting filesystem, a task, and checks that decide
 * whether the task was done.
 *
 * Checks run against the *end state*, not against the commands typed. There
 * are five ways to remove a file and a scenario that only accepts one of them
 * is testing recall of a particular incantation rather than whether the user
 * can operate a machine. The exception is `commandUsed`, which exists for the
 * rare case where the method is the point — "do this without deleting
 * anything" is a real constraint, and only the history can show it.
 */

export type GoalCheck =
  | { kind: 'fileExists'; path: string }
  | { kind: 'fileAbsent'; path: string }
  | { kind: 'fileContains'; path: string; text: string }
  | { kind: 'fileEquals'; path: string; content: string }
  | { kind: 'fileMode'; path: string; mode: number }
  | { kind: 'fileOwner'; path: string; owner: string }
  | { kind: 'directoryExists'; path: string }
  | { kind: 'cwdIs'; path: string }
  /** Matched against the final command's stdout. */
  | { kind: 'outputMatches'; pattern: string }
  /** The method is the point. Use sparingly. */
  | { kind: 'commandUsed'; pattern: string }
  | { kind: 'commandNotUsed'; pattern: string };

export interface TerminalScenario {
  slug: string;
  title: string;
  /** What the user is asked to achieve, in plain terms. */
  task: string;
  tree: DirectorySpec;
  cwd?: string;
  user?: string;
  env?: Record<string, string>;
  checks: GoalCheck[];
  /** Questions, never answers — the same rule as exercise hints. */
  hints?: string[];
}

export interface CheckResult {
  check: GoalCheck;
  passed: boolean;
  detail: string;
}

export interface ScenarioResult {
  passed: boolean;
  checks: CheckResult[];
  /** Every command and what it printed, for the transcript. */
  transcript: { command: string; result: CommandResult }[];
}

/**
 * Replays a list of commands against a fresh scenario and grades the result.
 *
 * Replayed rather than kept live between requests: the API is stateless and a
 * shell held in memory would not survive a restart, a second tab, or a second
 * process behind PM2. Replaying is cheap — the whole filesystem is a Map.
 */
export function runScenario(
  scenario: TerminalScenario,
  commands: readonly string[],
): ScenarioResult {
  const shell = new Shell({
    tree: scenario.tree,
    cwd: scenario.cwd,
    user: scenario.user,
    env: scenario.env,
  });

  const transcript = commands.map((command) => ({ command, result: shell.run(command) }));
  const lastOutput = transcript[transcript.length - 1]?.result.stdout ?? '';

  const checks = scenario.checks.map((check) => evaluate(shell, check, lastOutput));

  return { passed: checks.every((check) => check.passed), checks, transcript };
}

function evaluate(shell: Shell, check: GoalCheck, lastOutput: string): CheckResult {
  const history = shell.state.history.join('\n');

  try {
    switch (check.kind) {
      case 'fileExists':
        return result(check, shell.fs.exists(check.path), `${check.path} exists`);

      case 'fileAbsent':
        return result(check, !shell.fs.exists(check.path), `${check.path} is gone`);

      case 'directoryExists':
        return result(check, shell.fs.isDirectory(check.path), `${check.path} is a directory`);

      case 'fileContains': {
        const content = shell.fs.exists(check.path) ? shell.fs.readFile(check.path) : '';
        return result(check, content.includes(check.text), `${check.path} contains "${check.text}"`);
      }

      case 'fileEquals': {
        const content = shell.fs.exists(check.path) ? shell.fs.readFile(check.path) : null;
        // Trailing newlines are an accident of how the content was written,
        // not something worth failing a Linux exercise over.
        const same = content !== null && content.replace(/\n$/, '') === check.content.replace(/\n$/, '');
        return result(check, same, `${check.path} has the expected contents`);
      }

      case 'fileMode': {
        if (!shell.fs.exists(check.path)) {
          return result(check, false, `${check.path} does not exist`);
        }
        const actual = shell.fs.stat(check.path).mode & 0o7777;
        return result(
          check,
          actual === check.mode,
          `${check.path} is ${actual.toString(8)}, expected ${check.mode.toString(8)}`,
        );
      }

      case 'fileOwner': {
        if (!shell.fs.exists(check.path)) {
          return result(check, false, `${check.path} does not exist`);
        }
        const owner = shell.fs.stat(check.path).owner;
        return result(check, owner === check.owner, `${check.path} is owned by ${owner}`);
      }

      case 'cwdIs':
        return result(
          check,
          shell.state.cwd === check.path,
          `working directory is ${shell.state.cwd}`,
        );

      case 'outputMatches':
        return result(
          check,
          new RegExp(check.pattern).test(lastOutput),
          `last output ${new RegExp(check.pattern).test(lastOutput) ? 'matches' : 'does not match'} /${check.pattern}/`,
        );

      case 'commandUsed':
        return result(check, new RegExp(check.pattern).test(history), `used /${check.pattern}/`);

      case 'commandNotUsed':
        return result(
          check,
          !new RegExp(check.pattern).test(history),
          `avoided /${check.pattern}/`,
        );
    }
  } catch (error) {
    // A check that throws is a broken scenario, not a failed attempt. Say so
    // rather than telling the user they got it wrong.
    return {
      check,
      passed: false,
      detail: `check could not run: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function result(check: GoalCheck, passed: boolean, detail: string): CheckResult {
  return { check, passed, detail };
}

/** Human-readable, shown beside each check in the results panel. */
export function describeCheck(check: GoalCheck): string {
  switch (check.kind) {
    case 'fileExists':
      return `${check.path} exists`;
    case 'fileAbsent':
      return `${check.path} has been removed`;
    case 'directoryExists':
      return `${check.path} is a directory`;
    case 'fileContains':
      return `${check.path} contains "${check.text}"`;
    case 'fileEquals':
      return `${check.path} has the right contents`;
    case 'fileMode':
      return `${check.path} is mode ${check.mode.toString(8)}`;
    case 'fileOwner':
      return `${check.path} is owned by ${check.owner}`;
    case 'cwdIs':
      return `you end up in ${check.path}`;
    case 'outputMatches':
      return `the last command prints something matching /${check.pattern}/`;
    case 'commandUsed':
      return `you used ${check.pattern}`;
    case 'commandNotUsed':
      return `you did not use ${check.pattern}`;
  }
}
