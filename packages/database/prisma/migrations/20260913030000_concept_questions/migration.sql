-- AlterTable
ALTER TABLE "technologies" ADD COLUMN     "exerciseLanguage" TEXT DEFAULT 'javascript';

-- CreateTable
CREATE TABLE "concept_questions" (
    "id" TEXT NOT NULL,
    "conceptId" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "options" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "correctIndex" INTEGER NOT NULL DEFAULT 0,
    "explanation" TEXT NOT NULL DEFAULT '',
    "difficulty" INTEGER NOT NULL DEFAULT 3,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "concept_questions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "concept_questions_conceptId_idx" ON "concept_questions"("conceptId");

-- AddForeignKey
ALTER TABLE "concept_questions" ADD CONSTRAINT "concept_questions_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "concepts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
