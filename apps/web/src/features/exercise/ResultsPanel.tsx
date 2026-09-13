import type { CodeEvaluation, ExecutionResult } from '@forgeroutine/shared-types';

import { Icon } from '~/components/Icon';
import { AiTag, Badge, Card, metricColor, type BadgeVariant } from '~/components/ui';

/**
 * The console pane: what ran, what passed, and what the evaluator made of it.
 *
 * An internal failure is never reported as a wrong answer. If the harness
 * broke, that is our fault, and telling the user their code failed would
 * send them hunting for a bug that is in our sandbox.
 */

interface ResultsPanelProps {
  execution: ExecutionResult | null;
  evaluation: CodeEvaluation | null;
  hint: string | null;
  running: boolean;
}

const STATUS: Record<string, { variant: BadgeVariant; label: string }> = {
  PASSED: { variant: 'success', label: 'Passed' },
  FAILED: { variant: 'error', label: 'Failed' },
  TIMEOUT: { variant: 'warning', label: 'Timed out' },
  COMPILE_ERROR: { variant: 'warning', label: 'Would not compile' },
  MEMORY_EXCEEDED: { variant: 'warning', label: 'Out of memory' },
  HARNESS_ERROR: { variant: 'neutral', label: 'Our fault' },
  INTERNAL_ERROR: { variant: 'neutral', label: 'Our fault' },
};

export function ResultsPanel({ execution, evaluation, hint, running }: ResultsPanelProps) {
  if (running) {
    return (
      <div className="p3 t-caption row items-center g2">
        <Icon name="refresh" size={13} /> Running your code…
      </div>
    );
  }

  if (!execution) {
    return (
      <div className="p3 t-caption">
        Run your code to see the tests. Nothing is recorded until you submit.
      </div>
    );
  }

  const ourFault = execution.status === 'HARNESS_ERROR' || execution.status === 'INTERNAL_ERROR';
  const status = STATUS[execution.status] ?? {
    variant: 'neutral' as const,
    label: execution.status,
  };

  return (
    <div className="p3 scroll-y" style={{ flex: 1, minHeight: 0 }}>
      <div className="row items-center justify-between mb3 g3">
        <div className="row items-center g2">
          <Badge variant={status.variant}>{status.label}</Badge>
          {execution.testsTotal > 0 && (
            <span className="t-code" style={{ fontWeight: 700 }}>
              {execution.testsPassed}/{execution.testsTotal}
            </span>
          )}
        </div>
        <span className="t-caption">{execution.durationMs}ms</span>
      </div>

      {ourFault && (
        <Card className="mb3" style={{ borderColor: 'var(--warning)' }}>
          {/* Never reported as a wrong answer. The user would go looking for
              a bug that is in our sandbox. */}
          <div className="t-small">
            Something broke on our side while running this. Your code was not judged.
          </div>
        </Card>
      )}

      {execution.cases.length > 0 && (
        <div className="col g2 mb3">
          {execution.cases.map((testCase, index) => (
            <div key={`${testCase.name}-${index}`}>
              <div className="row justify-between items-center g2 mono" style={{ fontSize: 12.5 }}>
                <span className="row items-center g2">
                  <span style={{ color: testCase.passed ? 'var(--success)' : 'var(--error)' }}>
                    <Icon name={testCase.passed ? 'check' : 'x'} size={13} />
                  </span>
                  {testCase.name}
                </span>
                <span className={testCase.passed ? 'text-success' : 'text-error'}>
                  {testCase.passed ? 'passed' : 'failed'}
                </span>
              </div>
              {testCase.error && (
                <div
                  className="mono t-caption mt1"
                  style={{ color: 'var(--error)', paddingLeft: 21, whiteSpace: 'pre-wrap' }}
                >
                  {testCase.error}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {execution.stderr && !ourFault && (
        <div className="code-block mb3">
          <pre style={{ fontSize: 11.5, color: 'var(--error)' }}>{execution.stderr}</pre>
        </div>
      )}

      {evaluation && (
        <>
          <div className="divider mb3" />
          <div className="grid grid-4 g2 mb3">
            {Object.entries(evaluation.quality)
              .filter(([, value]) => value !== null)
              .slice(0, 4)
              .map(([key, value]) => (
                <div key={key} className="card p3" style={{ textAlign: 'center' }}>
                  <div
                    className="t-metric"
                    style={{ fontSize: 18, color: metricColor(Number(value) * 100) }}
                  >
                    {Math.round(Number(value) * 100)}%
                  </div>
                  <div className="t-caption mt1">{humanise(key)}</div>
                </div>
              ))}
          </div>

          {evaluation.strengths.length > 0 && (
            <Card className="mb2">
              <div className="t-h4 mb1" style={{ color: 'var(--success)' }}>
                <Icon name="check" size={14} /> What you did well
              </div>
              <div className="t-small">{evaluation.strengths.join(' ')}</div>
            </Card>
          )}

          {evaluation.weaknesses.length > 0 && (
            <Card className="mb2">
              <div className="t-h4 mb1" style={{ color: 'var(--error)' }}>
                <Icon name="alert" size={14} /> What went wrong
              </div>
              <div className="t-small">{evaluation.weaknesses.join(' ')}</div>
            </Card>
          )}
        </>
      )}

      {hint && (
        <Card style={{ borderColor: 'var(--primary-border)' }}>
          <AiTag>Think about this</AiTag>
          {/* A question, not an answer — the whole point of the ladder. */}
          <div className="t-body mt2" style={{ color: 'var(--text-primary)' }}>
            {hint}
          </div>
        </Card>
      )}
    </div>
  );
}

function humanise(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (character) => character.toUpperCase())
    .trim();
}
