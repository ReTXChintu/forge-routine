import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { Icon } from '~/components/Icon';
import { SessionClock } from '~/components/SessionClock';
import { Badge, Button, SkillMeter, Spinner, StateBlock } from '~/components/ui';
import {
  useChallenge,
  useStartChallenge,
  useSubmitWritten,
  type WrittenReviewResult,
} from '~/lib/queries';
import { useLearningSession } from '~/lib/useLearningSession';

import { TerminalPane } from './TerminalPane';

/**
 * One engineering challenge (§18-19), in the prototype's workspace layout.
 *
 * The brief on the left, the work on the right. What the brief does *not*
 * contain is the point: an incident's root cause and a design's expected
 * topics are the answer, and the server withholds both until the user has
 * committed to something of their own.
 */
export function ChallengeWorkspace() {
  const { exerciseId } = useParams<{ exerciseId: string }>();
  const { data: challenge, isLoading } = useChallenge(exerciseId);
  const start = useStartChallenge();
  const submit = useSubmitWritten();
  const navigate = useNavigate();

  const [text, setText] = useState('');
  const [review, setReview] = useState<WrittenReviewResult | null>(null);

  // Times this stretch of work, the same way the exercise workspace does.
  const session = useLearningSession(challenge?.conceptId);

  if (isLoading) return <Spinner label="Loading challenge" />;
  if (!challenge) return <StateBlock icon="alert" title="This challenge could not be loaded" />;

  const started = Boolean(challenge.attemptId);
  const words = text.trim().split(/\s+/).filter(Boolean).length;

  const send = async () => {
    if (!challenge.attemptId || text.trim().length === 0) return;
    setReview(
      await submit.mutateAsync({
        exerciseId: challenge.exerciseId,
        attemptId: challenge.attemptId,
        text,
      }),
    );
  };

  return (
    <div className="col" style={{ height: '100%' }}>
      <div
        className="row items-center justify-between"
        style={{
          height: 52,
          padding: '0 18px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--surface)',
          flexShrink: 0,
        }}
      >
        <div className="row items-center g3" style={{ minWidth: 0 }}>
          <button type="button" className="icon-btn" onClick={() => navigate(-1)} title="Close">
            <Icon name="x" size={16} />
          </button>
          <div style={{ minWidth: 0 }}>
            <div className="t-h4" style={{ fontSize: 13.5 }}>
              {challenge.title}
            </div>
            <div className="t-caption">
              {challenge.technologyName} · {challenge.estimatedMinutes} min
            </div>
          </div>
        </div>

        <div className="row items-center g3">
          <SessionClock durationMs={session.durationMs} counting={session.counting} />
          <Badge variant="primary">{challenge.kind.replace('_', ' ').toLowerCase()}</Badge>
        </div>
      </div>

      <div className="row flex-1" style={{ minHeight: 0 }}>
        <div
          className="col scroll-y p5"
          style={{
            width: 460,
            borderRight: '1px solid var(--border)',
            background: 'var(--surface)',
            flexShrink: 0,
          }}
        >
          <div className="t-body mb5" style={{ whiteSpace: 'pre-wrap' }}>
            {challenge.brief.body}
          </div>

          {challenge.brief.constraints.length > 0 && (
            <Bullets label="CONSTRAINTS" items={challenge.brief.constraints} />
          )}

          {challenge.brief.telemetry && (
            <div className="mb5">
              <div className="t-caption mb2">TELEMETRY</div>
              {/* Shown in full. In a real incident the signal was always
                  there — hiding some of it would test luck, not diagnosis. */}
              <div className="code-block">
                <pre style={{ fontSize: 11.5 }}>{challenge.brief.telemetry}</pre>
              </div>
            </div>
          )}

          {challenge.brief.sections.length > 0 && (
            <Bullets label="COVER THESE" items={challenge.brief.sections} />
          )}

          {challenge.brief.terminal && (
            <Bullets label="DONE WHEN" items={challenge.brief.terminal.goals} />
          )}
        </div>

        <div className="col flex-1 scroll-y p5" style={{ minWidth: 0 }}>
          {!started ? (
            <StateBlock
              icon={challenge.kind === 'TERMINAL' ? 'monitor' : 'brain'}
              title="Ready when you are"
              body={
                challenge.kind === 'TERMINAL'
                  ? 'A simulated shell. Explore freely — nothing is graded until you ask.'
                  : 'Read the brief, then write your answer. You get one review per submission.'
              }
              action={
                <Button
                  icon="play"
                  onClick={() => exerciseId && start.mutate(exerciseId)}
                  disabled={start.isPending}
                >
                  {start.isPending ? 'Starting…' : 'Start'}
                </Button>
              }
            />
          ) : challenge.kind === 'TERMINAL' ? (
            <TerminalPane challenge={challenge} />
          ) : (
            <>
              <textarea
                className="textarea mono"
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder={
                  challenge.kind === 'INCIDENT'
                    ? 'What is your diagnosis, and what in the telemetry tells you?'
                    : 'Your design. Prose is fine — this is judged as an interview answer, not a document.'
                }
                style={{ minHeight: 320, lineHeight: 1.7 }}
              />

              <div className="row items-center justify-between g3 mt3">
                <span className="t-caption">
                  {words} {words === 1 ? 'word' : 'words'}
                  {text.trim().length < 40 && ' · a paragraph at least'}
                </span>
                <Button
                  size="sm"
                  onClick={() => void send()}
                  disabled={submit.isPending || text.trim().length < 40}
                >
                  {submit.isPending ? 'Reviewing…' : 'Submit for review'}
                </Button>
              </div>

              {review && <WrittenReview review={review} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Bullets({ label, items }: { label: string; items: readonly string[] }) {
  return (
    <div className="mb5">
      <div className="t-caption mb2">{label}</div>
      <div className="col g1">
        {items.map((item) => (
          <div key={item} className="t-small">
            · {item}
          </div>
        ))}
      </div>
    </div>
  );
}

const SEVERITY_COLOUR: Record<string, string> = {
  critical: 'var(--error)',
  major: 'var(--warning)',
  minor: 'var(--text-secondary)',
};

function WrittenReview({ review }: { review: WrittenReviewResult }) {
  const scored = Object.entries(review.scores).filter(([, value]) => value !== null) as [
    string,
    number,
  ][];

  return (
    <>
      <div className="divider mt7 mb5" />

      <div className="row items-center justify-between mb4">
        <span className="t-h3">Review</span>
        <span
          className="t-code"
          style={{
            fontWeight: 700,
            color: review.passed ? 'var(--success)' : 'var(--warning)',
          }}
        >
          {review.passed ? 'Holds up' : 'Needs work'}
        </span>
      </div>

      <div className="t-body mb6">{review.summary}</div>

      {scored.length > 0 && (
        <div className="mb6">
          <div className="t-caption mb2">SCORED</div>
          <div className="col g3">
            {scored.map(([dimension, value]) => (
              <div key={dimension} className="row items-center g3">
                <span className="t-small" style={{ width: 180, flexShrink: 0 }}>
                  {humanise(dimension)}
                </span>
                <div style={{ flex: 1 }}>
                  <SkillMeter pct={value * 100} />
                </div>
                <span className="t-code" style={{ width: 32, textAlign: 'right', flexShrink: 0 }}>
                  {Math.round(value * 100)}
                </span>
              </div>
            ))}
          </div>
          {/* Silence is not a wrong answer — it is an absent one. */}
          <div className="t-caption mt3">
            Anything you did not address is left out, not scored zero.
          </div>
        </div>
      )}

      {review.strengths.length > 0 && <Bullets label="HOLDS UP" items={review.strengths} />}

      {review.issues.length > 0 && (
        <div className="mb5">
          <div className="t-caption mb2">GAPS</div>
          <div className="col g4">
            {review.issues.map((issue) => (
              <div
                key={issue.title}
                style={{
                  borderLeft: `2px solid ${SEVERITY_COLOUR[issue.severity] ?? 'var(--text-muted)'}`,
                  paddingLeft: 12,
                }}
              >
                <div
                  className="t-caption mb1"
                  style={{
                    color: SEVERITY_COLOUR[issue.severity] ?? 'var(--text-muted)',
                    fontWeight: 700,
                  }}
                >
                  {issue.severity.toUpperCase()}
                </div>
                <div className="t-h4" style={{ fontSize: 13 }}>
                  {issue.title}
                </div>
                <div className="t-caption mt1" style={{ lineHeight: 1.6 }}>
                  {issue.explanation}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {review.missedSignals && review.missedSignals.length > 0 && (
        <Bullets label="EVIDENCE YOU WALKED PAST" items={review.missedSignals} />
      )}

      {review.rootCause && (
        <div className="mb5">
          {/* Released only now. Showing it beside the brief would have made
              this a reading exercise. */}
          <div className="t-caption mb2">WHAT IT ACTUALLY WAS</div>
          <div className="t-body" style={{ whiteSpace: 'pre-wrap' }}>
            {review.rootCause}
          </div>
        </div>
      )}

      {review.followUpQuestions.length > 0 && (
        <Bullets label="WHAT YOU WOULD BE ASKED NEXT" items={review.followUpQuestions} />
      )}
    </>
  );
}

function humanise(dimension: string): string {
  return dimension
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (character) => character.toUpperCase())
    .trim();
}
