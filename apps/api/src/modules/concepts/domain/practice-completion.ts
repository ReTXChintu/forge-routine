/**
 * When a concept's practice is finished.
 *
 * Pure, and separate from the service, because this is the rule the whole
 * feature turns on and it has to be readable on its own. Getting it wrong is
 * not a crash — it is a concept that silently never completes, or one that
 * completes without the work, and neither shows up as an error anywhere.
 *
 * The rule: every question you were **served** has an answer, and every
 * coding exercise you were served has been passed.
 *
 * Served, not available. Questions and exercises are a pool shared per
 * concept, so measuring against the pool would mean a concept that grows to
 * forty questions can never be finished by anyone — and that somebody else
 * generating a question could un-finish yours.
 *
 * Answered, not answered correctly. Getting one wrong already shows the
 * explanation and already feeds the review schedule; making a wrong answer
 * block completion would turn the explanation into an obstacle instead of the
 * place the learning happens. Coding is the exception, because a test suite
 * either passes or it does not.
 */

export interface AssignedQuestion {
  questionId: string;
  /** A multiple-choice pick, or a written answer that has been self-rated. */
  answered: boolean;
}

export interface AssignedExercise {
  exerciseId: string;
  passed: boolean;
}

export interface CompletionState {
  /** True once everything served has been dealt with. */
  complete: boolean;
  questionsAnswered: number;
  questionsServed: number;
  exercisesPassed: number;
  exercisesServed: number;
  /** What is left, for the UI to name rather than leaving the user hunting. */
  outstanding: { questions: number; exercises: number };
}

export function completionState(
  questions: readonly AssignedQuestion[],
  exercises: readonly AssignedExercise[],
): CompletionState {
  const questionsAnswered = questions.filter((question) => question.answered).length;
  const exercisesPassed = exercises.filter((exercise) => exercise.passed).length;

  const outstanding = {
    questions: questions.length - questionsAnswered,
    exercises: exercises.length - exercisesPassed,
  };

  return {
    // Nothing served is not the same as everything done. A concept whose
    // practice has never been opened would otherwise report itself finished,
    // and then auto-complete its routine item the moment anything asked.
    complete:
      questions.length + exercises.length > 0 &&
      outstanding.questions === 0 &&
      outstanding.exercises === 0,
    questionsAnswered,
    questionsServed: questions.length,
    exercisesPassed,
    exercisesServed: exercises.length,
    outstanding,
  };
}

/** A multiple-choice pick, or a written answer that has been judged. */
export function isAnswered(row: {
  selectedIndex: number | null;
  selfRating: number | null;
}): boolean {
  // Submitting prose is not finishing it: the reveal-then-judge step is where
  // a written answer is actually compared against anything, so a row with an
  // answer and no rating is half done.
  return row.selectedIndex !== null || row.selfRating !== null;
}
