import type { AssistanceLevel, ExerciseView } from '@forgeroutine/shared-types';

/**
 * Projects a stored exercise into what the user is actually allowed to see at
 * their earned assistance level (§8).
 *
 * This is pure domain logic with no framework or database imports, because it is
 * the single most security-and-product-sensitive projection in the application:
 * leaking the starter code at level 4 quietly destroys the exercise's entire value.
 */

export interface StoredExercise {
  id: string;
  slug: string;
  title: string;
  kind: 'CODING' | 'RECALL' | 'DEBUGGING' | 'BLIND_CODING' | 'EXPLANATION' | 'PROJECT';
  difficulty: number;
  language: string;
  objective: string;
  requirements: string;
  functionSignature: string | null;
  starterCode: string | null;
  examples: string[];
  estimatedMinutes: number;
  testCases: { name: string; hidden: boolean }[];
  brokenCode: string | null;
}

export interface ProjectionOptions {
  level: AssistanceLevel;
  blindMode: boolean;
}

/**
 * | Level | Name      | Given                                      |
 * |-------|-----------|--------------------------------------------|
 * | 1     | Guided    | requirements, hints, signature, examples   |
 * | 2     | Partial   | requirements, signature                    |
 * | 3     | Recall    | problem statement only                     |
 * | 4     | Blank     | the objective, one line                    |
 * | 5     | Interview | realistic problem, AI off by default       |
 */
export function projectExercise(
  exercise: StoredExercise,
  options: ProjectionOptions,
): ExerciseView {
  const { level, blindMode } = options;

  // DEBUGGING inverts the usual rule. The faulty code is the problem statement,
  // so it is shown at every level, and the requirements stay visible because
  // without them "what should this do?" is unanswerable (§13).
  const isDebugging = exercise.kind === 'DEBUGGING';

  const showRequirements = isDebugging || level <= 3 || level === 5;
  const showSignature = level <= 2;
  const showStarter = level === 1;
  const showExamples = level === 1;

  // Test names are a specification in miniature. At level 3 and above, reading
  // them would hand over the structure the user is supposed to derive.
  const showTestNames = level <= 2 && !blindMode;

  return {
    id: exercise.id,
    slug: exercise.slug,
    title: exercise.title,
    kind: exercise.kind,
    difficulty: exercise.difficulty as ExerciseView['difficulty'],
    language: exercise.language as ExerciseView['language'],
    assistanceLevel: level,
    objective: exercise.objective,
    requirements: showRequirements ? exercise.requirements : null,
    brokenCode: isDebugging ? exercise.brokenCode : null,
    // Diagnosis before repair: a user who shuffles code until the tests pass
    // has not learned to find a fault.
    requiresDiagnosis: isDebugging,
    functionSignature: showSignature ? exercise.functionSignature : null,
    starterCode: showStarter ? exercise.starterCode : null,
    examples: showExamples ? exercise.examples : [],
    visibleTestNames: showTestNames
      ? exercise.testCases.filter((t) => !t.hidden).map((t) => t.name)
      : [],
    estimatedMinutes: exercise.estimatedMinutes,
    // Level 5 is interview conditions and Blind Coding has no assistance channel
    // at all (§12), so both switch AI off by default.
    aiAssistanceEnabled: !blindMode && level < 5,
  };
}
