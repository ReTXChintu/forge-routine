import type { DiagnosisResult } from '@forgeroutine/shared-types';

import { Badge, Button, Card, metricColor } from '~/components/ui';

/**
 * Diagnosis before repair (§13).
 *
 * A debugging exercise asks what is wrong before it accepts a fix. Changing
 * lines until the tests go green is the habit this product exists to break,
 * and writing the diagnosis first makes that impossible to do by accident.
 *
 * Grading is separate from the fix, so a correct patch with a wrong
 * diagnosis still says something true about the user's debugging ability.
 */

interface DiagnosisPanelProps {
  value: string;
  onChange: (value: string) => void;
  result: DiagnosisResult | null;
  submitted: boolean;
  onSubmit: () => void;
  submitting: boolean;
  canSubmit: boolean;
}

export function DiagnosisPanel({
  value,
  onChange,
  result,
  submitted,
  onSubmit,
  submitting,
  canSubmit,
}: DiagnosisPanelProps) {
  const wordCount = value.trim().split(/\s+/).filter(Boolean).length;
  const longEnough = wordCount >= 5;

  return (
    <div className="col g3 p4 scroll-y" style={{ height: '100%' }}>
      <div>
        <div className="t-caption">DIAGNOSIS</div>
        <div className="t-caption mt1">
          What is wrong, and why does it produce this behaviour? Write it before you fix anything.
        </div>
      </div>

      <textarea
        className="textarea"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="The loop variable is declared with…"
        rows={6}
        disabled={submitted}
      />

      {!submitted && (
        <div className="row justify-between items-center">
          <span className="t-caption">
            {wordCount} {wordCount === 1 ? 'word' : 'words'}
            {!longEnough && ' · a sentence at least'}
          </span>
          <Button size="sm" onClick={onSubmit} disabled={!canSubmit || !longEnough || submitting}>
            {submitting ? 'Submitting…' : 'Submit diagnosis and fix'}
          </Button>
        </div>
      )}

      {result && (
        <Card>
          <div className="row justify-between items-center mb2">
            <span className="t-h4">Diagnosis</span>
            {result.accuracy === null ? (
              // Recorded but unscored without an AI key. Saying "0%" would
              // be a judgement nobody made.
              <Badge variant="neutral">recorded, unscored</Badge>
            ) : (
              <span
                className="t-code"
                style={{ fontWeight: 700, color: metricColor(result.accuracy * 100) }}
              >
                {Math.round(result.accuracy * 100)}%
              </span>
            )}
          </div>

          <div className="t-body">{result.feedback}</div>

          {result.actualCause && (
            <>
              <div className="divider mt3 mb3" />
              {/* Released only now. Shown beside the brief it would have
                  been the answer to a question nobody had to think about. */}
              <div className="t-caption mb1">What it actually was</div>
              <div className="t-small">{result.actualCause}</div>
            </>
          )}
        </Card>
      )}
    </div>
  );
}
