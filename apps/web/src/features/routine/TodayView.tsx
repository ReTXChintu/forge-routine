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
  useConceptQuestions,
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
  const [quizItem, setQuizItem] = useState<RoutineItemView | null>(null);

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
    if (item.kind === 'RECALL' && item.conceptId) {
      // Answering is the item. Sending the user to the concept page to read
      // it again would be the opposite of what a recall item is for.
      setQuizItem(item);
      return;
    }
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

      {quizItem && (
        <ConceptQuiz
          item={quizItem}
          onClose={() => setQuizItem(null)}
          onFinished={() => {
            updateItem.mutate({ id: quizItem.id, status: 'DONE' });
            setQuizItem(null);
          }}
        />
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
            onSkip={() => updateItem.mutate({ id: item.id, status: 'SKIPPED' })}
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
 * The questions attached to one routine item, asked in sequence.
 *
 * Answering marks the item done automatically — asking the user to also
 * press "Done" after working through every question is making them report
 * on something the app already watched them do.
 */
function ConceptQuiz({
  item,
  onClose,
  onFinished,
}: {
  item: RoutineItemView;
  onClose: () => void;
  onFinished: () => void;
}) {
  const { data: questions, isLoading } = useConceptQuestions(
    item.conceptId,
    Math.max(1, item.questionCount),
  );
  const [index, setIndex] = useState(0);

  if (isLoading) return <Spinner label="Loading questions" />;

  if (!questions || questions.length === 0) {
    return (
      <Card className="mb6">
        <div className="t-h4">No questions on this concept yet</div>
        <div className="t-small mt1">
          They arrive with the curriculum. Mark the item done and carry on.
        </div>
        <Button variant="secondary" size="sm" className="mt3" onClick={onClose}>
          Close
        </Button>
      </Card>
    );
  }

  const prompt = questions[Math.min(index, questions.length - 1)]!;
  const last = index >= questions.length - 1;

  return (
    <div className="mb6">
      <div className="row items-center justify-between mb2">
        <span className="t-caption">
          Question {Math.min(index + 1, questions.length)} of {questions.length}
        </span>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>

      <RecallPrompt
        key={prompt.id}
        prompt={prompt}
        onDone={() => (last ? onFinished() : setIndex((current) => current + 1))}
        onSkip={last ? onClose : () => setIndex((current) => current + 1)}
      />
    </div>
  );
}

function RoutineRow({
  item,
  onOpen,
  onComplete,
  onSkip,
}: {
  item: RoutineItemView;
  onOpen: () => void;
  onComplete: () => void;
  onSkip: () => void;
}) {
  const done = item.status === 'DONE';
  const skipped = item.status === 'SKIPPED';
  const settled = done || skipped;
  const openable = Boolean(item.exerciseId || item.conceptId);

  const desk =
    item.kind === 'CODE' ||
    item.kind === 'BLIND_CODE' ||
    item.kind === 'DEBUG' ||
    item.kind === 'PROJECT';

  return (
    <Card
      hover={!settled}
      className="row justify-between items-center g4"
      style={{ opacity: settled ? 0.55 : 1 }}
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
        </div>
      </div>

      <div className="row items-center g2" style={{ flexShrink: 0 }}>
        {desk && !settled && (
          <span className="t-caption row items-center g1">
            <Icon name="monitor" size={12} /> desk work
          </span>
        )}

        {done && <Badge variant="success">Done</Badge>}
        {skipped && <Badge variant="neutral">Skipped</Badge>}

        {!settled && (
          <>
            <Button variant="ghost" size="sm" onClick={onSkip}>
              Skip
            </Button>
            {openable && (
              <Button variant="secondary" size="sm" onClick={onOpen}>
                Open
              </Button>
            )}
            <Button size="sm" onClick={onComplete}>
              Done
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}
