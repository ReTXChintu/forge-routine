-- Unfinished work moves to the next day instead of vanishing.
--
-- SKIPPED stays in the enum for rows already written with it, but nothing
-- writes it any more: the work is compulsory, so a day that is not finished
-- pushes forward rather than being dropped.
ALTER TYPE "RoutineItemStatus" ADD VALUE IF NOT EXISTS 'CARRIED';

ALTER TABLE "routine_items"
  ADD COLUMN IF NOT EXISTS "carriedFrom" TIMESTAMP(3);

-- Teaching material for a concept: generated once, shared by everyone.
CREATE TABLE "concept_explainers" (
  "id"           TEXT NOT NULL,
  "conceptId"    TEXT NOT NULL,
  "summary"      TEXT NOT NULL,
  "realWorld"    TEXT NOT NULL,
  "examples"     TEXT[] DEFAULT ARRAY[]::TEXT[],
  "codeExample"  TEXT,
  "codeLanguage" TEXT,
  "pitfalls"     TEXT[] DEFAULT ARRAY[]::TEXT[],
  "generatedBy"  TEXT NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,

  CONSTRAINT "concept_explainers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "concept_explainers_conceptId_key" ON "concept_explainers"("conceptId");

ALTER TABLE "concept_explainers"
  ADD CONSTRAINT "concept_explainers_conceptId_fkey"
  FOREIGN KEY ("conceptId") REFERENCES "concepts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The per-user half: a transcript of their own questions about the concept.
CREATE TABLE "concept_chat_messages" (
  "id"        TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "conceptId" TEXT NOT NULL,
  "role"      TEXT NOT NULL,
  "content"   TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "concept_chat_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "concept_chat_messages_userId_conceptId_createdAt_idx"
  ON "concept_chat_messages"("userId", "conceptId", "createdAt");

ALTER TABLE "concept_chat_messages"
  ADD CONSTRAINT "concept_chat_messages_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "concept_chat_messages"
  ADD CONSTRAINT "concept_chat_messages_conceptId_fkey"
  FOREIGN KEY ("conceptId") REFERENCES "concepts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
