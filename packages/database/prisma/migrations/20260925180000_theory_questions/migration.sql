-- Written questions alongside multiple choice.
--
-- Practice on a concept was one coding exercise, and multiple choice only
-- where a technology happened to ship it. Recognising an idea in a list of
-- four is not the same as being able to state it, and only the second one
-- survives an interview or a code review.
CREATE TYPE "ConceptQuestionKind" AS ENUM ('MCQ', 'THEORY');

ALTER TABLE "concept_questions"
  ADD COLUMN "kind" "ConceptQuestionKind" NOT NULL DEFAULT 'MCQ',
  ADD COLUMN "modelAnswer" TEXT,
  ADD COLUMN "keyPoints" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "generatedBy" TEXT,
  ADD COLUMN "promptVersion" TEXT;

CREATE INDEX "concept_questions_conceptId_kind_idx" ON "concept_questions"("conceptId", "kind");

CREATE TABLE "concept_theory_answers" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "questionId" TEXT NOT NULL,
  "conceptId" TEXT NOT NULL,
  "answer" TEXT NOT NULL,
  "selfRating" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "concept_theory_answers_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "concept_theory_answers_userId_conceptId_createdAt_idx"
  ON "concept_theory_answers"("userId", "conceptId", "createdAt");

ALTER TABLE "concept_theory_answers"
  ADD CONSTRAINT "concept_theory_answers_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "concept_theory_answers_questionId_fkey"
    FOREIGN KEY ("questionId") REFERENCES "concept_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "concept_theory_answers_conceptId_fkey"
    FOREIGN KEY ("conceptId") REFERENCES "concepts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
