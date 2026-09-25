import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Icon } from '~/components/Icon';
import { Markdown } from '~/components/Markdown';
import { Badge, Button, Card, ProgressBar, Spinner } from '~/components/ui';
import {
  useAnswerMcq,
  useAnswerTheory,
  useGeneratePractice,
  usePractice,
  useRateTheory,
  type PracticeQuestionView,
  type PracticeView,
} from '~/lib/queries';

/**
 * Practice on one concept: questions, then code.
 *
 * Both sections are on the page at once rather than behind a wizard, because
 * a set whose shape you can see is one you can decide to finish. Batches
 * accumulate — pressing "five more" appends below, and what you already
 * answered stays visible with its explanation.
 *
 * Neither section has a "mark as done" button, and that is the point. The
 * concept finishes when every question you were handed has an answer and
 * every exercise you were handed has passed, which the server watched
 * happen. Asking someone to then report it is how work got lost.
 */
export function ConceptPractice({
  conceptId,
  conceptName,
  locked,
  onScreenText,
}: {
  conceptId: string | undefined;
  conceptName: string;
  locked: boolean;
  /** Feeds the assistant what is on this tab. It reads; it never writes. */
  onScreenText?: (text: string) => void;
}) {
  const { data: view, isLoading, isError } = usePractice(conceptId, !locked);

  if (locked) {
    return (
      <Card>
        <div className="t-h3 mb2">Locked</div>
        <div className="t-small">Finish what comes before this concept first.</div>
      </Card>
    );
  }

  // The first visit writes a batch, which can mean waiting on a model.
  if (isLoading) return <Spinner label="Setting your questions" />;

  if (isError || !view) {
    return (
      <Card>
        <div className="t-h3 mb2">Practice could not be loaded</div>
        <div className="t-small">Try again in a moment.</div>
      </Card>
    );
  }

  return (
    <div className="col g5">
      <Summary view={view} conceptName={conceptName} />

      {view.problem && (
        <Card style={{ borderLeft: '2px solid var(--warning)' }}>
          <div className="row items-start g3">
            <span style={{ color: 'var(--warning)', marginTop: 2 }}>
              <Icon name="alert" size={16} />
            </span>
            {/* The real sentence. "Something went wrong" leaves the reader
                with nothing to act on. */}
            <div className="t-small">{view.problem}</div>
          </div>
        </Card>
      )}

      <Questions view={view} conceptId={conceptId} onScreenText={onScreenText} />
      <CodeSection view={view} conceptId={conceptId} />
    </div>
  );
}

function Summary({ view, conceptName }: { view: PracticeView; conceptName: string }) {
  const { completion } = view;
  const total = completion.questionsServed + completion.exercisesServed;
  const done = completion.questionsAnswered + completion.exercisesPassed;

  return (
    <Card
      style={{
        borderLeft: `2px solid ${completion.complete ? 'var(--success)' : 'var(--primary)'}`,
      }}
    >
      <div className="row items-center justify-between g4 mb3">
        <div className="row items-center g2">
          <span className="t-h3">{completion.complete ? 'Finished' : 'In progress'}</span>
          {view.routineDone && (
            <Badge variant="success" icon="check">
              Ticked off your routine
            </Badge>
          )}
        </div>

        <span className="t-caption">
          {done} of {total} done
        </span>
      </div>

      <ProgressBar thin pct={total === 0 ? 0 : (done / total) * 100} />

      <div className="t-small mt3">
        {completion.complete ? (
          // Said once, plainly. Nothing to press, which is the improvement.
          <>
            {conceptName} is done — every question answered and every exercise passed. Anything more
            you do here is extra practice and will not un-finish it.
          </>
        ) : (
          <>
            {describeOutstanding(completion.outstanding)} This finishes itself when they are done;
            there is nothing to mark.
          </>
        )}
      </div>
    </Card>
  );
}

function describeOutstanding(outstanding: { questions: number; exercises: number }): string {
  const parts: string[] = [];

  if (outstanding.questions > 0) {
    parts.push(
      `${outstanding.questions} ${outstanding.questions === 1 ? 'question' : 'questions'} left`,
    );
  }
  if (outstanding.exercises > 0) {
    parts.push(
      `${outstanding.exercises} ${
        outstanding.exercises === 1 ? 'exercise' : 'exercises'
      } still to pass`,
    );
  }

  return parts.length === 0 ? 'Nothing outstanding.' : `${parts.join(' and ')}.`;
}

function Questions({
  view,
  conceptId,
  onScreenText,
}: {
  view: PracticeView;
  conceptId: string | undefined;
  onScreenText?: (text: string) => void;
}) {
  const generate = useGeneratePractice(conceptId);
  const writing = generate.isPending && generate.variables === 'questions';

  return (
    <div className="col g3">
      <div className="row items-center justify-between g4">
        <span className="t-h3">Questions</span>
        <Button
          variant="secondary"
          size="sm"
          icon="plus"
          onClick={() => generate.mutate('questions')}
          disabled={generate.isPending}
        >
          {writing ? 'Writing…' : '5 more questions'}
        </Button>
      </div>

      {view.questions.length === 0 ? (
        <Card>
          <div className="t-small">No questions on this concept yet.</div>
        </Card>
      ) : (
        view.questions.map((question, index) => (
          <QuestionCard
            key={question.id}
            index={index}
            question={question}
            conceptId={conceptId}
            onScreenText={onScreenText}
          />
        ))
      )}
    </div>
  );
}

function QuestionCard({
  index,
  question,
  conceptId,
  onScreenText,
}: {
  index: number;
  question: PracticeQuestionView;
  conceptId: string | undefined;
  onScreenText?: (text: string) => void;
}) {
  return (
    <Card
      // Clicking a question is how the assistant learns which one you mean.
      onClick={onScreenText ? () => onScreenText(describeQuestion(index, question)) : undefined}
      style={{ borderLeft: question.given ? '2px solid var(--border-strong)' : undefined }}
    >
      <div className="row items-start justify-between g3 mb3">
        <div className="t-h4" style={{ lineHeight: 1.6, maxWidth: '78ch' }}>
          <span className="t-caption mono mr2">{index + 1}.</span>
          {question.prompt}
        </div>
        <Badge variant={question.kind === 'THEORY' ? 'primary' : 'neutral'}>
          {question.kind === 'THEORY' ? 'in your own words' : 'multiple choice'}
        </Badge>
      </div>

      {question.kind === 'MCQ' ? (
        <MultipleChoice question={question} conceptId={conceptId} />
      ) : (
        <WrittenAnswer question={question} conceptId={conceptId} />
      )}
    </Card>
  );
}

function MultipleChoice({
  question,
  conceptId,
}: {
  question: PracticeQuestionView;
  conceptId: string | undefined;
}) {
  const answer = useAnswerMcq(conceptId);
  const given = question.given;
  const settled = given !== null && given.selectedIndex !== null;

  return (
    <div className="col g3">
      <div className="col g2">
        {question.options.map((option, optionIndex) => (
          <button
            key={option}
            type="button"
            className="card p3"
            disabled={answer.isPending || settled}
            onClick={() => answer.mutate({ questionId: question.id, selectedIndex: optionIndex })}
            style={{
              textAlign: 'left',
              width: '100%',
              cursor: settled ? 'default' : 'pointer',
              background: 'var(--surface-2)',
              borderColor: optionBorder(optionIndex, given),
              // Only the chosen answer is marked. Greying the rest would say
              // which were never in contention, which is half the question.
              opacity: settled && optionIndex !== given.selectedIndex ? 0.5 : 1,
            }}
          >
            <span className="row items-center g2">
              <span className="t-caption mono" style={{ width: 16 }}>
                {String.fromCharCode(65 + optionIndex)}
              </span>
              <span className="t-body">{option}</span>
              {settled && optionIndex === given.selectedIndex && (
                <span
                  style={{
                    color: given.correct ? 'var(--success)' : 'var(--error)',
                    marginLeft: 'auto',
                  }}
                >
                  <Icon name={given.correct ? 'check' : 'x'} size={14} />
                </span>
              )}
            </span>
          </button>
        ))}
      </div>

      {settled && given.explanation && (
        <div
          className="card p3"
          style={{
            background: 'var(--surface-2)',
            borderLeft: `2px solid ${given.correct ? 'var(--success)' : 'var(--error)'}`,
          }}
        >
          <div className="t-h4 mb2">{given.correct ? 'Right' : 'Not quite'}</div>
          {/* Shown either way. Being right for the wrong reason is still
              worth correcting, and this is where the learning is. */}
          <Markdown content={given.explanation} />
        </div>
      )}
    </div>
  );
}

function WrittenAnswer({
  question,
  conceptId,
}: {
  question: PracticeQuestionView;
  conceptId: string | undefined;
}) {
  const given = question.given;
  const [draft, setDraft] = useState(given?.answer ?? '');

  const submit = useAnswerTheory(conceptId);
  const rate = useRateTheory(conceptId);

  // Both null-checked rather than truthy: an empty answer is not a state the
  // server allows, but a self-rating of 0 is "missed it" and must count.
  const revealed = given?.answer !== null && given?.answer !== undefined;
  const judged = given?.selfRating !== null && given?.selfRating !== undefined;

  return (
    <div className="col g3">
      <textarea
        className="textarea"
        rows={5}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        disabled={revealed}
        placeholder="Explain it as you would to someone on your team. A few sentences."
      />

      {!revealed ? (
        <div className="row items-center g3">
          <Button
            onClick={() => submit.mutate({ questionId: question.id, answer: draft })}
            disabled={draft.trim().length === 0 || submit.isPending}
          >
            {submit.isPending ? 'Submitting…' : 'Submit answer'}
          </Button>
          {/* Said plainly, because it is why the box must be filled first. */}
          <span className="t-caption">The model answer appears once yours is in.</span>
        </div>
      ) : (
        <>
          <div className="card p4" style={{ background: 'var(--surface-2)' }}>
            <div className="t-h4 mb3">A good answer</div>
            <Markdown content={given.modelAnswer ?? ''} />

            {given.keyPoints.length > 0 && (
              <>
                <div className="t-h4 mt4 mb2">Did yours cover these?</div>
                <div className="col g2">
                  {given.keyPoints.map((point) => (
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

          {judged ? (
            <div className="t-caption row items-center g1">
              <Icon name="check" size={12} />
              You marked this “{RATINGS.find((r) => r.value === given.selfRating)?.label}”
            </div>
          ) : (
            <div className="col g2">
              <div className="t-small">How did yours compare?</div>
              <div className="row g2">
                {RATINGS.map((rating) => (
                  <Button
                    key={rating.value}
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      rate.mutate({ questionId: question.id, selfRating: rating.value })
                    }
                    disabled={rate.isPending}
                  >
                    {rating.label}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Three rungs, not five.
 *
 * Any finer scale asks the user to distinguish grades they cannot actually
 * tell apart, and the extra precision is invented rather than measured.
 */
const RATINGS = [
  { value: 0, label: 'Missed it' },
  { value: 1, label: 'Partly' },
  { value: 2, label: 'Got it' },
] as const;

function CodeSection({ view, conceptId }: { view: PracticeView; conceptId: string | undefined }) {
  const navigate = useNavigate();
  const generate = useGeneratePractice(conceptId);
  const writing = generate.isPending && generate.variables === 'code';

  return (
    <div className="col g3">
      <div className="row items-center justify-between g4">
        <span className="t-h3">Code</span>
        <Button
          variant="secondary"
          size="sm"
          icon="plus"
          onClick={() => generate.mutate('code')}
          disabled={generate.isPending}
        >
          {/* Slower than a question batch: a generated exercise is run
              against its own tests before it is handed over. */}
          {writing ? 'Writing and checking…' : 'Another exercise'}
        </Button>
      </div>

      {view.exercises.length === 0 ? (
        <Card>
          <div className="t-small">
            No coding exercise here yet. Some subjects cannot be graded by running code.
          </div>
        </Card>
      ) : (
        <div className="grid grid-2 g3 cq-grid-2">
          {view.exercises.map((exercise) => (
            <Card
              key={exercise.id}
              hover
              onClick={() => navigate(`/exercise/${exercise.id}`)}
              style={{
                cursor: 'pointer',
                borderLeft: exercise.passed ? '2px solid var(--success)' : undefined,
              }}
            >
              <div className="row justify-between items-center mb2">
                <Badge
                  variant={exercise.passed ? 'success' : 'neutral'}
                  icon={exercise.passed ? 'check' : 'practice'}
                >
                  {exercise.passed ? 'passed' : exercise.kind.toLowerCase().replace('_', ' ')}
                </Badge>
                <span className="t-caption">{exercise.estimatedMinutes} min</span>
              </div>
              <div className="t-h4" style={{ fontSize: 13 }}>
                {exercise.title}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

/** What the assistant is told about a question the user pointed at. */
function describeQuestion(index: number, question: PracticeQuestionView): string {
  const lines = [`Question ${index + 1} (${question.kind}): ${question.prompt}`];

  if (question.options.length > 0) {
    lines.push(
      `Options:\n${question.options
        .map((option, i) => `${String.fromCharCode(65 + i)}. ${option}`)
        .join('\n')}`,
    );
  }

  const given = question.given;
  if (given?.selectedIndex !== null && given?.selectedIndex !== undefined) {
    lines.push(
      `They answered ${String.fromCharCode(65 + given.selectedIndex)}, which was ${
        given.correct ? 'right' : 'wrong'
      }.`,
    );
  }
  if (given?.answer) lines.push(`They wrote:\n${given.answer}`);

  return lines.join('\n\n');
}

function optionBorder(index: number, given: PracticeQuestionView['given']): string | undefined {
  if (!given || given.selectedIndex === null) return undefined;
  if (index === given.selectedIndex) return given.correct ? 'var(--success)' : 'var(--error)';
  return undefined;
}
