/**
 * An in-memory POSIX-shaped filesystem.
 *
 * This is a *simulation*, not a sandbox around a real shell. Running actual
 * shell commands would mean either giving untrusted input a real filesystem
 * or building container isolation the project has deliberately deferred
 * (docs/code-execution.md). A simulation cannot be escaped from, because
 * there is nothing underneath it to escape to.
 *
 * The cost is honest and worth stating: commands behave the way this file
 * says they do, not the way GNU coreutils does. Where the two differ the user
 * is learning a fiction. So the command set is deliberately small and the
 * behaviours implemented are the ones that are unambiguous across systems —
 * the moment a flag's behaviour becomes distribution-specific, it is left out
 * rather than guessed at.
 */

export type NodeKind = 'file' | 'dir';

export interface FsNode {
  kind: NodeKind;
  /** Octal permission bits, e.g. 0o644. Enforced, not decorative. */
  mode: number;
  owner: string;
  group: string;
  /** Files only. */
  content?: string;
  /** Directories only. */
  children?: Map<string, FsNode>;
  mtime: number;
}

export interface FileSpec {
  content?: string;
  mode?: number;
  owner?: string;
  group?: string;
}

/** A directory tree as plain data, which is how scenarios are authored. */
export interface DirectorySpec {
  [name: string]: string | FileSpec | DirectorySpec;
}

export const DEFAULT_FILE_MODE = 0o644;
export const DEFAULT_DIR_MODE = 0o755;

export class FileSystemError extends Error {
  constructor(
    message: string,
    readonly code: 'ENOENT' | 'ENOTDIR' | 'EISDIR' | 'EEXIST' | 'EACCES' | 'ENOTEMPTY',
  ) {
    super(message);
    this.name = 'FileSystemError';
  }
}

export class VirtualFileSystem {
  private readonly root: FsNode;

  constructor(
    tree: DirectorySpec = {},
    private readonly user = 'forge',
  ) {
    this.root = dir(this.user, DEFAULT_DIR_MODE);
    this.populate(this.root, tree);
  }

  // -- Path handling --------------------------------------------------------

  /**
   * Resolves a path against a working directory.
   *
   * `..` is collapsed lexically rather than by walking, which matches how a
   * shell resolves it before the kernel sees it. Symlinks do not exist here,
   * so the two cannot diverge.
   */
  resolve(path: string, cwd = '/'): string {
    const absolute = path.startsWith('/') ? path : `${cwd}/${path}`;
    const parts: string[] = [];

    for (const segment of absolute.split('/')) {
      if (segment === '' || segment === '.') continue;
      if (segment === '..') {
        parts.pop();
        continue;
      }
      parts.push(segment);
    }

    return `/${parts.join('/')}`;
  }

  // -- Reads ----------------------------------------------------------------

  exists(path: string): boolean {
    return this.find(path) !== null;
  }

  isDirectory(path: string): boolean {
    return this.find(path)?.kind === 'dir';
  }

  stat(path: string): FsNode {
    const node = this.find(path);
    if (!node) throw new FileSystemError(`${path}: No such file or directory`, 'ENOENT');
    return node;
  }

  readFile(path: string): string {
    const node = this.stat(path);
    if (node.kind === 'dir') throw new FileSystemError(`${path}: Is a directory`, 'EISDIR');
    this.requireRead(node, path);
    return node.content ?? '';
  }

  readDir(path: string): string[] {
    const node = this.stat(path);
    if (node.kind !== 'dir') throw new FileSystemError(`${path}: Not a directory`, 'ENOTDIR');
    this.requireRead(node, path);
    return [...(node.children?.keys() ?? [])].sort();
  }

  /** Every path in the tree, absolute, sorted. Used by goal checks. */
  walk(from = '/'): string[] {
    const out: string[] = [];
    const visit = (node: FsNode, path: string) => {
      out.push(path === '' ? '/' : path);
      if (node.kind !== 'dir') return;
      for (const name of [...(node.children?.keys() ?? [])].sort()) {
        visit(node.children!.get(name)!, `${path}/${name}`);
      }
    };
    const start = this.stat(from);
    visit(start, from === '/' ? '' : from);
    return out;
  }

  // -- Writes ---------------------------------------------------------------

  writeFile(path: string, content: string, mode = DEFAULT_FILE_MODE): void {
    const { parent, name, parentPath } = this.split(path);
    this.requireWrite(parent, parentPath);

    const existing = parent.children!.get(name);
    if (existing?.kind === 'dir') throw new FileSystemError(`${path}: Is a directory`, 'EISDIR');
    if (existing) this.requireWrite(existing, path);

    parent.children!.set(name, {
      kind: 'file',
      mode: existing?.mode ?? mode,
      owner: existing?.owner ?? this.user,
      group: existing?.group ?? this.user,
      content,
      mtime: Date.now(),
    });
  }

  appendFile(path: string, content: string): void {
    const existing = this.find(path);
    this.writeFile(path, (existing?.content ?? '') + content);
  }

  mkdir(path: string, recursive = false): void {
    if (this.exists(path)) {
      if (recursive) return;
      throw new FileSystemError(`${path}: File exists`, 'EEXIST');
    }

    const { parent, name, parentPath } = recursive ? this.splitCreating(path) : this.split(path);

    this.requireWrite(parent, parentPath);
    parent.children!.set(name, dir(this.user, DEFAULT_DIR_MODE));
  }

  remove(path: string, recursive = false): void {
    if (path === '/') throw new FileSystemError('/: Permission denied', 'EACCES');

    const { parent, name, parentPath } = this.split(path);
    const node = parent.children?.get(name);
    if (!node) throw new FileSystemError(`${path}: No such file or directory`, 'ENOENT');

    if (node.kind === 'dir' && !recursive) {
      // Matches `rmdir`, and `rm` without -r: refusing is the whole point.
      if ((node.children?.size ?? 0) > 0) {
        throw new FileSystemError(`${path}: Directory not empty`, 'ENOTEMPTY');
      }
      throw new FileSystemError(`${path}: Is a directory`, 'EISDIR');
    }

    this.requireWrite(parent, parentPath);
    parent.children!.delete(name);
  }

  copy(from: string, to: string, recursive = false): void {
    const source = this.stat(from);
    this.requireRead(source, from);

    if (source.kind === 'dir' && !recursive) {
      throw new FileSystemError(`${from}: Is a directory`, 'EISDIR');
    }

    // Copying onto a directory means "into it", as cp does.
    const target = this.isDirectory(to) ? `${to}/${basename(from)}` : to;

    if (source.kind === 'file') {
      this.writeFile(target, source.content ?? '', source.mode);
      return;
    }

    this.mkdir(target, true);
    for (const name of source.children?.keys() ?? []) {
      this.copy(`${from}/${name}`, `${target}/${name}`, true);
    }
  }

  move(from: string, to: string): void {
    const target = this.isDirectory(to) ? `${to}/${basename(from)}` : to;
    this.copy(from, target, true);
    this.remove(from, true);
  }

  chmod(path: string, mode: number): void {
    const node = this.stat(path);
    node.mode = mode;
    node.mtime = Date.now();
  }

  chown(path: string, owner: string): void {
    const node = this.stat(path);
    node.owner = owner;
    node.mtime = Date.now();
  }

  // -- Permissions ----------------------------------------------------------

  /**
   * Permission bits are enforced rather than displayed.
   *
   * A Linux exercise where `chmod` changes a number that nothing reads is
   * theatre: the user can "fix" permissions without understanding what they
   * fixed, and learns that permissions are cosmetic — which is precisely the
   * misunderstanding these exercises exist to correct.
   */
  canRead(node: FsNode): boolean {
    return this.permitted(node, 0o400, 0o040, 0o004);
  }

  canWrite(node: FsNode): boolean {
    return this.permitted(node, 0o200, 0o020, 0o002);
  }

  canExecute(node: FsNode): boolean {
    return this.permitted(node, 0o100, 0o010, 0o001);
  }

  private permitted(node: FsNode, ownerBit: number, groupBit: number, otherBit: number): boolean {
    // root is not simulated: there is one user, and pretending otherwise
    // would need a sudo model that adds nothing to the exercise.
    if (node.owner === this.user) return (node.mode & ownerBit) !== 0;
    if (node.group === this.user) return (node.mode & groupBit) !== 0;
    return (node.mode & otherBit) !== 0;
  }

  private requireRead(node: FsNode, path: string): void {
    if (!this.canRead(node)) throw new FileSystemError(`${path}: Permission denied`, 'EACCES');
  }

  private requireWrite(node: FsNode, path: string): void {
    if (!this.canWrite(node)) throw new FileSystemError(`${path}: Permission denied`, 'EACCES');
  }

  // -- Internals ------------------------------------------------------------

  private find(path: string): FsNode | null {
    let node: FsNode = this.root;

    for (const segment of path.split('/').filter(Boolean)) {
      if (node.kind !== 'dir') return null;
      const next = node.children?.get(segment);
      if (!next) return null;
      node = next;
    }

    return node;
  }

  private split(path: string): { parent: FsNode; name: string; parentPath: string } {
    const parentPath = dirname(path);
    const parent = this.find(parentPath);

    if (!parent) throw new FileSystemError(`${parentPath}: No such file or directory`, 'ENOENT');
    if (parent.kind !== 'dir')
      throw new FileSystemError(`${parentPath}: Not a directory`, 'ENOTDIR');

    return { parent, name: basename(path), parentPath };
  }

  /** Like split, but creates missing intermediate directories (mkdir -p). */
  private splitCreating(path: string): { parent: FsNode; name: string; parentPath: string } {
    const segments = path.split('/').filter(Boolean);
    const name = segments.pop() ?? '';
    let node = this.root;
    let walked = '';

    for (const segment of segments) {
      walked += `/${segment}`;
      let next = node.children?.get(segment);
      if (!next) {
        this.requireWrite(node, walked);
        next = dir(this.user, DEFAULT_DIR_MODE);
        node.children!.set(segment, next);
      }
      if (next.kind !== 'dir') throw new FileSystemError(`${walked}: Not a directory`, 'ENOTDIR');
      node = next;
    }

    return { parent: node, name, parentPath: walked || '/' };
  }

  private populate(node: FsNode, spec: DirectorySpec): void {
    for (const [name, value] of Object.entries(spec)) {
      if (typeof value === 'string') {
        node.children!.set(name, file(value, DEFAULT_FILE_MODE, this.user));
        continue;
      }

      if (isFileSpec(value)) {
        node.children!.set(
          name,
          file(
            value.content ?? '',
            value.mode ?? DEFAULT_FILE_MODE,
            value.owner ?? this.user,
            value.group ?? value.owner ?? this.user,
          ),
        );
        continue;
      }

      const child = dir(this.user, DEFAULT_DIR_MODE);
      node.children!.set(name, child);
      this.populate(child, value);
    }
  }
}

// -- Helpers -----------------------------------------------------------------

export function dirname(path: string): string {
  const index = path.lastIndexOf('/');
  if (index <= 0) return '/';
  return path.slice(0, index);
}

export function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function dir(owner: string, mode: number): FsNode {
  return { kind: 'dir', mode, owner, group: owner, children: new Map(), mtime: Date.now() };
}

function file(content: string, mode: number, owner: string, group = owner): FsNode {
  return { kind: 'file', mode, owner, group, content, mtime: Date.now() };
}

/**
 * Distinguishes `{ content, mode }` from a nested directory.
 *
 * A directory named "content" would otherwise be read as a file spec, so the
 * check requires that every key belongs to FileSpec — a real subdirectory
 * almost always carries at least one key that does not.
 */
function isFileSpec(value: FileSpec | DirectorySpec): value is FileSpec {
  const keys = Object.keys(value);
  if (keys.length === 0) return false;
  const allowed = new Set(['content', 'mode', 'owner', 'group']);
  if (!keys.every((key) => allowed.has(key))) return false;
  const candidate = value as FileSpec;
  return (
    typeof candidate.content === 'string' ||
    typeof candidate.mode === 'number' ||
    typeof candidate.owner === 'string'
  );
}

export function formatMode(node: FsNode): string {
  const bits = ['r', 'w', 'x'];
  let out = node.kind === 'dir' ? 'd' : '-';
  for (let shift = 6; shift >= 0; shift -= 3) {
    for (let bit = 0; bit < 3; bit += 1) {
      out += node.mode & (1 << (shift + (2 - bit))) ? bits[bit] : '-';
    }
  }
  return out;
}
