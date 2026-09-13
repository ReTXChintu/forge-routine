import { useNavigate } from 'react-router-dom';

import type { IndependentCodingScore } from '@forgeroutine/shared-types';

import { Icon } from '~/components/Icon';
import {
  Badge,
  Button,
  Card,
  SectionHead,
  SkillMeter,
  Spinner,
  StatRow,
  StateBlock,
  metricColor,
} from '~/components/ui';
import { useOverview, useRecallDue, useTodayRoutine } from '~/lib/queries';

/**
 * The dashboard, per design.html.
 *
 * Full width: a four-metric strip, then routine and skills side by side,
 * then recent activity. Nothing is centred and nothing is capped — density
 * comes from the grid.
 *
 * Every number here can be absent, and absent renders as a dash with a
 * reason rather than as zero. A score the user has not earned is a lie they
 * will act on.
 */

const KIND_ICON: Record<string, string> = {
  LEARN: 'learn',
  RECALL: 'brain',
  CODE: 'practice',
  BLIND_CODE: 'eye',
  DEBUG: 'bug',
  EXPLAIN: 'interview',
  PROJECT: 'layers',
  CHECKPOINT: 'target',
  REVIEW: 'refresh',
  INTERVIEW: 'interview',
};

export function Dashboard() {
  const { data, isLoading, error } = useOverview();
  const { data: routine } = useTodayRoutine();
  const { data: due } = useRecallDue();
  const navigate = useNavigate();

  if (isLoading) return <Spinner label="Loading your dashboard" />;

  if (error || !data) {
    return (
      <StateBlock
        icon="alert"
        title="Could not load your dashboard"
        body={error instanceof Error ? error.message : 'Something went wrong.'}
      />
    );
  }

  const today = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  const items = routine?.items ?? [];

  return (
    <>
      <SectionHead
        eyebrow={today}
        title={data.greeting}
        description={
          data.nextAction
            ? data.nextAction.rationale
            : 'Nothing scheduled yet. Plan today to get started.'
        }
        right={
          <Button
            size="lg"
            icon="play"
            onClick={() => navigate(items.length > 0 ? '/today' : '/today')}
          >
            {items.length > 0 ? "Start Today's Routine" : 'Plan today'}
          </Button>
        }
      />

      <div className="grid grid-4 g4 mb6 cq-grid-4">
        <Card>
          <div className="t-caption mb2">Today&apos;s progress</div>
          <div className="row items-end g2 mb2">
            <span className="t-metric">{data.todayMinutesDone}</span>
            <span className="t-caption" style={{ paddingBottom: 4 }}>
              / {data.todayMinutesTarget} min
            </span>
          </div>
          <SkillMeter
            pct={
              data.todayMinutesTarget > 0
                ? (data.todayMinutesDone / data.todayMinutesTarget) * 100
                : 0
            }
          />
        </Card>

        <IndependenceCard score={data.independence} />

        <Card>
          <div className="t-caption mb2">Interview readiness</div>
          {data.interviewReadiness === null ? (
            <>
              <div className="t-metric" style={{ color: 'var(--text-muted)' }}>
                —
              </div>
              <div className="t-caption mt1">Not enough practice yet</div>
            </>
          ) : (
            <>
              <div
                className="t-metric"
                style={{ color: metricColor(data.interviewReadiness * 100) }}
              >
                {Math.round(data.interviewReadiness * 100)}%
              </div>
              <div className="t-caption mt1">Across your active technologies</div>
            </>
          )}
        </Card>

        <Card>
          <div className="t-caption mb2">Due for review</div>
          <div className="row items-center g2">
            <span
              className="t-metric"
              style={{ color: (due?.length ?? 0) > 0 ? 'var(--warning)' : 'var(--text-primary)' }}
            >
              {due?.length ?? 0}
            </span>
            <Icon name="refresh" size={20} />
          </div>
          <div className="t-caption mt1">
            {(due?.length ?? 0) === 0 ? 'Nothing fading today' : 'concepts starting to fade'}
          </div>
        </Card>
      </div>

      <div className="grid grid-2 g5 mb6 cq-stack">
        <Card>
          <div className="row justify-between items-center mb4">
            <span className="t-h3">Today&apos;s routine</span>
            <a
              className="t-caption text-primary-c"
              style={{ cursor: 'pointer' }}
              onClick={() => navigate('/today')}
            >
              View the full day
            </a>
          </div>

          {items.length === 0 ? (
            <div className="t-small">
              Nothing planned yet. Today&apos;s work is a slice of your roadmap, weighted towards
              anything due for review.
            </div>
          ) : (
            <div className="col g1">
              {items.map((item) => {
                const done = item.status === 'DONE';
                const active = item.status === 'IN_PROGRESS';

                return (
                  <div
                    key={item.id}
                    className="row items-center g3 p3"
                    style={{
                      borderRadius: 'var(--r-md)',
                      cursor: 'pointer',
                      background: active ? 'var(--primary-subtle)' : undefined,
                    }}
                    onClick={() => navigate('/today')}
                  >
                    <div
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: 8,
                        flexShrink: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: done ? 'var(--success-subtle)' : 'var(--surface-2)',
                        color: done ? 'var(--success)' : 'var(--text-secondary)',
                      }}
                    >
                      <Icon
                        name={done ? 'check' : (KIND_ICON[item.kind] ?? 'practice')}
                        size={15}
                      />
                    </div>

                    <div className="flex-1">
                      <div className="t-h4" style={{ fontSize: 13.5 }}>
                        {item.title}
                      </div>
                      <div className="t-caption">
                        {item.kind} · {item.minutes} min
                      </div>
                    </div>

                    {active && <Badge variant="primary">In progress</Badge>}
                    {done && <Badge variant="success">Done</Badge>}
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <div className="col g5">
          <Card>
            <div className="t-h3 mb3">Current focus</div>
            {data.currentFocus.length === 0 ? (
              <div className="t-small">Nothing in progress yet.</div>
            ) : (
              <div className="row g2 wrap">
                {data.currentFocus.map((name) => (
                  <Badge key={name} variant="primary">
                    {name}
                  </Badge>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <div className="t-h3 mb3">Weakest skills</div>
            {data.weakestSkills.length === 0 ? (
              <div className="t-small">
                Not enough evidence yet. This fills in once you have practised a few concepts.
              </div>
            ) : (
              <div className="col g3">
                {data.weakestSkills.map((skill) => (
                  <StatRow
                    key={skill.conceptId}
                    label={`${skill.conceptName} · ${skill.technologyName}`}
                    pct={skill.value * 100}
                  />
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      {data.nextAction && (
        <Card>
          <div className="t-h3 mb3">Recommended next</div>
          <div className="row items-center justify-between g4 wrap">
            <div>
              <div className="t-h4">{data.nextAction.title}</div>
              {/* The reason is always shown. An opaque recommendation is not
                  a trusted one. */}
              <div className="t-small mt1">{data.nextAction.rationale}</div>
            </div>
            <div className="row items-center g3">
              <span className="t-caption">~{data.nextAction.estimatedMinutes} min</span>
              <Button
                variant="secondary"
                icon="arrowRight"
                onClick={() => {
                  const action = data.nextAction!;
                  if (action.exerciseId) navigate(`/exercise/${action.exerciseId}`);
                  else if (action.conceptId) navigate(`/concept/${action.conceptId}`);
                  else navigate('/today');
                }}
              >
                Open
              </Button>
            </div>
          </div>
        </Card>
      )}
    </>
  );
}

/**
 * `INSUFFICIENT_DATA` renders as a dash and a reason, never as 0%.
 *
 * The oldest rule in this product: a score we have not earned the right to
 * show is a number the user will act on.
 */
function IndependenceCard({ score }: { score: IndependentCodingScore }) {
  const ready = score.status === 'OK' && score.score !== null;
  const delta = score.deltaFromPreviousWindow;

  return (
    <Card>
      <div className="t-caption mb2">Independent coding score</div>

      {ready ? (
        <>
          <div className="t-metric" style={{ color: metricColor(score.score! * 100) }}>
            {Math.round(score.score! * 100)}%
          </div>
          {delta !== null && delta !== undefined ? (
            <div
              className="t-caption mt1"
              style={{ color: delta >= 0 ? 'var(--success)' : 'var(--warning)' }}
            >
              <Icon name="trend" size={11} /> {delta >= 0 ? '+' : ''}
              {Math.round(delta * 100)}% this window
            </div>
          ) : (
            <div className="t-caption mt1">From {score.attemptsConsidered} attempts</div>
          )}
        </>
      ) : (
        <>
          <div className="t-metric" style={{ color: 'var(--text-muted)' }}>
            —
          </div>
          <div className="t-caption mt1">
            {score.attemptsConsidered} attempts so far — too few to mean anything
          </div>
        </>
      )}
    </Card>
  );
}
