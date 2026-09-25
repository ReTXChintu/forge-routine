import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import type { ExerciseView } from '@forgeroutine/shared-types';

import { Icon } from '~/components/Icon';
import { Markdown } from '~/components/Markdown';
import { Badge, Button, Card, ProgressBar, Spinner } from '~/components/ui';
import {
  useAnswerRecall,
  useAnswerTheory,
  usePracticeSet,
  useRateTheory,
  type PracticeQuestionView,
  type RecallAnswerResult,
  type TheoryAnswerResult,
} from '~/lib/queries';

/**
 * Practice on one concept, as a set rather than a single exercise.
 *
 * One coding exercise proves you can produce a working function. It says
 * nothing about whether you could explain why it works, spot the case that
 * breaks it, or choose it over the alternative — and those are the things
 * that decide whether a concept survives contact with real code. So a set
 * asks in three ways that fail differently:
 *
 *   Multiple choice, for the distinctions. Cheap, fast, and it catches
 *   someone who has half the idea, because the wrong options are the
 *   half-ideas.
 *
 *   Written answers, for what multiple choice cannot reach: recognising an
 *   idea fluently while being unable to state it. The model answer arrives
 *   only after theirs is submitted — reading a good answer and then judging
 *   your own against it measures nothing.
 *
 *   Code, from the curriculum's own exercises, one or two. More than that
 *   turns a study session into an afternoon and gets abandoned.
 *
 * One question at a time, with the progress visible. A wall of ten
 * questions is something to skim; one question is something to answer.
 */

/** Enough code to make the ideas real, few enough to finish in one sitting. */
const CODING_QUESTIONS = 2;

export function ConceptPractice({
  conceptId,
  exercises,
  locked,
}: {
  conceptId: string | undefined;
  exercises: ExerciseView[];
  locked: boolean;
}) {
  const [started, setStarted] = useState(false);
  const [index, setIndex] = useState(0);
  const [answered, setAnswered] = useState<Record<string, boolean>>({});

  const { data: set, isLoading, isError } = usePracticeSet(conceptId, started);

  const coding = useMemo(() => exercises.slice(0, CODING_QUESTIONS), [exercises]);
  const questions = set?.questions ?? [];
  // The coding exercises are the last step, so they count towards the total
  // the progress bar is measured against.
  const total = questions.length + (coding.length > 0 ? 1 : 0);

  if (!started) {
    return (
      <Opening
        counts={{ coding: coding.length }}
        onStart={() => setStarted(true)}
        disabled={locked}
      />
    );
  }

  if (isLoading) return <Spinner label="Writing your questions" />;

  if (isError || !set) {
    return (
      <Card>
        <div className="t-h3 mb2">The questions could not be loaded</div>
        <div className="t-small">Try again in a moment.</div>
      </Card>
    );
  }

  if (!set.available && coding.length === 0) {
    return (
      <Card>
        <div className="t-h3 mb2">Nothing to practise here yet</div>
        <div className="t-small">{set.unavailableReason}</div>
      </Card>
    );
  }

  const question = questions[index] ?? null;
  const onCodingStep = question === null;

  return (
    <div className="col g4">
      <Card flush className="p4">
        <div className="row items-center justify-between mb3">
          <div className="row items-center g2">
            <span className="t-caption">
              {onCodingStep ? `Step ${total} of ${total}` : `Question ${index + 1} of ${total}`}
            </span>
            {question && (
              <Badge variant={question.kind === 'THEORY' ? 'primary' : 'neutral'}>
                {question.kind === 'THEORY' ? 'in your own words' : 'multiple choice'}
              </Badge>
            )}
          </div>

          <span className="t-caption">
            {Object.values(answered).filter(Boolean).length} answered
          </span>
        </div>

        <ProgressBar thin pct={total === 0 ? 0 : (index / total) * 100} />
      </Card>

      {question ? (
        <QuestionCard
          // Keyed so every piece of per-question state — the selection, the
          // typed answer, whether it has been revealed — is discarded when
          // the question changes. Without this the next question opens
          // already showing the previous one's verdict.
          key={question.id}
          question={question}
          onAnswered={() => setAnswered((current) => ({ ...current, [question.id]: true }))}
          onNext={() => setIndex((current) => current + 1)}
          isLast={index === questions.length - 1 && coding.length === 0}
        />
      ) : (
        <CodingStep exercises={coding} locked={locked} onBack={() => setIndex(0)} />
      )}
    </div>
  );
}

/**
 * What the set contains, before it is fetched.
 *
 * Deliberately a click rather than a page load. Generating the questions
 * costs a model call, and spending one every time somebody glances at a
 * concept would be paying for practice nobody asked for.
 */
function Opening({
  counts,
  onStart,
  disabled,
}: {
  counts: { coding: number };
  onStart: () => void;
  disabled: boolean;
}) {
  return (
    <Card>
      <div className="t-h3 mb2">Test yourself on this</div>
      <div className="t-body mb4" style={{ maxWidth: '72ch' }}>
        A mixed set: multiple choice for the distinctions people get wrong, written questions where
        you have to explain the idea in your own words, and{' '}
        {counts.coding > 0
          ? `${counts.coding === 1 ? 'one coding exercise' : `${counts.coding} coding exercises`} to finish.`
          : 'no coding for this concept — it is not one you practise by writing code.'}{' '}
        One question at a time.
      </div>

      <Button icon="play" onClick={onStart} disabled={disabled}>
        {disabled ? 'Locked' : 'Start'}
      </Button>
    </Card>
  );
}

function QuestionCard({
  question,
  onAnswered,
  onNext,
  isLast,
}: {
  question: PracticeQuestionView;
  onAnswered: () => void;
  onNext: () => void;
  isLast: boolean;
}) {
  return (
    <Card>
      <div className="t-h3 mb4" style={{ lineHeight: 1.6, maxWidth: '78ch' }}>
        {question.prompt}
      </div>

      {question.kind === 'MCQ' ? (
        <MultipleChoice
          question={question}
          onAnswered={onAnswered}
          onNext={onNext}
          isLast={isLast}
        />
      ) : (
        <WrittenAnswer
          question={question}
          onAnswered={onAnswered}
          onNext={onNext}
          isLast={isLast}
        />
      )}
    </Card>
  );
}

function MultipleChoice({
  question,
  onAnswered,
  onNext,
  isLast,
}: {
  question: PracticeQuestionView;
  onAnswered: () => void;
  onNext: () => void;
  isLast: boolean;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [result, setResult] = useState<RecallAnswerResult | null>(null);
  const answer = useAnswerRecall();

  const submit = async (choice: number) => {
    if (result) return;
    setSelected(choice);
    const outcome = await answer.mutateAsync({ questionId: question.id, selectedIndex: choice });
    setResult(outcome);
    onAnswered();
  };

  return (
    <div className="col g3">
      <div className="col g2">
        {question.options.map((option, optionIndex) => (
          <button
            key={option}
            type="button"
            className="card p3"
            disabled={answer.isPending || result !== null}
            onClick={() => void submit(optionIndex)}
            style={{
              textAlign: 'left',
              width: '100%',
              cursor: result ? 'default' : 'pointer',
              background: 'var(--surface-2)',
              borderColor: optionBorder(optionIndex, selected, result),
              // Only the chosen wrong answer and the right one are marked.
              // Greying the rest would tell them which options were never
              // in contention, which is half the question.
              opacity: result && !isMarked(optionIndex, selected, result) ? 0.55 : 1,
            }}
          >
            <span className="row items-center g2">
              <span className="t-caption mono" style={{ width: 16 }}>
                {String.fromCharCode(65 + optionIndex)}
              </span>
              <span className="t-body">{option}</span>
              {result && optionIndex === result.correctIndex && (
                <span style={{ color: 'var(--success)', marginLeft: 'auto' }}>
                  <Icon name="check" size={14} />
                </span>
              )}
              {result && optionIndex === selected && !result.correct && (
                <span style={{ color: 'var(--error)', marginLeft: 'auto' }}>
                  <Icon name="x" size={14} />
                </span>
              )}
            </span>
          </button>
        ))}
      </div>

      {result && (
        <>
          <div
            className="card p3"
            style={{
              background: 'var(--surface-2)',
              borderLeft: `2px solid ${result.correct ? 'var(--success)' : 'var(--error)'}`,
            }}
          >
            <div className="t-h4 mb2">{result.correct ? 'Right' : 'Not quite'}</div>
            {/* Shown either way. Being right for the wrong reason is still
                worth correcting, and this is where the learning is. */}
            <Markdown content={result.explanation} />
          </div>

          <NextButton onNext={onNext} isLast={isLast} />
        </>
      )}
    </div>
  );
}

function WrittenAnswer({
  question,
  onAnswered,
  onNext,
  isLast,
}: {
  question: PracticeQuestionView;
  onAnswered: () => void;
  onNext: () => void;
  isLast: boolean;
}) {
  const [draft, setDraft] = useState(question.previousAnswer ?? '');
  const [revealed, setRevealed] = useState<TheoryAnswerResult | null>(null);
  const [rated, setRated] = useState<number | null>(null);

  const submit = useAnswerTheory();
  const rate = useRateTheory();

  const commit = async () => {
    const result = await submit.mutateAsync({ questionId: question.id, answer: draft });
    setRevealed(result);
    onAnswered();
  };

  const judge = async (selfRating: number) => {
    setRated(selfRating);
    await rate.mutateAsync({ questionId: question.id, selfRating });
  };

  return (
    <div className="col g3">
      <textarea
        className="textarea"
        rows={6}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        disabled={revealed !== null}
        placeholder="Explain it as you would to someone on your team. A few sentences."
      />

      {!revealed ? (
        <div className="row items-center g3">
          <Button
            onClick={() => void commit()}
            disabled={draft.trim().length === 0 || submit.isPending}
          >
            {submit.isPending ? 'Submitting…' : 'Submit answer'}
          </Button>
          {/* Said plainly, because it is the reason the box has to be filled
              in before anything is shown. */}
          <span className="t-caption">The model answer appears once yours is in.</span>
        </div>
      ) : (
        <>
          <div className="card p4" style={{ background: 'var(--surface-2)' }}>
            <div className="t-h4 mb3">A good answer</div>
            <Markdown content={revealed.modelAnswer} />

            {revealed.keyPoints.length > 0 && (
              <>
                <div className="t-h4 mt4 mb2">Did yours cover these?</div>
                <div className="col g2">
                  {revealed.keyPoints.map((point) => (
                    <div key={point} className="row items-start g2">
                      <span style={{ color: 'var(--text-secondary)', marginTop: 3 }}>
                        <Icon name="check" size={13} />
                      </span>
                      <span className="t-body">{point}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {rated === null ? (
            <div className="col g2">
              <div className="t-small">How did yours compare?</div>
              <div className="row g2">
                {RATINGS.map((rating) => (
                  <Button
                    key={rating.value}
                    variant="secondary"
                    size="sm"
                    onClick={() => void judge(rating.value)}
                    disabled={rate.isPending}
                  >
                    {rating.label}
                  </Button>
                ))}
              </div>
            </div>
          ) : (
            <NextButton onNext={onNext} isLast={isLast} />
          )}
        </>
      )}
    </div>
  );
}

/**
 * Three rungs, not five.
 *
 * Any scale finer than this asks the user to distinguish grades they cannot
 * actually tell apart, and the extra precision is invented rather than
 * measured.
 */
const RATINGS = [
  { value: 0, label: 'Missed it' },
  { value: 1, label: 'Partly' },
  { value: 2, label: 'Got it' },
] as const;

function CodingStep({
  exercises,
  locked,
  onBack,
}: {
  exercises: ExerciseView[];
  locked: boolean;
  onBack: () => void;
}) {
  const navigate = useNavigate();

  return (
    <Card>
      <div className="t-h3 mb2">Now write it</div>
      <div className="t-body mb4" style={{ maxWidth: '72ch' }}>
        Explaining a concept and using it are different skills, and only this one is graded by
        running your code.
      </div>

      <div className="grid grid-2 g3 cq-grid-2">
        {exercises.map((exercise) => (
          <div
            key={exercise.id}
            className="card p3"
            style={{
              background: 'var(--surface-2)',
              cursor: locked ? 'not-allowed' : 'pointer',
              opacity: locked ? 0.5 : 1,
            }}
            onClick={() => !locked && navigate(`/exercise/${exercise.id}`)}
          >
            <div className="row justify-between items-center mb2">
              <Badge variant="neutral" icon="practice">
                {exercise.kind.toLowerCase().replace('_', ' ')}
              </Badge>
              <span className="t-caption">{exercise.estimatedMinutes} min</span>
            </div>
            <div className="t-h4" style={{ fontSize: 13 }}>
              {exercise.title}
            </div>
          </div>
        ))}
      </div>

      <div className="row g2 mt4">
        <Button variant="ghost" size="sm" icon="chevronLeft" onClick={onBack}>
          Back to the questions
        </Button>
      </div>
    </Card>
  );
}

function NextButton({ onNext, isLast }: { onNext: () => void; isLast: boolean }) {
  return (
    <div>
      <Button icon={isLast ? 'check' : 'arrowRight'} onClick={onNext}>
        {isLast ? 'Finish' : 'Next question'}
      </Button>
    </div>
  );
}

/** Only the right answer and a wrong choice are coloured. */
function isMarked(index: number, selected: number | null, result: RecallAnswerResult): boolean {
  return index === result.correctIndex || index === selected;
}

function optionBorder(
  index: number,
  selected: number | null,
  result: RecallAnswerResult | null,
): string | undefined {
  if (!result) return undefined;
  if (index === result.correctIndex) return 'var(--success)';
  if (index === selected) return 'var(--error)';
  return undefined;
}
