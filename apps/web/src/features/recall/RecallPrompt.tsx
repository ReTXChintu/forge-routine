import { useState } from 'react';

import { Icon } from '~/components/Icon';
import { Badge, Button, Card } from '~/components/ui';
import { useAnswerRecall, type RecallAnswerResult, type RecallPromptView } from '~/lib/queries';

/**
 * A recall prompt (docs/learning-path.md).
 *
 * **Where this may appear is a product rule, not a styling choice.** Only at
 * boundaries: session start, after a submission has been graded, between
 * routine items. Never during coding. An interruption mid-problem destroys
 * the exact mental state the product exists to build, and teaches the user
 * to dismiss prompts unread — at which point the spaced-repetition data
 * becomes noise and every schedule built on it is wrong.
 */
export function RecallPrompt({
  prompt,
  onDone,
  onSkip,
}: {
  prompt: RecallPromptView;
  onDone: (result: RecallAnswerResult) => void;
  onSkip?: () => void;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [result, setResult] = useState<RecallAnswerResult | null>(null);
  const answer = useAnswerRecall();

  const submit = async (index: number) => {
    setSelected(index);
    const outcome = await answer.mutateAsync({ questionId: prompt.id, selectedIndex: index });
    setResult(outcome);
  };

  return (
    <Card
      style={{
        borderColor: result ? (result.correct ? 'var(--success)' : 'var(--error)') : undefined,
      }}
    >
      <div className="row justify-between items-center mb3">
        <div className="row items-center g2">
          <Badge variant="neutral" icon="brain">
            Recall
          </Badge>
          <span className="t-caption">
            {prompt.technologyName} · {prompt.conceptName}
          </span>
        </div>
        {!result && onSkip && (
          <Button variant="ghost" size="sm" onClick={onSkip}>
            Skip
          </Button>
        )}
      </div>

      <div className="t-h4 mb4" style={{ lineHeight: 1.6 }}>
        {prompt.prompt}
      </div>

      <div className="col g2">
        {prompt.options.map((option, index) => {
          const isChosen = selected === index;
          const isAnswer = result?.correctIndex === index;

          // Nothing is coloured until an answer is committed, so the right
          // option cannot be read off the styling.
          const border = !result
            ? 'var(--border-strong)'
            : isAnswer
              ? 'var(--success)'
              : isChosen
                ? 'var(--error)'
                : 'var(--border)';

          return (
            <button
              key={option}
              type="button"
              disabled={Boolean(result) || answer.isPending}
              onClick={() => void submit(index)}
              className="row items-center g2"
              style={{
                textAlign: 'left',
                padding: '11px 13px',
                borderRadius: 'var(--r-md)',
                border: `1px solid ${border}`,
                background: 'transparent',
                color:
                  result && !isAnswer && !isChosen ? 'var(--text-muted)' : 'var(--text-primary)',
                fontSize: 13.5,
                cursor: result ? 'default' : 'pointer',
                width: '100%',
              }}
            >
              {result && isAnswer && (
                <span style={{ color: 'var(--success)' }}>
                  <Icon name="check" size={15} />
                </span>
              )}
              {result && isChosen && !isAnswer && (
                <span style={{ color: 'var(--error)' }}>
                  <Icon name="x" size={15} />
                </span>
              )}
              <span>{option}</span>
            </button>
          );
        })}
      </div>

      {result && (
        <>
          <div className="divider mt4 mb4" />
          {/* Shown either way. Being right for the wrong reason is still
              worth correcting, and the explanation is where the learning is. */}
          <div className="t-body">{result.explanation}</div>
          <div className="row justify-between items-center mt4">
            <span className="t-caption">Next review {formatDue(result.nextDueAt)}</span>
            <Button size="sm" onClick={() => onDone(result)}>
              Continue
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}

function formatDue(iso: string): string {
  const days = Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days < 30) return `in ${days} days`;
  return `in ${Math.round(days / 30)} months`;
}
