-- AlterTable
ALTER TABLE "code_evaluations" ADD COLUMN     "reviewIssues" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "code_submissions" ADD COLUMN     "stepIndex" INTEGER;

-- AlterTable
ALTER TABLE "exercise_attempts" ADD COLUMN     "currentStep" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "exercise_test_cases" ADD COLUMN     "stepId" TEXT;

-- CreateTable
CREATE TABLE "project_steps" (
    "id" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "requirements" TEXT NOT NULL DEFAULT '',
    "starterCode" TEXT,
    "referenceSolution" TEXT,
    "estimatedMinutes" INTEGER NOT NULL DEFAULT 20,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_steps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_steps_exerciseId_orderIndex_idx" ON "project_steps"("exerciseId", "orderIndex");

-- CreateIndex
CREATE UNIQUE INDEX "project_steps_exerciseId_orderIndex_key" ON "project_steps"("exerciseId", "orderIndex");

-- AddForeignKey
ALTER TABLE "project_steps" ADD CONSTRAINT "project_steps_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "exercises"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exercise_test_cases" ADD CONSTRAINT "exercise_test_cases_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "project_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

