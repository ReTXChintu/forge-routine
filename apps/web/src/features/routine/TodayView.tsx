import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Icon } from '~/components/Icon';
import {
  Badge,
  Button,
  Card,
  ProgressBar,
  SectionHead,
  Spinner,
  StateBlock,
  StaticNote,
} from '~/components/ui';
import { RecallPrompt } from '~/features/recall/RecallPrompt';
import {
  useGenerateRoutine,
  useRecallDue,
  useTodayRoutine,
  useUpdateRoutineItem,
  type RoutineItemView,
} from '~/lib/queries';

/**
 * Today (§20), in the prototype's routine layout.
 *
 * Full width: the week strip, then today's items, then progress. Reviews
 * come first because a concept that decays takes the work that built it
 * with it.
 *
 * Recall prompts appear **between** items, never inside one — the boundary
 * is the only safe moment (docs/learning-path.md).
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

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function TodayView() {
  const { data: routine, isLoading } = useTodayRoutine();
  const generate = useGenerateRoutine();
  const updateItem = useUpdateRoutineItem();
  const navigate = useNavigate();

  const { data: duePrompts } = useRecallDue();
  const [promptIndex, setPromptIndex] = useState(0);
  const [showPrompt, setShowPrompt] = useState(false);

  if (isLoading) return <Spinner label="Loading today" />;

  // No "plan today" button. The budget is in preferences, the order is in
  // the roadmap and the due dates are in the schedule — there was nothing
  // left for the user to decide, so the server decides it on first look.
  if (!routine) return <Spinner label="Planning today" />;

  if (routine.items.length === 0) {
    return (
      <StateBlock
        icon="routine"
        title="Nothing to do today"
        body="Add a technology, or finish onboarding, and tomorrow's plan will have something in it."
      />
    );
  }

  const percent =
    routine.totalMinutes > 0 ? (routine.completedMinutes / routine.totalMinutes) * 100 : 0;

  const remaining = routine.items.filter((item) => item.status === 'PENDING');
  const finished = routine.items.length > 0 && remaining.length === 0;
  const todayIndex = (new Date().getDay() + 6) % 7;

  const open = (item: RoutineItemView) => {
    if (item.exerciseId) {
      navigate(`${item.kind === 'PROJECT' ? '/project' : '/exercise'}/${item.exerciseId}`);
    } else if (item.conceptId) {
      navigate(`/concept/${item.conceptId}`);
    }
  };

  /** Completing an item is the boundary — the one safe moment to ask. */
  const complete = (item: RoutineItemView) => {
    updateItem.mutate({ id: item.id, status: 'DONE' });
    if (duePrompts && promptIndex < duePrompts.length) setShowPrompt(true);
  };

  const currentPrompt = showPrompt ? duePrompts?.[promptIndex] : undefined;

  return (
    <>
      <SectionHead
        eyebrow="My Routine"
        title="Today"
        description={`${routine.completedMinutes} of ${routine.totalMinutes} minutes${
          routine.recallDue > 0 ? ` · ${routine.recallDue} due for review` : ''
        }`}
        right={
          <Button
            variant="secondary"
            icon="refresh"
            onClick={() => generate.mutate(true)}
            disabled={generate.isPending}
          >
            Replan
          </Button>
        }
      />

      <Card className="mb6">
        <div className="row justify-between mb4">
          {DAYS.map((day, index) => {
            const isToday = index === todayIndex;
            const past = index < todayIndex;

            return (
              <div key={day} className="col items-center g2" style={{ flex: 1 }}>
                <span className="t-caption">{day}</span>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 99,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 700,
                    fontSize: 12.5,
                    background: isToday ? 'var(--primary-subtle)' : 'var(--surface-2)',
                    color: isToday ? 'var(--primary)' : 'var(--text-muted)',
                    border: isToday ? '2px solid var(--primary)' : '1px solid var(--border)',
                  }}
                >
                  {past ? <Icon name="check" size={15} /> : index + 1}
                </div>
              </div>
            );
          })}
        </div>
        <div className="t-caption">Week at a glance</div>
        <StaticNote>Week history is a static figure — only today is tracked so far</StaticNote>
      </Card>

      {currentPrompt && (
        <div className="mb6" style={{ maxWidth: 620 }}>
          <RecallPrompt
            prompt={currentPrompt}
            onDone={() => {
              setPromptIndex((index) => index + 1);
              setShowPrompt(false);
            }}
            onSkip={() => setShowPrompt(false)}
          />
        </div>
      )}

      {routine.carriedCount > 0 && (
        <Card className="mb6" style={{ borderLeft: '2px solid var(--warning)' }}>
          <div className="row items-start g3">
            <span style={{ color: 'var(--warning)', marginTop: 2 }}>
              <Icon name="clock" size={16} />
            </span>
            <div>
              <div className="t-h4">
                {routine.carriedCount} {routine.carriedCount === 1 ? 'item' : 'items'} carried
                forward
              </div>
              {/* Not an admonishment. The plan simply does not forget, and
                  saying so once is more useful than a streak that breaks. */}
              <div className="t-small mt1">
                Nothing is ever dropped, so unfinished work moves to today and new material waits
                until it is cleared. Finishing ahead is fine; skipping is not a thing.
              </div>
            </div>
          </div>
        </Card>
      )}

      <div className="row items-center justify-between mb3 g4">
        <span className="t-h3">Today</span>
        <div style={{ flex: 1, maxWidth: 320 }}>
          <ProgressBar pct={percent} thin />
        </div>
      </div>

      <div className="col g2 mb6">
        {routine.items.map((item) => (
          <RoutineRow
            key={item.id}
            item={item}
            onOpen={() => open(item)}
            onComplete={() => complete(item)}
          />
        ))}
      </div>

      {finished && (
        <Card>
          <div className="t-h4">That is today&apos;s work done.</div>
          {/* No confetti and no streak counter. Finishing is the reward; a
              celebration loop trains people to chase the animation. */}
          <div className="t-small mt1">
            Stopping here is the right call — tomorrow&apos;s spacing depends on it.
          </div>
        </Card>
      )}
    </>
  );
}

/**
 * One row of the plan.
 *
 * A row is a thing to open, never a step inside one. Question batches and
 * individual exercises used to get their own rows, which made the plan a list
 * of the insides of tasks; a concept is now a single row covering both
 * reading it and practising it.
 *
 * Two rules about finishing, and both come from work being lost:
 *
 *   A finished row still opens. It used to grey out with no way back in, so
 *   revisiting something you had completed was impossible — and reviewing
 *   what you have learned is the entire point of the schedule.
 *
 *   A concept row has no Done button. It ticks itself off when every question
 *   is answered and every exercise passes. A button that can finish a concept
 *   without the work makes the completion state a claim rather than a fact.
 *   Rows with no such signal — a project, an interview — keep theirs.
 */
function RoutineRow({
  item,
  onOpen,
  onComplete,
}: {
  item: RoutineItemView;
  onOpen: () => void;
  onComplete: () => void;
}) {
  const done = item.status === 'DONE';
  // No skipped state any more. Unfinished work moves to tomorrow, so the
  // only settled state is done.
  const settled = done;
  const lateBy = item.carriedFrom ? daysLate(item.carriedFrom) : 0;
  const openable = Boolean(item.exerciseId || item.conceptId);
  const finishesItself = item.conceptId !== null || item.exerciseId !== null;

  const desk =
    item.kind === 'CODE' ||
    item.kind === 'BLIND_CODE' ||
    item.kind === 'DEBUG' ||
    item.kind === 'PROJECT';

  return (
    <Card
      hover
      className="row justify-between items-center g4"
      // Dimmed, not disabled: finished work steps back without becoming
      // unreachable.
      style={{ opacity: settled ? 0.7 : 1 }}
    >
      <div className="row items-center g3" style={{ minWidth: 0 }}>
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: 9,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: done ? 'var(--success-subtle)' : 'var(--surface-2)',
            color: done ? 'var(--success)' : 'var(--text-secondary)',
          }}
        >
          <Icon name={done ? 'check' : (KIND_ICON[item.kind] ?? 'practice')} size={16} />
        </div>

        <div style={{ minWidth: 0 }}>
          <div className="t-h4" style={{ textDecoration: settled ? 'line-through' : undefined }}>
            {item.title}
          </div>
          {/* The reason is always shown. An opaque routine is not a trusted one. */}
          <div className="t-caption">
            {item.kind} · {item.minutes} min · {item.rationale}
          </div>
          {lateBy > 0 && (
            // Stated, not hidden. A backlog you cannot see is one you
            // never clear, and this is the whole point of carrying work.
            <div className="t-caption mt1" style={{ color: 'var(--warning)' }}>
              Carried from {lateBy} {lateBy === 1 ? 'day' : 'days'} ago
            </div>
          )}
        </div>
      </div>

      <div className="row items-center g2" style={{ flexShrink: 0 }}>
        {desk && !settled && (
          <span className="t-caption row items-center g1">
            <Icon name="monitor" size={12} /> desk work
          </span>
        )}

        {done && <Badge variant="success">Done</Badge>}

        {/* Always offered, finished or not. A completed row that cannot be
            reopened means you cannot revisit what you learned. */}
        {openable && (
          <Button variant={settled ? 'ghost' : 'secondary'} size="sm" onClick={onOpen}>
            {settled ? 'Revisit' : 'Open'}
          </Button>
        )}

        {!settled && !finishesItself && (
          <Button size="sm" onClick={onComplete}>
            Done
          </Button>
        )}
      </div>
    </Card>
  );
}

/** Whole days between a carried item's original day and today. */
function daysLate(carriedFrom: string): number {
  const then = new Date(carriedFrom);
  then.setHours(0, 0, 0, 0);
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  return Math.max(0, Math.round((now.getTime() - then.getTime()) / 86_400_000));
}
