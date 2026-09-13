import {
  FileSystemError,
  VirtualFileSystem,
  basename,
  formatMode,
  type DirectorySpec,
} from './filesystem.js';

/**
 * A simulated shell over the in-memory filesystem.
 *
 * Supports the subset of shell grammar the exercises actually need: single
 * and double quoting, `>` and `>>` redirection, `|` pipelines, `&&` and `;`
 * sequencing, and `$VAR` expansion. Everything else — subshells, globbing
 * beyond a trailing `*`, process substitution, job control — is rejected with
 * a clear message rather than silently misinterpreted.
 *
 * Rejecting loudly matters more than coverage here. A shell that quietly does
 * the wrong thing with backticks teaches the user that backticks do that, and
 * they will carry it to a real terminal.
 */

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ShellState {
  cwd: string;
  env: Record<string, string>;
  /** Every command line entered, in order. Goal checks read this. */
  history: string[];
}

export interface ShellOptions {
  tree?: DirectorySpec;
  cwd?: string;
  user?: string;
  env?: Record<string, string>;
}

/**
 * Constructs this shell will refuse rather than approximate.
 *
 * `&&` is supported and must not be caught here, so the check strips it
 * before looking for a bare `&`. Getting that wrong rejected every
 * `cd x && ls` — which the tests found and a user would have hit immediately.
 */
function unsupportedConstruct(line: string): boolean {
  if (/[`]/.test(line)) return true;
  if (/\$[({]/.test(line)) return true;
  if (/<\(/.test(line)) return true;
  if (/\|\|/.test(line)) return true;
  return /&/.test(line.replace(/&&/g, ''));
}

export class Shell {
  readonly fs: VirtualFileSystem;
  readonly state: ShellState;

  constructor(options: ShellOptions = {}) {
    const user = options.user ?? 'forge';
    this.fs = new VirtualFileSystem(options.tree ?? {}, user);
    this.state = {
      cwd: options.cwd ?? `/home/${user}`,
      env: {
        HOME: `/home/${user}`,
        USER: user,
        PWD: options.cwd ?? `/home/${user}`,
        ...options.env,
      },
      history: [],
    };
  }

  /** Runs one line. Never throws: a shell reports errors, it does not crash. */
  run(line: string): CommandResult {
    const trimmed = line.trim();
    if (trimmed === '') return ok('');

    this.state.history.push(trimmed);

    if (unsupportedConstruct(trimmed)) {
      return fail(
        'This simulated shell does not support subshells, command substitution, ' +
          'background jobs or ||. Everything it does support behaves as it would ' +
          'on a real system.',
      );
    }

    // `&&` binds tighter than `;` in the sense that matters here: a failing
    // command stops its && chain but not the next ;-separated statement.
    let last = ok('');

    for (const statement of splitOn(trimmed, ';')) {
      last = ok('');
      for (const chained of splitOn(statement, '&&')) {
        last = this.runPipeline(chained);
        if (last.exitCode !== 0) break;
      }
    }

    return last;
  }

  private runPipeline(segment: string): CommandResult {
    const stages = splitOn(segment, '|');
    let input = '';
    let result = ok('');

    for (const stage of stages) {
      result = this.runRedirected(stage, input);
      if (result.exitCode !== 0) return result;
      input = result.stdout;
    }

    return result;
  }

  private runRedirected(segment: string, stdin: string): CommandResult {
    const append = / >> /.test(` ${segment} `) || /\s>>\s*\S/.test(segment);
    const match = segment.match(/^(.*?)\s*(>>|>)\s*(\S+)\s*$/);

    if (!match) return this.runSimple(segment, stdin);

    const [, command, , target] = match;
    const result = this.runSimple(command ?? '', stdin);
    if (result.exitCode !== 0) return result;

    const path = this.fs.resolve(this.expand(target ?? ''), this.state.cwd);

    try {
      if (append) this.fs.appendFile(path, result.stdout);
      else this.fs.writeFile(path, result.stdout);
    } catch (error) {
      return fail(describe(error));
    }

    // Redirected output leaves the pipeline; only the exit code continues.
    return { stdout: '', stderr: result.stderr, exitCode: 0 };
  }

  private runSimple(segment: string, stdin: string): CommandResult {
    const tokens = tokenize(segment).map((token) => this.expand(token));
    const [name, ...args] = tokens;
    if (!name) return ok('');

    const command = COMMANDS[name];
    if (!command) return fail(`${name}: command not found`, 127);

    try {
      return command(this, args, stdin);
    } catch (error) {
      return fail(`${name}: ${describe(error)}`);
    }
  }

  // -- Helpers used by commands --------------------------------------------

  path(argument: string): string {
    return this.fs.resolve(argument, this.state.cwd);
  }

  /**
   * Expands `*` and `?` within the final path segment.
   *
   * Not full glob: no `**`, no brace expansion, no character classes, and no
   * matching across directory separators. Those are left out rather than
   * half-implemented, because a glob that is subtly wrong teaches the user
   * this shell's rules instead of the real ones.
   *
   * An unmatched pattern is returned unchanged, as a shell does with
   * `nullglob` off — so the command reports "no such file" against the
   * pattern itself, which is what a real terminal shows.
   */
  glob(pattern: string): string[] {
    const slash = pattern.lastIndexOf('/');
    const directory = slash >= 0 ? pattern.slice(0, slash) || '/' : '.';
    const segment = pattern.slice(slash + 1);

    if (!/[*?]/.test(segment)) return [pattern];

    const matcher = new RegExp(
      `^${segment
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '[^/]')}$`,
    );

    try {
      const matched = this.fs
        .readDir(this.path(directory))
        // A glob does not match dotfiles unless the pattern starts with a dot.
        .filter(
          (entry) => matcher.test(entry) && (segment.startsWith('.') || !entry.startsWith('.')),
        )
        .map((entry) => (slash >= 0 ? `${pattern.slice(0, slash)}/${entry}` : entry));

      return matched.length > 0 ? matched : [pattern];
    } catch {
      return [pattern];
    }
  }

  private expand(token: string): string {
    return token.replace(/\$(\w+)/g, (whole, name: string) => this.state.env[name] ?? whole);
  }
}

// -- Commands ----------------------------------------------------------------

type Command = (shell: Shell, args: string[], stdin: string) => CommandResult;

const COMMANDS: Record<string, Command> = {
  pwd: (shell) => ok(`${shell.state.cwd}\n`),

  cd: (shell, args) => {
    const target = shell.path(args[0] ?? shell.state.env.HOME ?? '/');
    if (!shell.fs.exists(target)) return fail(`cd: ${args[0]}: No such file or directory`);
    if (!shell.fs.isDirectory(target)) return fail(`cd: ${args[0]}: Not a directory`);
    shell.state.cwd = target;
    shell.state.env.PWD = target;
    return ok('');
  },

  ls: (shell, args) => {
    const { flags, operands } = parseFlags(args);
    const targets = operands.length > 0 ? operands : ['.'];
    const long = flags.has('l');
    const all = flags.has('a');
    const blocks: string[] = [];

    for (const target of targets) {
      const path = shell.path(target);
      if (!shell.fs.exists(path)) return fail(`ls: ${target}: No such file or directory`);

      const names = shell.fs.isDirectory(path) ? shell.fs.readDir(path) : [basename(path)];
      const visible = all ? names : names.filter((name) => !name.startsWith('.'));

      const rendered = long
        ? visible
            .map((name) => {
              const node = shell.fs.stat(shell.fs.isDirectory(path) ? `${path}/${name}` : path);
              const size = node.kind === 'dir' ? 4096 : (node.content ?? '').length;
              return `${formatMode(node)} ${node.owner} ${node.group} ${String(size).padStart(6)} ${name}`;
            })
            .join('\n')
        : visible.join('\n');

      blocks.push(targets.length > 1 ? `${target}:\n${rendered}` : rendered);
    }

    return okLines(blocks.join('\n\n'));
  },

  cat: (shell, args, stdin) => {
    if (args.length === 0) return ok(stdin);
    const parts: string[] = [];
    for (const argument of args.flatMap((a) => shell.glob(a))) {
      parts.push(shell.fs.readFile(shell.path(argument)));
    }
    return ok(parts.join(''));
  },

  echo: (_shell, args) => ok(`${args.join(' ')}\n`),

  touch: (shell, args) => {
    for (const argument of args) {
      const path = shell.path(argument);
      if (!shell.fs.exists(path)) shell.fs.writeFile(path, '');
    }
    return ok('');
  },

  mkdir: (shell, args) => {
    const { flags, operands } = parseFlags(args);
    for (const argument of operands) shell.fs.mkdir(shell.path(argument), flags.has('p'));
    return ok('');
  },

  rmdir: (shell, args) => {
    for (const argument of args) shell.fs.remove(shell.path(argument), false);
    return ok('');
  },

  rm: (shell, args) => {
    const { flags, operands } = parseFlags(args);
    const recursive = flags.has('r') || flags.has('R');
    for (const argument of operands.flatMap((a) => shell.glob(a))) {
      shell.fs.remove(shell.path(argument), recursive);
    }
    return ok('');
  },

  cp: (shell, args) => {
    const { flags, operands } = parseFlags(args);
    const to = operands.pop();
    if (!to || operands.length === 0) return fail('cp: missing file operand');
    for (const from of operands.flatMap((a) => shell.glob(a))) {
      shell.fs.copy(shell.path(from), shell.path(to), flags.has('r') || flags.has('R'));
    }
    return ok('');
  },

  mv: (shell, args) => {
    const to = args[args.length - 1];
    const sources = args.slice(0, -1);
    if (!to || sources.length === 0) return fail('mv: missing file operand');
    for (const from of sources.flatMap((a) => shell.glob(a))) {
      shell.fs.move(shell.path(from), shell.path(to));
    }
    return ok('');
  },

  chmod: (shell, args) => {
    const [mode, ...paths] = args;
    if (!mode || paths.length === 0) return fail('chmod: missing operand');
    if (!/^[0-7]{3,4}$/.test(mode)) {
      // Symbolic modes (u+x) are a second parser and a second set of edge
      // cases; octal is unambiguous and is what the exercises ask for.
      return fail('chmod: this shell accepts octal modes only, for example 644');
    }
    for (const path of paths) shell.fs.chmod(shell.path(path), Number.parseInt(mode, 8));
    return ok('');
  },

  chown: (shell, args) => {
    const [owner, ...paths] = args;
    if (!owner || paths.length === 0) return fail('chown: missing operand');
    for (const path of paths) shell.fs.chown(shell.path(path), owner.split(':')[0]!);
    return ok('');
  },

  head: (shell, args, stdin) => lines(shell, args, stdin, 'head'),
  tail: (shell, args, stdin) => lines(shell, args, stdin, 'tail'),

  wc: (shell, args, stdin) => {
    const { flags, operands } = parseFlags(args);
    const text = operands[0] ? shell.fs.readFile(shell.path(operands[0])) : stdin;
    const lineCount = toLines(text).length;
    const wordCount = text.split(/\s+/).filter(Boolean).length;

    if (flags.has('l')) return ok(`${lineCount}\n`);
    if (flags.has('w')) return ok(`${wordCount}\n`);
    if (flags.has('c')) return ok(`${text.length}\n`);
    return ok(`${lineCount} ${wordCount} ${text.length}\n`);
  },

  grep: (shell, args, stdin) => {
    const { flags, operands } = parseFlags(args);
    const [pattern, ...paths] = operands;
    if (!pattern) return fail('grep: missing pattern');

    let regex: RegExp;
    try {
      regex = new RegExp(pattern, flags.has('i') ? 'i' : '');
    } catch {
      return fail(`grep: invalid pattern: ${pattern}`);
    }

    const invert = flags.has('v');
    const withFilename = paths.length > 1;
    const out: string[] = [];
    let matched = false;

    const scan = (text: string, label?: string) => {
      for (const line of toLines(text)) {
        if (regex.test(line) !== invert) {
          matched = true;
          out.push(label ? `${label}:${line}` : line);
        }
      }
    };

    if (paths.length === 0) scan(stdin);
    else {
      for (const path of paths.flatMap((p) => shell.glob(p))) {
        scan(shell.fs.readFile(shell.path(path)), withFilename ? path : undefined);
      }
    }

    if (flags.has('c')) return ok(`${out.length}\n`);
    // grep exits 1 when nothing matched, which scripts rely on.
    return { ...okLines(out.join('\n')), exitCode: matched ? 0 : 1 };
  },

  find: (shell, args) => {
    const [root = '.', ...rest] = args;
    const nameIndex = rest.indexOf('-name');
    const pattern = nameIndex >= 0 ? rest[nameIndex + 1] : undefined;
    const typeIndex = rest.indexOf('-type');
    const type = typeIndex >= 0 ? rest[typeIndex + 1] : undefined;

    const base = shell.path(root);
    const matcher = pattern
      ? new RegExp(
          `^${pattern
            .replace(/[.+^${}()|[\]\\]/g, '\\$&')
            .replace(/\*/g, '.*')
            .replace(/\?/g, '.')}$`,
        )
      : null;

    const results = shell.fs.walk(base).filter((path) => {
      if (matcher && !matcher.test(basename(path))) return false;
      if (type === 'f' && shell.fs.isDirectory(path)) return false;
      if (type === 'd' && !shell.fs.isDirectory(path)) return false;
      return true;
    });

    // find prints paths as given, so a relative root yields relative output.
    const prefix = root.startsWith('/') ? null : root.replace(/\/$/, '');
    return okLines(
      results
        .map((path) =>
          prefix === null ? path : path === base ? prefix : `${prefix}${path.slice(base.length)}`,
        )
        .join('\n'),
    );
  },

  sort: (_shell, args, stdin) => {
    const { flags } = parseFlags(args);
    const sorted = toLines(stdin).sort();
    if (flags.has('r')) sorted.reverse();
    return okLines(sorted.join('\n'));
  },

  uniq: (_shell, _args, stdin) => {
    const out: string[] = [];
    // Adjacent duplicates only, like the real thing. uniq on unsorted input
    // surprising people is a lesson worth preserving.
    for (const line of toLines(stdin)) {
      if (out[out.length - 1] !== line) out.push(line);
    }
    return okLines(out.join('\n'));
  },

  env: (shell) =>
    okLines(
      Object.entries(shell.state.env)
        .map(([key, value]) => `${key}=${value}`)
        .sort()
        .join('\n'),
    ),

  export: (shell, args) => {
    for (const argument of args) {
      const [key, ...rest] = argument.split('=');
      if (key && rest.length > 0) shell.state.env[key] = rest.join('=');
    }
    return ok('');
  },

  whoami: (shell) => ok(`${shell.state.env.USER ?? 'forge'}\n`),

  history: (shell) => okLines(shell.state.history.map((line, i) => `${i + 1}  ${line}`).join('\n')),
};

/** Every command this shell knows. Shown to the user so they are not guessing. */
export const SUPPORTED_COMMANDS = Object.keys(COMMANDS).sort();

// -- Parsing -----------------------------------------------------------------

/**
 * Splits on a separator, ignoring occurrences inside quotes.
 *
 * A naive `split('|')` breaks `grep "a|b" file`, which is exactly the kind of
 * quiet wrongness that teaches the user something false.
 */
function splitOn(input: string, separator: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quote: string | null = null;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]!;

    if (quote) {
      if (character === quote) quote = null;
      current += character;
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      current += character;
      continue;
    }

    if (input.startsWith(separator, index)) {
      parts.push(current.trim());
      current = '';
      index += separator.length - 1;
      continue;
    }

    current += character;
  }

  parts.push(current.trim());
  return parts.filter((part) => part !== '');
}

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: string | null = null;
  let started = false;

  for (const character of input) {
    if (quote) {
      if (character === quote) quote = null;
      else current += character;
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      started = true;
      continue;
    }

    if (/\s/.test(character)) {
      if (started || current !== '') tokens.push(current);
      current = '';
      started = false;
      continue;
    }

    current += character;
  }

  if (started || current !== '') tokens.push(current);
  return tokens;
}

/** Separates `-la` style flags from operands. `--` ends flag parsing. */
function parseFlags(args: readonly string[]): { flags: Set<string>; operands: string[] } {
  const flags = new Set<string>();
  const operands: string[] = [];
  let literal = false;

  for (const argument of args) {
    if (literal || !argument.startsWith('-') || argument === '-') {
      operands.push(argument);
      continue;
    }
    if (argument === '--') {
      literal = true;
      continue;
    }
    // A numeric flag like `-5` is an argument to head/tail, not a flag.
    if (/^-\d+$/.test(argument)) {
      operands.push(argument);
      continue;
    }
    for (const character of argument.replace(/^-+/, '')) flags.add(character);
  }

  return { flags, operands };
}

function lines(shell: Shell, args: string[], stdin: string, which: 'head' | 'tail'): CommandResult {
  const { operands } = parseFlags(args);

  const countIndex = operands.findIndex((operand) => /^-?\d+$/.test(operand));
  const count = countIndex >= 0 ? Math.abs(Number(operands[countIndex])) : 10;
  const paths = operands.filter((_, index) => index !== countIndex);

  const nIndex = args.indexOf('-n');
  const explicit = nIndex >= 0 ? Number(args[nIndex + 1]) : null;
  const limit = explicit !== null && Number.isFinite(explicit) ? explicit : count;

  const text = paths[0] ? shell.fs.readFile(shell.path(paths[0])) : stdin;
  const all = toLines(text);
  const selected = which === 'head' ? all.slice(0, limit) : all.slice(-limit);

  return okLines(selected.join('\n'));
}

// -- Results -----------------------------------------------------------------

function ok(stdout: string): CommandResult {
  return { stdout, stderr: '', exitCode: 0 };
}

/**
 * Line-oriented output, newline-terminated as a real command's would be —
 * but empty output stays genuinely empty rather than becoming a blank line.
 *
 * This matters beyond cosmetics: `cmd > file` writes stdout verbatim, so a
 * command that dropped its trailing newline would produce files that silently
 * concatenate on the next append.
 */
function okLines(text: string): CommandResult {
  return ok(text === '' ? '' : `${text}\n`);
}

/** Splits text into lines, ignoring the empty one a trailing newline implies. */
function toLines(text: string): string[] {
  if (text === '') return [];
  return text.replace(/\n$/, '').split('\n');
}

function fail(stderr: string, exitCode = 1): CommandResult {
  return { stdout: '', stderr, exitCode };
}

function describe(error: unknown): string {
  if (error instanceof FileSystemError) return error.message;
  return error instanceof Error ? error.message : String(error);
}
