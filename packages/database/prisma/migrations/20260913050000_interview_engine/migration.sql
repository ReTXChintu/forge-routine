-- Phase 8: the interview engine needs two things the schema did not have.

-- What a strong answer would touch. Written when the question is asked so
-- the grader has something to grade against, rather than re-deriving it.
ALTER TABLE "interview_questions"
  ADD COLUMN "expectedPoints" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- The debrief in prose. The scores say how much; this says what to do about
-- it. NULL marks a report produced without AI, so the UI can admit it is thin
-- rather than presenting arithmetic as insight.
ALTER TABLE "interview_evaluations"
  ADD COLUMN "summary" TEXT;
