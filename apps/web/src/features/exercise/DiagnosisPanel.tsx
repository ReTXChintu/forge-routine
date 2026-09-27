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
 *
 * A wrong diagnosis can be rewritten, because the server deliberately
 * withholds the real cause below its accuracy threshold — "handing over the
 * cause after a wrong guess removes the only thing a retry would teach". The
 * panel used to lock the box on the first submission regardless, so the
 * feedback asked for a revision the user had no way to make.
 *
 * Once the cause *has* been released it locks for good. Rewriting a diagnosis
 * with the answer on screen would be marking your own homework, and the score
 * it produced would mean nothing.
 */

interface DiagnosisPanelProps {
  value: string;
  onChange: (value: string) => void;
  result: DiagnosisResult | null;
  submitted: boolean;
  onSubmit: () => void;
  submitting: boolean;
  canSubmit: boolean;
  /**
   * False once the attempt has passed and the server has closed it.
   *
   * A debugging exercise submits the diagnosis and the fix together, so code
   * that passes with a wrong diagnosis closes the attempt — and offering a
   * revision there would produce a refusal rather than another try.
   */
  canResubmit: boolean;
}

export function DiagnosisPanel({
  value,
  onChange,
  result,
  submitted,
  onSubmit,
  submitting,
  canSubmit,
  canResubmit,
}: DiagnosisPanelProps) {
  const wordCount = value.trim().split(/\s+/).filter(Boolean).length;
  const longEnough = wordCount >= 5;

  // The cause being out is what closes this, not the act of submitting — plus
  // the attempt itself being finished, after which nothing more can be sent.
  const revealed = result?.actualCause !== null && result?.actualCause !== undefined;
  const locked = submitted && (revealed || !canResubmit);

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
        disabled={locked}
      />

      {!locked && (
        <div className="row justify-between items-center g2 wrap">
          <span className="t-caption">
            {wordCount} {wordCount === 1 ? 'word' : 'words'}
            {!longEnough && ' · a sentence at least'}
          </span>
          <Button size="sm" onClick={onSubmit} disabled={!canSubmit || !longEnough || submitting}>
            {submitting
              ? 'Submitting…'
              : submitted
                ? // Both go again together: a debugging exercise is graded on
                  // the diagnosis and the fix as one submission.
                  'Submit again'
                : 'Submit diagnosis and fix'}
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

          {!revealed && !locked && (
            // Said plainly, because the feedback asks for a revision and the
            // box above being editable is easy to miss.
            <div className="t-caption mt2">
              The real cause is still withheld. Rewrite your diagnosis above and submit again.
            </div>
          )}

          {!revealed && locked && (
            // The awkward case: the fix worked, the diagnosis did not, and the
            // attempt closed on passing. Better said than left as a button
            // that would be refused.
            <div className="t-caption mt2">
              Your fix passed, so this attempt is finished and the diagnosis stands as scored.
            </div>
          )}

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
