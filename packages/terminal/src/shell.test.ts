import { describe, expect, it } from 'vitest';

import { Shell } from './shell.js';

/**
 * The simulator's value depends entirely on it behaving the way a real shell
 * does. Where it cannot, it must refuse rather than improvise: a shell that
 * quietly does the wrong thing with quoting teaches the user that quoting
 * works that way, and they carry it to a real machine.
 */

/** Trims the trailing newline a real command emits, for readable assertions. */
function out(result: { stdout: string }): string {
  return result.stdout.replace(/\n$/, '');
}

function shell() {
  return new Shell({
    tree: {
      home: {
        forge: {
          'notes.txt': 'alpha\nbeta\ngamma\n',
          'secret.txt': { content: 'hidden', mode: 0o000 },
          '.hidden': 'dotfile\n',
          work: { 'a.log': 'one\n', 'b.log': 'two\n', 'readme.md': 'docs\n' },
        },
      },
      var: { log: { 'app.log': 'INFO up\nERROR down\nINFO up again\n' } },
    },
    cwd: '/home/forge',
  });
}

describe('navigation', () => {
  it('resolves .. lexically', () => {
    const sh = shell();
    expect(sh.run('cd work/../work').exitCode).toBe(0);
    expect(out(sh.run('pwd'))).toBe('/home/forge/work');
  });

  it('refuses to cd into a file', () => {
    const result = shell().run('cd notes.txt');
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('Not a directory');
  });

  it('cd with no argument goes home', () => {
    const sh = shell();
    sh.run('cd /var/log');
    sh.run('cd');
    expect(out(sh.run('pwd'))).toBe('/home/forge');
  });
});

describe('listing', () => {
  it('hides dotfiles unless -a', () => {
    const sh = shell();
    expect(out(sh.run('ls'))).not.toContain('.hidden');
    expect(out(sh.run('ls -a'))).toContain('.hidden');
  });

  it('-l shows the mode string', () => {
    expect(out(shell().run('ls -l'))).toContain('-rw-r--r--');
  });
});

describe('permissions are enforced, not decorative', () => {
  it('refuses to read a file with no read bit', () => {
    const result = shell().run('cat secret.txt');
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('Permission denied');
  });

  it('allows the read once chmod grants it', () => {
    const sh = shell();
    expect(sh.run('chmod 600 secret.txt').exitCode).toBe(0);
    expect(sh.run('cat secret.txt').stdout).toBe('hidden');
  });

  it('rejects symbolic modes rather than guessing at them', () => {
    const result = shell().run('chmod u+x notes.txt');
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('octal');
  });
});

describe('redirection', () => {
  it('> replaces and >> appends', () => {
    // echo terminates its output, so an appended second line starts on its
    // own line rather than running into the first.
    const sh = shell();
    sh.run('echo one > out.txt');
    sh.run('echo two >> out.txt');
    expect(sh.run('cat out.txt').stdout).toBe('one\ntwo\n');
  });

  it('> truncates rather than appending', () => {
    const sh = shell();
    sh.run('echo one > out.txt');
    sh.run('echo two > out.txt');
    expect(sh.run('cat out.txt').stdout).toBe('two\n');
  });

  it('redirected output does not also print', () => {
    const sh = shell();
    expect(sh.run('echo hello > out.txt').stdout).toBe('');
  });

  it('does not redirect when the command failed', () => {
    const sh = shell();
    sh.run('cat missing.txt > out.txt');
    expect(sh.fs.exists('/home/forge/out.txt')).toBe(false);
  });
});

describe('pipelines', () => {
  it('passes stdout to the next stage', () => {
    expect(out(shell().run('cat /var/log/app.log | grep ERROR'))).toBe('ERROR down');
  });

  it('counts through a pipeline', () => {
    expect(out(shell().run('cat /var/log/app.log | grep INFO | wc -l'))).toBe('2');
  });

  it('stops at the first failing stage', () => {
    const result = shell().run('cat missing.txt | wc -l');
    expect(result.exitCode).not.toBe(0);
  });
});

describe('quoting', () => {
  it('does not split a quoted argument on spaces', () => {
    const sh = shell();
    sh.run('echo "hello world" > out.txt');
    expect(out(sh.run('cat out.txt'))).toBe('hello world');
  });

  it('does not treat a quoted pipe as a pipeline', () => {
    // The naive split('|') bug: `grep "a|b"` must search for the pattern,
    // not pipe grep into b.
    const sh = shell();
    sh.run('echo "a|b" > out.txt');
    expect(out(sh.run('grep "a|b" out.txt'))).toBe('a|b');
  });

  it('single quotes suppress variable expansion in double-quote position', () => {
    const sh = shell();
    expect(out(sh.run('echo $USER'))).toBe('forge');
  });
});

describe('sequencing', () => {
  it('&& is not mistaken for a background job', () => {
    // `&(?!&)` matched the second ampersand of `&&` and rejected every
    // chained command. Nothing else in the suite would have caught it.
    expect(shell().run('cd work && pwd').exitCode).toBe(0);
  });

  it('&& stops on failure', () => {
    const sh = shell();
    sh.run('cat missing.txt && echo reached > out.txt');
    expect(sh.fs.exists('/home/forge/out.txt')).toBe(false);
  });

  it('&& continues on success', () => {
    const sh = shell();
    sh.run('cd work && pwd > /home/forge/out.txt');
    expect(out(sh.run('cat /home/forge/out.txt'))).toBe('/home/forge/work');
  });

  it('; continues regardless', () => {
    const sh = shell();
    sh.run('cat missing.txt ; echo reached > out.txt');
    expect(sh.fs.exists('/home/forge/out.txt')).toBe(true);
  });
});

describe('refusing what it cannot do', () => {
  it.each(['echo `date`', 'echo $(date)', 'sleep 1 &', 'false || echo fallback'])(
    'rejects %s rather than misinterpreting it',
    (line) => {
      const result = shell().run(line);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('does not support');
    },
  );

  it('reports an unknown command the way a shell does', () => {
    const result = shell().run('kubectl get pods');
    expect(result.exitCode).toBe(127);
    expect(result.stderr).toContain('command not found');
  });
});

describe('file manipulation', () => {
  it('mkdir -p creates intermediate directories', () => {
    const sh = shell();
    expect(sh.run('mkdir -p a/b/c').exitCode).toBe(0);
    expect(sh.fs.isDirectory('/home/forge/a/b/c')).toBe(true);
  });

  it('mkdir without -p refuses a missing parent', () => {
    expect(shell().run('mkdir a/b/c').exitCode).not.toBe(0);
  });

  it('rm refuses a directory without -r', () => {
    const result = shell().run('rm work');
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/directory/i);
  });

  it('cp -r copies a tree', () => {
    const sh = shell();
    sh.run('cp -r work backup');
    expect(sh.run('cat backup/a.log').stdout).toBe('one\n');
  });

  it('mv into a directory keeps the basename', () => {
    const sh = shell();
    sh.run('mkdir archive');
    sh.run('mv notes.txt archive');
    expect(sh.fs.exists('/home/forge/archive/notes.txt')).toBe(true);
    expect(sh.fs.exists('/home/forge/notes.txt')).toBe(false);
  });

  it('expands a leading glob', () => {
    const sh = shell();
    sh.run('cd work');
    sh.run('rm *.log');
    expect(sh.fs.exists('/home/forge/work/a.log')).toBe(false);
    expect(sh.fs.exists('/home/forge/work/b.log')).toBe(false);
    expect(sh.fs.exists('/home/forge/work/readme.md')).toBe(true);
  });

  it('expands a trailing glob', () => {
    const sh = shell();
    sh.run('cd work');
    sh.run('rm a*');
    expect(sh.fs.exists('/home/forge/work/a.log')).toBe(false);
    expect(sh.fs.exists('/home/forge/work/b.log')).toBe(true);
  });

  it('a glob does not match dotfiles', () => {
    const sh = shell();
    sh.run('rm *.txt');
    expect(sh.fs.exists('/home/forge/.hidden')).toBe(true);
  });

  it('leaves an unmatched pattern alone, so the error names it', () => {
    const result = shell().run('cat /home/forge/*.nope');
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('*.nope');
  });
});

describe('text tools', () => {
  it('head and tail take -n', () => {
    const sh = shell();
    expect(out(sh.run('head -n 2 notes.txt'))).toBe('alpha\nbeta');
    expect(out(sh.run('tail -n 1 notes.txt'))).toBe('gamma');
  });

  it('grep -v inverts', () => {
    expect(out(shell().run('grep -v INFO /var/log/app.log'))).toBe('ERROR down');
  });

  it('grep exits 1 when nothing matched', () => {
    expect(shell().run('grep nothing notes.txt').exitCode).toBe(1);
  });

  it('find -name matches a glob', () => {
    const output = out(shell().run('find /home/forge/work -name "*.log"'));
    expect(output).toContain('/home/forge/work/a.log');
    expect(output).not.toContain('readme.md');
  });

  it('find -type d returns only directories', () => {
    const output = out(shell().run('find /home/forge -type d'));
    expect(output).toContain('/home/forge/work');
    expect(output).not.toContain('notes.txt');
  });
});

describe('history', () => {
  it('records every line, so method-based checks are possible', () => {
    const sh = shell();
    sh.run('ls');
    sh.run('pwd');
    expect(sh.state.history).toEqual(['ls', 'pwd']);
  });

  it('does not record blank lines', () => {
    const sh = shell();
    sh.run('   ');
    expect(sh.state.history).toEqual([]);
  });
});
