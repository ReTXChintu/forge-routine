import Editor from '@monaco-editor/react';
import { useState } from 'react';

import { Icon } from '~/components/Icon';
import { Button } from '~/components/ui';
import { useRunScratch } from '~/lib/queries';

/**
 * A scratchpad beside a worked example.
 *
 * Reading "reverse it in place by swapping the ends" and then doing it are
 * different things, and only the second one sticks. So each example can be
 * opened into an editor and run.
 *
 * **Nothing here is graded or recorded.** No attempt is opened, no skill
 * moves, and no practice assignment is created — so trying an example out can
 * never add to what a concept needs before it is finished, and skipping every
 * one of them can never hold anything up. Optional practice that quietly
 * becomes compulsory would be worse than no button at all.
 */
export function TryItOut({
  example,
  language,
}: {
  example: string;
  /** The concept's own language, so the editor highlights what will run. */
  language: 'javascript' | 'typescript';
}) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState(() => starterFor(example, language));

  const run = useRunScratch();
  const result = run.data;

  if (!open) {
    return (
      <Button variant="ghost" size="sm" icon="code" onClick={() => setOpen(true)}>
        Try it out
      </Button>
    );
  }

  return (
    <div className="col g2 mt2">
      <div className="editor-shell" style={{ height: 240 }}>
        <div className="editor-tabbar">
          <div className="editor-tab active">
            <Icon name="code" size={13} />
            scratch.{language === 'typescript' ? 'ts' : 'js'}
          </div>
          <span className="t-caption" style={{ padding: '0 10px' }}>
            Nothing here is marked or saved
          </span>
        </div>

        <div style={{ flex: 1, minHeight: 0 }}>
          <Editor
            height="100%"
            language={language}
            theme="vs-dark"
            value={code}
            onChange={(value) => setCode(value ?? '')}
            options={{
              fontSize: 12.5,
              fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              padding: { top: 10 },
              tabSize: 2,
              lineNumbers: 'off',
              folding: false,
            }}
          />
        </div>
      </div>

      <div className="row items-center g2">
        <Button
          size="sm"
          icon="play"
          onClick={() => run.mutate({ code, language })}
          disabled={run.isPending || code.trim().length === 0}
        >
          {run.isPending ? 'Running…' : 'Run'}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Close
        </Button>
        {result && <span className="t-caption">{result.durationMs}ms</span>}
      </div>

      {run.isError && (
        <div className="t-small" style={{ color: 'var(--error)' }}>
          That could not be run just now.
        </div>
      )}

      {result && (
        <div className="code-block p3">
          {/* stderr first when there is any: a thrown error is the thing you
              came back to read, and burying it under output is unhelpful. */}
          {result.stderr.trim().length > 0 && (
            <pre style={{ margin: 0, whiteSpace: 'pre-wrap', color: 'var(--error)' }}>
              {result.stderr.trim()}
            </pre>
          )}

          {result.stdout.trim().length > 0 ? (
            <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{result.stdout.trimEnd()}</pre>
          ) : (
            result.stderr.trim().length === 0 && (
              <span className="t-caption">
                It ran and printed nothing. Add a console.log to see a value.
              </span>
            )
          )}

          {result.truncated && <div className="t-caption mt2">Output was cut at the limit.</div>}
        </div>
      )}
    </div>
  );
}

/**
 * A starting point drawn from the example's own code.
 *
 * Models write these examples with the array or string they are talking about
 * inline, so the first code-looking fragment is almost always the thing worth
 * starting from. When there is nothing to lift, a comment restating the
 * example beats an empty editor — a blank box is a worse prompt than a bad
 * one.
 */
function starterFor(example: string, language: 'javascript' | 'typescript'): string {
  const fenced = /```[\w+-]*\n([\s\S]*?)```/.exec(example);
  if (fenced?.[1]) return fenced[1].trimEnd() + '\n';

  const inline = /`([^`]{4,})`/.exec(example);
  const seed = inline?.[1]?.trim();

  const headline = example.replace(/\s+/g, ' ').slice(0, 110);
  const typed = language === 'typescript' ? ': unknown[]' : '';

  return seed && /^[[{'"]/.test(seed)
    ? `// ${headline}\nconst input${typed} = ${seed};\n\nconsole.log(input);\n`
    : `// ${headline}\n\nconsole.log('try it');\n`;
}
