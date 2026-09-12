import type {
  AssistanceLevel,
  AttemptOutcome,
  CurriculumStatus,
  DailyMinutes,
  ExecutionStatus,
  ExerciseDifficulty,
  ExerciseKind,
  HintKind,
  InterviewTarget,
  LearningFrequency,
  PrerequisiteStrength,
  PrimaryGoal,
  Priority,
  RoutineItemKind,
  RoutineItemStatus,
  SkillDimension,
  SupportedLanguage,
  TargetProficiency,
  UserTechnologyStatus,
} from './enums.js';

/** A score in [0,1]. Rendered as a percentage only at the UI edge. */
export type UnitScore = number;

export type ISODateString = string;

export interface Identified {
  id: string;
}

export interface Timestamped {
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

// -- Identity ---------------------------------------------------------------

export interface User extends Identified, Timestamped {
  email: string;
  displayName: string;
}

export interface UserPreferences {
  dailyMinutes: DailyMinutes;
  adaptiveDifficulty: boolean;
  interviewTarget: InterviewTarget;
  primaryGoal: PrimaryGoal;
  timezone: string;
}

// -- Learning universe ------------------------------------------------------

export interface Technology extends Identified, Timestamped {
  slug: string;
  name: string;
  description: string;
  category: string;
  curatedCurriculum: boolean;
}

/** The user's relationship to a technology. Separate from the global catalogue row. */
export interface UserTechnology extends Identified, Timestamped {
  technologyId: string;
  technology?: Technology;
  status: UserTechnologyStatus;
  priority: Priority;
  targetProficiency: TargetProficiency;
  /** 0-5. Multiplies interview-readiness weighting. */
  interviewImportance: number;
  frequency: LearningFrequency;
  /** Self-declared starting point, used to seed skills so experts skip the basics. */
  existingKnowledge: UnitScore | null;
  archivedAt: ISODateString | null;
  pausedAt: ISODateString | null;
}

export interface Concept extends Identified, Timestamped {
  technologyId: string;
  slug: string;
  name: string;
  description: string;
  difficulty: ExerciseDifficulty;
  orderIndex: number;
  learningObjectives: string[];
  codingPatterns: string[];
  commonMistakes: string[];
}

export interface ConceptPrerequisite {
  conceptId: string;
  prerequisiteId: string;
  strength: PrerequisiteStrength;
}

export interface CurriculumVersion extends Identified, Timestamped {
  technologyId: string;
  version: number;
  generatorVersion: string;
  status: CurriculumStatus;
  model: string | null;
  promptVersion: string | null;
  conceptCount: number;
}

// -- Skill model ------------------------------------------------------------

export type SkillVector = Record<SkillDimension, UnitScore>;

export interface Skill extends Identified, Timestamped {
  userId: string;
  conceptId: string;
  concept?: Concept;
  dimensions: SkillVector;
  /** Current assistance level for this concept. Drives which exercise variant is served. */
  assistanceLevel: AssistanceLevel;
  attempts: number;
  lastPracticedAt: ISODateString | null;
}

export interface SkillSummary {
  technologyId: string;
  technologyName: string;
  technologySlug: string;
  conceptCount: number;
  practisedConceptCount: number;
  dimensions: SkillVector;
}

export interface WeakSkill {
  conceptId: string;
  conceptName: string;
  technologyName: string;
  dimension: SkillDimension;
  value: UnitScore;
  /** Populated when the weakness traces to an unmet prerequisite (§6). */
  rootCauseConceptId: string | null;
  rootCauseConceptName: string | null;
}

// -- Exercises --------------------------------------------------------------

export interface ExerciseTestCase {
  name: string;
  /** Hidden cases are executed but not shown before submission. */
  hidden: boolean;
}

export interface Exercise extends Identified, Timestamped {
  conceptId: string;
  slug: string;
  title: string;
  kind: ExerciseKind;
  difficulty: ExerciseDifficulty;
  language: SupportedLanguage;
  /** The one-line objective shown at level 4. */
  objective: string;
  /** Full requirements, shown at levels 1-3. */
  requirements: string;
  /** Provided at levels 1-2 only. */
  functionSignature: string | null;
  /** Provided at level 1 only. */
  starterCode: string | null;
  examples: string[];
  staticHints: string[];
  estimatedMinutes: number;
  testCases: ExerciseTestCase[];
  /** DEBUGGING only: the faulty code the user must diagnose (§13). */
  brokenCode: string | null;
}

/** What the user is actually allowed to see, after the assistance level is applied. */
export interface ExerciseView {
  id: string;
  slug: string;
  title: string;
  kind: ExerciseKind;
  difficulty: ExerciseDifficulty;
  language: SupportedLanguage;
  assistanceLevel: AssistanceLevel;
  objective: string;
  requirements: string | null;
  functionSignature: string | null;
  starterCode: string | null;
  examples: string[];
  visibleTestNames: string[];
  estimatedMinutes: number;
  aiAssistanceEnabled: boolean;
  /**
   * DEBUGGING only. Shown at every assistance level: the bug *is* the problem
   * statement, so withholding it would leave nothing to do.
   */
  brokenCode: string | null;
  /** True when the user must submit a written diagnosis alongside the fix. */
  requiresDiagnosis: boolean;
}

// -- Attempts and submissions ----------------------------------------------

export interface ExerciseAttempt extends Identified, Timestamped {
  userId: string;
  exerciseId: string;
  sessionId: string | null;
  assistanceLevel: AssistanceLevel;
  outcome: AttemptOutcome;
  openedAt: ISODateString;
  firstCodeAt: ISODateString | null;
  completedAt: ISODateString | null;
  timeToFirstCodeMs: number | null;
  totalDurationMs: number | null;
  aiRequestCount: number;
  solutionRevealed: boolean;
  submissionCount: number;
  blindMode: boolean;
}

export interface TestCaseResult {
  name: string;
  passed: boolean;
  durationMs: number;
  expected?: string;
  received?: string;
  error?: string;
}

export interface ExecutionResult {
  status: ExecutionStatus;
  passed: boolean;
  testsPassed: number;
  testsTotal: number;
  cases: TestCaseResult[];
  stdout: string;
  stderr: string;
  durationMs: number;
  truncated: boolean;
}

/** Quality dimensions the AI scores after execution. `null` means unscored, never zero. */
export interface CodeQualityScores {
  correctness: UnitScore | null;
  readability: UnitScore | null;
  architecture: UnitScore | null;
  performance: UnitScore | null;
  security: UnitScore | null;
  errorHandling: UnitScore | null;
  edgeCases: UnitScore | null;
  idiomatic: UnitScore | null;
  /** DEBUGGING only: how accurately the fault was identified, apart from the fix. */
  diagnosisAccuracy: UnitScore | null;
}

export interface CodeEvaluation {
  overallScore: UnitScore | null;
  quality: CodeQualityScores;
  strengths: string[];
  weaknesses: string[];
  conceptGaps: string[];
  recommendedDifficulty: 'easier' | 'same' | 'harder';
  nextAction: 'practice' | 'advance' | 'review-prerequisite' | 'rest';
  /** True when AI was unavailable and only execution facts were used. */
  degraded: boolean;
}

export interface CodeSubmission extends Identified, Timestamped {
  attemptId: string;
  userId: string;
  code: string;
  language: SupportedLanguage;
  execution: ExecutionResult;
  evaluation: CodeEvaluation | null;
}

export interface HintRequest extends Identified, Timestamped {
  attemptId: string;
  kind: HintKind;
  response: string;
  secondsSinceOpen: number;
}

// -- Independence -----------------------------------------------------------

export interface IndependenceComponents {
  independentCompletionRate: UnitScore;
  assistanceRestraint: UnitScore;
  solutionAbstinence: UnitScore;
  timeToFirstCode: UnitScore;
  reattemptSuccess: UnitScore;
  levelWeight: UnitScore;
}

export interface IndependentCodingScore {
  /** null when there is not enough evidence. Never show a new user a low score. */
  score: UnitScore | null;
  status: 'OK' | 'INSUFFICIENT_DATA';
  attemptsConsidered: number;
  windowDays: number;
  components: IndependenceComponents;
  /** Change versus the previous window, in score points. */
  deltaFromPreviousWindow: number | null;
}

// -- Routine ----------------------------------------------------------------

export interface RoutineItem extends Identified {
  kind: RoutineItemKind;
  status: RoutineItemStatus;
  minutes: number;
  conceptId: string | null;
  conceptName: string | null;
  technologyName: string | null;
  exerciseId: string | null;
  title: string;
  rationale: string;
  orderIndex: number;
}

export interface Routine extends Identified, Timestamped {
  userId: string;
  date: ISODateString;
  totalMinutes: number;
  completedMinutes: number;
  items: RoutineItem[];
  generatedBy: 'ai' | 'rules';
}

export interface LearningSession extends Identified, Timestamped {
  userId: string;
  routineItemId: string | null;
  conceptId: string | null;
  startedAt: ISODateString;
  endedAt: ISODateString | null;
  durationMs: number | null;
}

// -- Review scheduling ------------------------------------------------------

export interface ReviewSchedule extends Identified, Timestamped {
  userId: string;
  conceptId: string;
  easeFactor: number;
  intervalDays: number;
  repetitions: number;
  lapses: number;
  dueAt: ISODateString;
  lastReviewedAt: ISODateString | null;
}

// -- Dashboard --------------------------------------------------------------

export interface DashboardOverview {
  greeting: string;
  todayMinutesDone: number;
  todayMinutesTarget: number;
  independence: IndependentCodingScore;
  interviewReadiness: UnitScore | null;
  currentFocus: string[];
  weakestSkills: WeakSkill[];
  routine: Routine | null;
  nextAction: NextAction | null;
}

export interface NextAction {
  kind: RoutineItemKind;
  title: string;
  rationale: string;
  conceptId: string | null;
  exerciseId: string | null;
  estimatedMinutes: number;
}
