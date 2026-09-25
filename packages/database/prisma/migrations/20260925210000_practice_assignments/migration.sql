-- Answers of both kinds in one table, and a record of what each user was handed.
--
-- Multiple-choice answers were never stored, so nothing could tell a finished
-- practice set from an untouched one — which is why a concept never completed
-- on its own. And questions are a pool shared per concept, so completion has
-- to be measured against the batches a person actually pulled rather than a
-- pool that keeps growing behind them.
ALTER TABLE "concept_theory_answers" RENAME TO "concept_question_answers";

ALTER INDEX "concept_theory_answers_pkey" RENAME TO "concept_question_answers_pkey";
ALTER INDEX "concept_theory_answers_userId_conceptId_createdAt_idx"
  RENAME TO "concept_question_answers_userId_conceptId_createdAt_idx";

ALTER TABLE "concept_question_answers"
  RENAME CONSTRAINT "concept_theory_answers_userId_fkey" TO "concept_question_answers_userId_fkey";
ALTER TABLE "concept_question_answers"
  RENAME CONSTRAINT "concept_theory_answers_questionId_fkey" TO "concept_question_answers_questionId_fkey";
ALTER TABLE "concept_question_answers"
  RENAME CONSTRAINT "concept_theory_answers_conceptId_fkey" TO "concept_question_answers_conceptId_fkey";

-- The prose answer is now optional: a multiple-choice row has an index instead.
ALTER TABLE "concept_question_answers"
  ALTER COLUMN "answer" DROP NOT NULL,
  ADD COLUMN "selectedIndex" INTEGER,
  ADD COLUMN "correct" BOOLEAN;

CREATE TABLE "practice_assignments" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "conceptId" TEXT NOT NULL,
  "questionId" TEXT,
  "exerciseId" TEXT,
  "batch" INTEGER NOT NULL DEFAULT 0,
  "servedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "practice_assignments_pkey" PRIMARY KEY ("id")
);

-- Nothing is served to the same person twice. Postgres counts NULLs as
-- distinct, so exercise rows do not collide on the question index.
CREATE UNIQUE INDEX "practice_assignments_userId_questionId_key"
  ON "practice_assignments"("userId", "questionId");
CREATE UNIQUE INDEX "practice_assignments_userId_exerciseId_key"
  ON "practice_assignments"("userId", "exerciseId");
CREATE INDEX "practice_assignments_userId_conceptId_batch_idx"
  ON "practice_assignments"("userId", "conceptId", "batch");

ALTER TABLE "practice_assignments"
  ADD CONSTRAINT "practice_assignments_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "practice_assignments_conceptId_fkey"
    FOREIGN KEY ("conceptId") REFERENCES "concepts"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "practice_assignments_questionId_fkey"
    FOREIGN KEY ("questionId") REFERENCES "concept_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "practice_assignments_exerciseId_fkey"
    FOREIGN KEY ("exerciseId") REFERENCES "exercises"("id") ON DELETE CASCADE ON UPDATE CASCADE;
