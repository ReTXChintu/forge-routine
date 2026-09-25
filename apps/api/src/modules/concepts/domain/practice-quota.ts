/**
 * Whether a concept's questions are worth a model call.
 *
 * Pure, and separate from the service, because getting it wrong costs money
 * rather than correctness — and a rule about spending should be testable
 * without a database or a vendor.
 */

export interface Quota {
  mcqs: number;
  theory: number;
}

export interface QuestionRecord {
  kind: string;
  /** Null for hand-authored seed questions, which are never regenerated. */
  promptVersion: string | null;
}

/**
 * True at most once per concept per prompt version.
 *
 * The test is "has anything been written at this version", **not** "are
 * there enough questions". The difference is a money leak: a model asked
 * for six that returns five leaves a permanent shortfall, and counting
 * would buy another six every time anybody opened the tab. Five good
 * questions is a practice set; an uncapped retry is a bill.
 *
 * A concept whose seed already covers both quotas costs nothing, and
 * bumping the version deliberately buys one more call per concept — the
 * only way an improved prompt reaches a set already written.
 */
export function needsGeneration(
  questions: readonly QuestionRecord[],
  version: string,
  quota: Quota,
): boolean {
  if (questions.some((question) => question.promptVersion === version)) return false;

  // Only the hand-authored ones count towards the quotas. Anything generated
  // that survives to here belongs to a superseded version and is about to be
  // archived — counting it would make a version bump a no-op, which is
  // precisely the bug this function existed to avoid.
  const seeded = questions.filter((question) => question.promptVersion === null);
  const mcqs = seeded.filter((question) => question.kind === 'MCQ').length;
  const theory = seeded.filter((question) => question.kind === 'THEORY').length;

  return mcqs < quota.mcqs || theory < quota.theory;
}
