import { useEffect, useRef, useState } from 'react';

import { Icon } from '~/components/Icon';
import { Button } from '~/components/ui';
import {
  useRunTerminal,
  useSubmitTerminal,
  type ChallengeView,
  type TerminalRunResult,
} from '~/lib/queries';

/**
 * A terminal against the simulated shell.
 *
 * The shell has no state on the server: every keystroke session is replayed
 * from the start against a fresh filesystem. That sounds wasteful and is not
 * — the whole filesystem is a Map, and it buys a shell that survives a
 * refresh, a second tab, and a server restart mid-exercise.
 *
 * Running is free and records nothing. Only "check my work" grades. A
 * terminal you are afraid to explore teaches you to plan in your head and
 * paste one answer, which is the opposite of learning to use a shell.
 */
export function TerminalPane({ challenge }: { challenge: ChallengeView }) {
  const [commands, setCommands] = useState<string[]>([]);
  const [input, setInput] = useState('');
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [result, setResult] = useState<TerminalRunResult | null>(null);
  const [graded, setGraded] = useState<TerminalRunResult | null>(null);

  const run = useRunTerminal();
  const submit = useSubmitTerminal();
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [result?.transcript.length]);

  const send = async () => {
    const line = input.trim();
    if (line === '') return;

    const next = [...commands, line];
    setCommands(next);
    setInput('');
    setHistoryIndex(null);

    setResult(await run.mutateAsync({ exerciseId: challenge.exerciseId, commands: next }));
  };

  const check = async () => {
    if (!challenge.attemptId) return;
    setGraded(
      await submit.mutateAsync({
        exerciseId: challenge.exerciseId,
        attemptId: challenge.attemptId,
        commands,
      }),
    );
  };

  /** Up and down walk the history, as a real terminal does. */
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter') {
      void send();
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      const next = historyIndex === null ? commands.length - 1 : Math.max(0, historyIndex - 1);
      if (commands[next] !== undefined) {
        setHistoryIndex(next);
        setInput(commands[next]);
      }
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (historyIndex === null) return;
      const next = historyIndex + 1;
      if (next >= commands.length) {
        setHistoryIndex(null);
        setInput('');
      } else {
        setHistoryIndex(next);
        setInput(commands[next] ?? '');
      }
    }
  };

  const live = graded ?? result;

  return (
    <div className="col" style={{ height: '100%', minHeight: 0 }}>
      <div
        className="scroll-y mono p3"
        style={{
          flex: 1,
          minHeight: 240,
          background: '#07080A',
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-md)',
          fontSize: 12.5,
          lineHeight: 1.7,
          cursor: 'text',
        }}
        onClick={() => inputRef.current?.focus()}
      >
        {result?.transcript.map((entry, index) => (
          <div key={`${entry.command}-${index}`}>
            <div className="row g2" style={{ alignItems: 'baseline' }}>
              <span style={{ color: 'var(--primary)', flexShrink: 0 }}>$</span>
              <span style={{ color: 'var(--text-primary)' }}>{entry.command}</span>
            </div>
            {entry.stdout && (
              <div style={{ color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>
                {entry.stdout.replace(/\n$/, '')}
              </div>
            )}
            {entry.stderr && (
              <div style={{ color: 'var(--error)', whiteSpace: 'pre-wrap' }}>{entry.stderr}</div>
            )}
          </div>
        ))}

        <div className="row g2" style={{ alignItems: 'baseline' }}>
          <span style={{ color: 'var(--primary)', flexShrink: 0 }}>$</span>
          <input
            ref={inputRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={onKeyDown}
            spellCheck={false}
            autoComplete="off"
            aria-label="Terminal input"
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: 'var(--text-primary)',
              font: 'inherit',
            }}
          />
        </div>

        <div ref={bottomRef} />
      </div>

      <div className="row items-center justify-between g3 mt3 wrap">
        {/* Said plainly, because a graded terminal is one nobody explores. */}
        <span className="t-caption">
          Running is free — nothing is recorded until you check your work.
        </span>
        <div className="row g2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setCommands([]);
              setResult(null);
              setGraded(null);
            }}
          >
            Reset
          </Button>
          <Button
            size="sm"
            onClick={() => void check()}
            disabled={submit.isPending || !challenge.attemptId || commands.length === 0}
          >
            {submit.isPending ? 'Checking…' : 'Check my work'}
          </Button>
        </div>
      </div>

      {live && (
        <>
          <div className="divider mt4 mb3" />
          <div className="row items-center justify-between mb2">
            <span className="t-caption">{graded ? 'GRADED' : 'PROGRESS'}</span>
            {graded && (
              <span
                className="t-code"
                style={{
                  fontWeight: 700,
                  color: graded.passed ? 'var(--success)' : 'var(--error)',
                }}
              >
                {graded.passed ? 'Solved' : 'Not yet'}
              </span>
            )}
          </div>

          <div className="col g1">
            {live.checks.map((item) => (
              <div key={item.description} className="row items-start g2">
                <span
                  style={{
                    color: item.passed ? 'var(--success)' : 'var(--text-muted)',
                    marginTop: 2,
                    lineHeight: 0,
                    flexShrink: 0,
                  }}
                >
                  <Icon name={item.passed ? 'check' : 'x'} size={13} />
                </span>
                <span
                  className="t-small"
                  style={{ color: item.passed ? 'var(--text-primary)' : 'var(--text-secondary)' }}
                >
                  {item.description}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
