-- CreateEnum
CREATE TYPE "RoadmapStatus" AS ENUM ('BUILDING', 'ACTIVE', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "RoadmapItemKind" AS ENUM ('LEARN', 'RECALL', 'CODE', 'BLIND_CODE', 'DEBUG', 'EXPLAIN', 'PROJECT', 'CHECKPOINT', 'INTERVIEW');

-- CreateEnum
CREATE TYPE "RoadmapItemStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'DONE', 'SKIPPED', 'AWAITING_CONTENT');

-- CreateEnum
CREATE TYPE "GenerationKind" AS ENUM ('ROADMAP_SKELETON', 'TECHNOLOGY_CURRICULUM', 'EXERCISES', 'INTERVIEW_QUESTIONS');

-- CreateEnum
CREATE TYPE "GenerationStatus" AS ENUM ('QUEUED', 'RUNNING', 'PARTIAL', 'READY', 'FAILED');

-- AlterTable
ALTER TABLE "user_preferences" ADD COLUMN     "interviewDate" TIMESTAMP(3),
ADD COLUMN     "onboardedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "roadmaps" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "RoadmapStatus" NOT NULL DEFAULT 'ACTIVE',
    "generatedBy" TEXT NOT NULL DEFAULT 'rules',
    "technologyOrder" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "totalMinutes" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roadmaps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roadmap_phases" (
    "id" TEXT NOT NULL,
    "roadmapId" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "goal" TEXT NOT NULL DEFAULT '',
    "technologyId" TEXT,
    "estimatedMinutes" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roadmap_phases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roadmap_items" (
    "id" TEXT NOT NULL,
    "phaseId" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "kind" "RoadmapItemKind" NOT NULL,
    "status" "RoadmapItemStatus" NOT NULL DEFAULT 'PENDING',
    "conceptId" TEXT,
    "exerciseId" TEXT,
    "title" TEXT NOT NULL,
    "rationale" TEXT NOT NULL DEFAULT '',
    "estimatedMinutes" INTEGER NOT NULL DEFAULT 15,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roadmap_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generation_jobs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "GenerationKind" NOT NULL,
    "target" TEXT NOT NULL,
    "status" "GenerationStatus" NOT NULL DEFAULT 'QUEUED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "step" TEXT NOT NULL DEFAULT '',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "generation_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "roadmaps_userId_status_idx" ON "roadmaps"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "roadmaps_userId_version_key" ON "roadmaps"("userId", "version");

-- CreateIndex
CREATE INDEX "roadmap_phases_roadmapId_orderIndex_idx" ON "roadmap_phases"("roadmapId", "orderIndex");

-- CreateIndex
CREATE UNIQUE INDEX "roadmap_phases_roadmapId_orderIndex_key" ON "roadmap_phases"("roadmapId", "orderIndex");

-- CreateIndex
CREATE INDEX "roadmap_items_phaseId_orderIndex_idx" ON "roadmap_items"("phaseId", "orderIndex");

-- CreateIndex
CREATE INDEX "roadmap_items_conceptId_idx" ON "roadmap_items"("conceptId");

-- CreateIndex
CREATE UNIQUE INDEX "roadmap_items_phaseId_orderIndex_key" ON "roadmap_items"("phaseId", "orderIndex");

-- CreateIndex
CREATE INDEX "generation_jobs_userId_status_idx" ON "generation_jobs"("userId", "status");

-- CreateIndex
CREATE INDEX "generation_jobs_status_createdAt_idx" ON "generation_jobs"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "roadmaps" ADD CONSTRAINT "roadmaps_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roadmap_phases" ADD CONSTRAINT "roadmap_phases_roadmapId_fkey" FOREIGN KEY ("roadmapId") REFERENCES "roadmaps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roadmap_items" ADD CONSTRAINT "roadmap_items_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "roadmap_phases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roadmap_items" ADD CONSTRAINT "roadmap_items_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "concepts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roadmap_items" ADD CONSTRAINT "roadmap_items_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "exercises"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

