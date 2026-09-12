/**
 * Closed enumerations owned by ForgeRoutine.
 *
 * Anything user-extensible (technologies, concepts) is a slug, never an enum —
 * see docs/curriculum-engine.md. If adding a value here would ever require a user
 * to file a request, it does not belong here.
 */

/** The nine independent skill dimensions (§7). Never collapse these into one number. */
export const SKILL_DIMENSIONS = [
  'conceptMastery',
  'recallStrength',
  'codingAbility',
  'problemSolving',
  'debuggingAbility',
  'explanationAbility',
  'interviewReadiness',
  'confidence',
  'retention',
] as const;

export type SkillDimension = (typeof SKILL_DIMENSIONS)[number];

/**
 * Assistance levels (§8). The level is a property of the attempt, not only the exercise —
 * the same problem is re-served at a higher level once the user earns it.
 */
export const ASSISTANCE_LEVELS = [1, 2, 3, 4, 5] as const;
export type AssistanceLevel = (typeof ASSISTANCE_LEVELS)[number];

export const AssistanceLevelName: Record<AssistanceLevel, string> = {
  1: 'Guided',
  2: 'Partial',
  3: 'Recall',
  4: 'Blank',
  5: 'Interview',
};

/** Rungs of the assistance ladder (§9). Ordered weakest to strongest. */
export const HINT_KINDS = [
  'CONCEPT_REMINDER',
  'SMALL_HINT',
  'HINT',
  'DEBUGGING_QUESTION',
  'EXPLAIN_ERROR',
  'SHOW_APPROACH',
  'SHOW_SOLUTION',
] as const;

export type HintKind = (typeof HINT_KINDS)[number];

/** Cost of each rung, used by the Independent Coding Score and the escalation gate. */
export const HINT_WEIGHT: Record<HintKind, number> = {
  CONCEPT_REMINDER: 0.1,
  SMALL_HINT: 0.25,
  HINT: 0.45,
  DEBUGGING_QUESTION: 0.2,
  EXPLAIN_ERROR: 0.3,
  SHOW_APPROACH: 0.7,
  SHOW_SOLUTION: 1,
};

export type UserTechnologyStatus = 'ACTIVE' | 'PAUSED' | 'ARCHIVED';
export type Priority = 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';
export type TargetProficiency = 'AWARENESS' | 'WORKING' | 'PROFICIENT' | 'EXPERT';
export type LearningFrequency = 'DAILY' | 'FREQUENT' | 'OCCASIONAL' | 'RARE';
export type PrerequisiteStrength = 'HARD' | 'SOFT';

export type ExerciseKind =
  | 'CODING'
  | 'RECALL'
  | 'DEBUGGING'
  | 'BLIND_CODING'
  | 'EXPLANATION'
  | 'PROJECT';

export type ExerciseDifficulty = 1 | 2 | 3 | 4 | 5;

export type SupportedLanguage = 'javascript' | 'typescript';

export type AttemptOutcome = 'IN_PROGRESS' | 'PASSED' | 'FAILED' | 'ABANDONED';

export type ExecutionStatus =
  | 'PASSED'
  | 'FAILED'
  | 'COMPILE_ERROR'
  | 'RUNTIME_ERROR'
  | 'TIMEOUT'
  | 'MEMORY_EXCEEDED'
  | 'OUTPUT_EXCEEDED'
  | 'HARNESS_ERROR'
  | 'INTERNAL_ERROR';

/** Only these two are our fault and must never count against the user. */
export const INTERNAL_EXECUTION_FAILURES: readonly ExecutionStatus[] = [
  'HARNESS_ERROR',
  'INTERNAL_ERROR',
];

export type CurriculumStatus = 'GENERATING' | 'ACTIVE' | 'SUPERSEDED' | 'FAILED';

export type RoutineItemKind =
  | 'LEARN'
  | 'RECALL'
  | 'CODE'
  | 'BLIND_CODE'
  | 'DEBUG'
  | 'EXPLAIN'
  | 'REVIEW'
  | 'INTERVIEW';

export type RoutineItemStatus = 'PENDING' | 'IN_PROGRESS' | 'DONE' | 'SKIPPED';

export type InterviewMode =
  | 'QUICK'
  | 'TECHNICAL'
  | 'CODING'
  | 'DEBUGGING'
  | 'SYSTEM_DESIGN'
  | 'SENIOR';

export type InterviewTarget = 'JUNIOR' | 'MID' | 'SENIOR';

export type PrimaryGoal = 'CODING' | 'INTERVIEW' | 'JOB_PREPARATION' | 'ENGINEERING_MASTERY';

export type DailyMinutes = 30 | 45 | 60 | 90 | 120;

export type AIAgentName =
  | 'tutor'
  | 'evaluator'
  | 'interviewer'
  | 'debugger'
  | 'curriculum'
  | 'reviewer'
  | 'planner';

export type AIModelTier = 'fast' | 'reasoning';

/** Why a skill value changed. The ledger is what makes score movements explainable. */
export type SkillEventCause =
  | 'EXERCISE_ATTEMPT'
  | 'AI_EVALUATION'
  | 'INTERVIEW'
  | 'REVIEW'
  | 'SELF_ASSESSMENT'
  | 'DECAY'
  | 'INITIAL_ESTIMATE'
  | 'RECALCULATION';
