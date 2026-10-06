-- AI marks for a written answer, out of five, with the feedback behind it.
--
-- Self-rating stays as the fallback for an account with no AI configured, but
-- it was always the weak part of the written half: an answer exists to surface
-- what the writer cannot yet put into words, which is exactly what they are
-- least able to see in their own work.
ALTER TABLE "concept_question_answers"
  ADD COLUMN "gradeScore" INTEGER,
  ADD COLUMN "gradeCorrect" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "gradeWrong" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "gradeImprove" TEXT[] DEFAULT ARRAY[]::TEXT[];
