import type {
  CodeEvaluation,
  ExecutionResult,
  ExerciseView,
  HintRequest,
  UnitScore,
} from './domain.js';
import type { HintKind, SupportedLanguage } from './enums.js';

/** Cursor pagination envelope used by every list endpoint (docs/api.md). */
export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

/** RFC 9457 problem details. The only error shape the API emits. */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  errors?: Record<string, string[]>;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
}

export interface StartAttemptResponse {
  attemptId: string;
  exercise: ExerciseView;
  openedAt: string;
  /**
   * Whatever was last in the editor, autosaved. Null on a genuinely fresh
   * start, in which case the client shows the exercise's starter code.
   */
  draftCode: string | null;
  draftSavedAt: string | null;
  /**
   * When this user first passed this exercise, if they ever did. Reopening
   * solved work should say so rather than presenting a blank start and
   * inviting them to do it twice.
   */
  solvedAt: string | null;
}

export interface SubmitCodeRequest {
  attemptId: string;
  code: string;
  language: SupportedLanguage;
  /** DEBUGGING only: what the user believes is wrong, graded separately. */
  diagnosis?: string;
  /** Client-reported, advisory only. Never affects scoring. */
  clientSignals?: ClientAttemptSignals;
}

export interface ClientAttemptSignals {
  keystrokeCount?: number;
  largePasteEvents?: number;
  firstCodeAtMs?: number;
}

export interface DiagnosisResult {
  accuracy: UnitScore | null;
  feedback: string;
  /** Revealed only after the user has committed to a diagnosis of their own. */
  actualCause: string | null;
}

export interface SubmissionResponse {
  submissionId: string;
  execution: ExecutionResult;
  evaluation: CodeEvaluation | null;
  diagnosis: DiagnosisResult | null;
  attemptOutcome: 'PASSED' | 'FAILED';
  skillDeltas: SkillDelta[];
  independenceScore: UnitScore | null;
  nextActionHint: string | null;
}

export interface SkillDelta {
  conceptId: string;
  conceptName: string;
  dimension: string;
  before: UnitScore;
  after: UnitScore;
}

export interface HintRequestPayload {
  attemptId: string;
  kind: HintKind;
  /** The user's current code, so HINT and EXPLAIN_ERROR can be specific. */
  code?: string;
  lastError?: string;
  /** Set when the user confirmed the escalation-gate override. */
  overrideGate?: boolean;
}

export interface HintResponse {
  hint: HintRequest;
  /** Present when the anti-dependency intervention fired instead of the raw hint. */
  intervention: string | null;
  remainingBeforeSolution: number;
  degraded: boolean;
}
