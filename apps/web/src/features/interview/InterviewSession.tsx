import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { Icon } from '~/components/Icon';
import {
  AiTag,
  Badge,
  Button,
  CircularProgress,
  SkillMeter,
  Spinner,
  StateBlock,
} from '~/components/ui';
import {
  useAnswerInterview,
  useEndInterview,
  useInterview,
  useInterviewReport,
  type InterviewReportView,
} from '~/lib/queries';

/**
 * A live interview (§15-16).
 *
 * Deliberately bare: one question, one box, no scores, no progress bar
 * counting down to a grade. Feedback shown between turns would turn this
 * into a tutorial, and the user would start answering for approval rather
 * than saying what they actually think — which is the one thing an
 * interview is for.
 *
 * The transcript stays visible above, because being able to see what you
 * already said is normal in a conversation and hiding it only adds anxiety.
 */
export function InterviewSession() {
  const { interviewId } = useParams<{ interviewId: string }>();
  const { data: interview, isLoading } = useInterview(interviewId);
  const answer = useAnswerInterview();
  const end = useEndInterview();
  const navigate = useNavigate();

  const [text, setText] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const finished = interview?.status !== 'IN_PROGRESS';

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [interview?.turns.length, finished]);

  if (isLoading) return <Spinner label="Loading interview" />;
  if (!interview) return <StateBlock icon="alert" title="This interview could not be loaded" />;

  const send = async () => {
    if (!interview.currentQuestion || text.trim().length === 0) return;
    const body = text;
    setText('');
    await answer.mutateAsync({
      interviewId: interview.id,
      questionId: interview.currentQuestion.id,
      text: body,
    });
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
          <button
            type="button"
            className="icon-btn"
            onClick={() => navigate('/interview')}
            title="Close"
          >
            <Icon name="x" size={16} />
          </button>
          <div style={{ minWidth: 0 }}>
            <div className="t-h4" style={{ fontSize: 13.5 }}>
              {interview.mode.replace('_', ' ')} interview
            </div>
            <div className="t-caption">
              {interview.targetLevel.toLowerCase()} level
              {!finished && ` · up to ${interview.turnsRemaining} questions left`}
            </div>
          </div>
        </div>

        <div className="row items-center g3">
          {finished ? (
            <Badge variant="neutral">finished</Badge>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => end.mutate(interview.id)}
              disabled={end.isPending}
            >
              {end.isPending ? 'Writing debrief…' : 'End and get feedback'}
            </Button>
          )}
        </div>
      </div>

      <div className="scroll-y flex-1 p6" style={{ minHeight: 0 }}>
        <div className="col g6">
          {interview.turns.map((turn) => (
            <div key={turn.questionId}>
              {turn.conceptName && <div className="t-caption mb2">{turn.conceptName}</div>}
              <div className="t-body" style={{ color: 'var(--text-primary)' }}>
                {turn.prompt}
              </div>
              {turn.answer && (
                <div
                  className="mt3"
                  style={{ borderLeft: '2px solid var(--border-strong)', paddingLeft: 16 }}
                >
                  <div className="t-body" style={{ whiteSpace: 'pre-wrap' }}>
                    {turn.answer}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {answer.isPending && (
          <div className="row items-center g2 mt6 t-caption">
            <Icon name="refresh" size={13} /> Thinking about your answer…
          </div>
        )}

        {finished && <Debrief interviewId={interview.id} inline={end.data ?? null} />}

        <div ref={bottomRef} />
      </div>

      {!finished && interview.currentQuestion && !answer.isPending && (
        <div
          className="col p4"
          style={{
            borderTop: '1px solid var(--border)',
            background: 'var(--surface)',
            flexShrink: 0,
          }}
        >
          <textarea
            className="textarea"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Answer as you would out loud."
            rows={5}
            onKeyDown={(event) => {
              // Enter inserts a newline: an interview answer is a paragraph,
              // and submitting on Enter would cut people off mid-thought.
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void send();
            }}
          />
          <div className="row items-center justify-between g3 mt2">
            <span className="t-caption">
              <span className="kbd">⌘↵</span> to send. Nothing is graded in front of you — you get
              the debrief at the end.
            </span>
            <Button
              size="sm"
              icon="send"
              onClick={() => void send()}
              disabled={text.trim().length === 0}
            >
              Send
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Debrief({
  interviewId,
  inline,
}: {
  interviewId: string;
  inline: InterviewReportView | null;
}) {
  const { data: fetched, isLoading } = useInterviewReport(inline ? undefined : interviewId);
  const report = inline ?? fetched;

  if (isLoading) return <Spinner label="Loading debrief" />;
  if (!report) return null;

  const scored = Object.entries(report.dimensions).filter(([, value]) => value !== null) as [
    string,
    number,
  ][];

  return (
    <>
      <div className="divider mt7 mb6" />

      <div className="row items-center justify-between g4 mb5 wrap">
        <div>
          <AiTag>Debrief</AiTag>
          <div className="t-h2 mt2">How that went</div>
        </div>
        {report.overallScore !== null && (
          <CircularProgress pct={report.overallScore * 100} size={76} />
        )}
      </div>

      {report.degraded && (
        <div className="t-small mb4" style={{ color: 'var(--warning)' }}>
          This debrief is the arithmetic only — the written review could not be generated.
        </div>
      )}

      {report.summary && <div className="t-body mb6">{report.summary}</div>}

      {scored.length > 0 && (
        <div className="mb6">
          <div className="t-caption mb3">SCORED</div>
          <div className="col g3" style={{ maxWidth: 720 }}>
            {scored.map(([dimension, value]) => (
              <div key={dimension} className="row items-center g3">
                <span className="t-small" style={{ width: 170, flexShrink: 0 }}>
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
          {/* Unscored dimensions are omitted rather than shown at zero: this
              interview did not test them, and a zero would get acted on. */}
          <div className="t-caption mt3">
            Dimensions this interview did not test are left out, not scored zero.
          </div>
        </div>
      )}

      <div className="grid grid-2 g5 cq-grid-2">
        {report.strongAreas.length > 0 && (
          <div>
            <div className="t-caption mb2">HELD UP</div>
            <div className="col g1">
              {report.strongAreas.map((area) => (
                <div key={area} className="t-body">
                  · {area}
                </div>
              ))}
            </div>
          </div>
        )}

        {report.weakAreas.length > 0 && (
          <div>
            <div className="t-caption mb2">DID NOT</div>
            <div className="col g1">
              {report.weakAreas.map((area) => (
                <div key={area} className="t-body">
                  · {area}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {report.recommendedTopics.length > 0 && (
        <div className="mt6">
          <div className="t-caption mb2">STUDY NEXT</div>
          <div className="row g2 wrap">
            {report.recommendedTopics.map((topic) => (
              <span key={topic} className="chip">
                {topic}
              </span>
            ))}
          </div>
        </div>
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
