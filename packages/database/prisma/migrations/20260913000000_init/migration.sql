-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserTechnologyStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "TargetProficiency" AS ENUM ('AWARENESS', 'WORKING', 'PROFICIENT', 'EXPERT');

-- CreateEnum
CREATE TYPE "LearningFrequency" AS ENUM ('DAILY', 'FREQUENT', 'OCCASIONAL', 'RARE');

-- CreateEnum
CREATE TYPE "PrerequisiteStrength" AS ENUM ('HARD', 'SOFT');

-- CreateEnum
CREATE TYPE "CurriculumStatus" AS ENUM ('GENERATING', 'ACTIVE', 'SUPERSEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "ExerciseKind" AS ENUM ('CODING', 'RECALL', 'DEBUGGING', 'BLIND_CODING', 'EXPLANATION', 'PROJECT');

-- CreateEnum
CREATE TYPE "AttemptOutcome" AS ENUM ('IN_PROGRESS', 'PASSED', 'FAILED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "ExecutionStatus" AS ENUM ('PASSED', 'FAILED', 'COMPILE_ERROR', 'RUNTIME_ERROR', 'TIMEOUT', 'MEMORY_EXCEEDED', 'OUTPUT_EXCEEDED', 'HARNESS_ERROR', 'INTERNAL_ERROR');

-- CreateEnum
CREATE TYPE "HintKind" AS ENUM ('CONCEPT_REMINDER', 'SMALL_HINT', 'HINT', 'DEBUGGING_QUESTION', 'EXPLAIN_ERROR', 'SHOW_APPROACH', 'SHOW_SOLUTION');

-- CreateEnum
CREATE TYPE "RoutineItemKind" AS ENUM ('LEARN', 'RECALL', 'CODE', 'BLIND_CODE', 'DEBUG', 'EXPLAIN', 'REVIEW', 'INTERVIEW');

-- CreateEnum
CREATE TYPE "RoutineItemStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'DONE', 'SKIPPED');

-- CreateEnum
CREATE TYPE "InterviewMode" AS ENUM ('QUICK', 'TECHNICAL', 'CODING', 'DEBUGGING', 'SYSTEM_DESIGN', 'SENIOR');

-- CreateEnum
CREATE TYPE "InterviewTarget" AS ENUM ('JUNIOR', 'MID', 'SENIOR');

-- CreateEnum
CREATE TYPE "PrimaryGoal" AS ENUM ('CODING', 'INTERVIEW', 'JOB_PREPARATION', 'ENGINEERING_MASTERY');

-- CreateEnum
CREATE TYPE "SkillEventCause" AS ENUM ('EXERCISE_ATTEMPT', 'AI_EVALUATION', 'INTERVIEW', 'REVIEW', 'SELF_ASSESSMENT', 'DECAY', 'INITIAL_ESTIMATE', 'RECALCULATION');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "lastLoginAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_preferences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dailyMinutes" INTEGER NOT NULL DEFAULT 45,
    "adaptiveDifficulty" BOOLEAN NOT NULL DEFAULT true,
    "interviewTarget" "InterviewTarget" NOT NULL DEFAULT 'MID',
    "primaryGoal" "PrimaryGoal" NOT NULL DEFAULT 'CODING',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "technologies" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT 'general',
    "curatedCurriculum" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "technologies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_technologies" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "technologyId" TEXT NOT NULL,
    "status" "UserTechnologyStatus" NOT NULL DEFAULT 'ACTIVE',
    "priority" "Priority" NOT NULL DEFAULT 'NORMAL',
    "targetProficiency" "TargetProficiency" NOT NULL DEFAULT 'WORKING',
    "interviewImportance" INTEGER NOT NULL DEFAULT 3,
    "frequency" "LearningFrequency" NOT NULL DEFAULT 'FREQUENT',
    "existingKnowledge" DOUBLE PRECISION,
    "archivedAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_technologies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "curriculum_versions" (
    "id" TEXT NOT NULL,
    "technologyId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "generatorVersion" TEXT NOT NULL,
    "status" "CurriculumStatus" NOT NULL DEFAULT 'GENERATING',
    "model" TEXT,
    "promptVersion" TEXT,
    "conceptCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "curriculum_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "concepts" (
    "id" TEXT NOT NULL,
    "technologyId" TEXT NOT NULL,
    "curriculumVersionId" TEXT,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "difficulty" INTEGER NOT NULL DEFAULT 3,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "learningObjectives" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "codingPatterns" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "commonMistakes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "concepts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "concept_prerequisites" (
    "conceptId" TEXT NOT NULL,
    "prerequisiteId" TEXT NOT NULL,
    "strength" "PrerequisiteStrength" NOT NULL DEFAULT 'HARD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "concept_prerequisites_pkey" PRIMARY KEY ("conceptId","prerequisiteId")
);

-- CreateTable
CREATE TABLE "skills" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conceptId" TEXT NOT NULL,
    "conceptMastery" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "recallStrength" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "codingAbility" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "problemSolving" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "debuggingAbility" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "explanationAbility" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "interviewReadiness" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "retention" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "assistanceLevel" INTEGER NOT NULL DEFAULT 1,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastPracticedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skill_events" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "dimension" TEXT NOT NULL,
    "before" DOUBLE PRECISION NOT NULL,
    "after" DOUBLE PRECISION NOT NULL,
    "cause" "SkillEventCause" NOT NULL,
    "sourceId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "skill_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "progress_snapshots" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "capturedOn" DATE NOT NULL,
    "independentCodingScore" DOUBLE PRECISION,
    "interviewReadiness" DOUBLE PRECISION,
    "conceptsPractised" INTEGER NOT NULL DEFAULT 0,
    "minutesPractised" INTEGER NOT NULL DEFAULT 0,
    "attemptsTotal" INTEGER NOT NULL DEFAULT 0,
    "attemptsIndependent" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "progress_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exercises" (
    "id" TEXT NOT NULL,
    "conceptId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" "ExerciseKind" NOT NULL DEFAULT 'CODING',
    "difficulty" INTEGER NOT NULL DEFAULT 3,
    "language" TEXT NOT NULL DEFAULT 'javascript',
    "objective" TEXT NOT NULL,
    "requirements" TEXT NOT NULL DEFAULT '',
    "functionSignature" TEXT,
    "starterCode" TEXT,
    "examples" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "staticHints" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "referenceSolution" TEXT,
    "brokenCode" TEXT,
    "bugExplanation" TEXT,
    "estimatedMinutes" INTEGER NOT NULL DEFAULT 15,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exercises_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exercise_test_cases" (
    "id" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "code" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exercise_test_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exercise_attempts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "sessionId" TEXT,
    "assistanceLevel" INTEGER NOT NULL DEFAULT 1,
    "outcome" "AttemptOutcome" NOT NULL DEFAULT 'IN_PROGRESS',
    "blindMode" BOOLEAN NOT NULL DEFAULT false,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firstCodeAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "timeToFirstCodeMs" INTEGER,
    "totalDurationMs" INTEGER,
    "aiRequestCount" INTEGER NOT NULL DEFAULT 0,
    "solutionRevealed" BOOLEAN NOT NULL DEFAULT false,
    "submissionCount" INTEGER NOT NULL DEFAULT 0,
    "keystrokeCount" INTEGER,
    "largePasteEvents" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exercise_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "code_submissions" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'javascript',
    "diagnosis" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "code_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "execution_results" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "status" "ExecutionStatus" NOT NULL,
    "passed" BOOLEAN NOT NULL DEFAULT false,
    "testsPassed" INTEGER NOT NULL DEFAULT 0,
    "testsTotal" INTEGER NOT NULL DEFAULT 0,
    "cases" JSONB NOT NULL DEFAULT '[]',
    "stdout" TEXT NOT NULL DEFAULT '',
    "stderr" TEXT NOT NULL DEFAULT '',
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "execution_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "code_evaluations" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "overallScore" DOUBLE PRECISION,
    "correctness" DOUBLE PRECISION,
    "readability" DOUBLE PRECISION,
    "architecture" DOUBLE PRECISION,
    "performance" DOUBLE PRECISION,
    "security" DOUBLE PRECISION,
    "errorHandling" DOUBLE PRECISION,
    "edgeCases" DOUBLE PRECISION,
    "idiomatic" DOUBLE PRECISION,
    "diagnosisAccuracy" DOUBLE PRECISION,
    "strengths" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "weaknesses" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "conceptGaps" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "recommendedDifficulty" TEXT NOT NULL DEFAULT 'same',
    "nextAction" TEXT NOT NULL DEFAULT 'practice',
    "degraded" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "code_evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hint_requests" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "kind" "HintKind" NOT NULL,
    "response" TEXT NOT NULL,
    "secondsSinceOpen" INTEGER NOT NULL DEFAULT 0,
    "intervened" BOOLEAN NOT NULL DEFAULT false,
    "degraded" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hint_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "routines" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "totalMinutes" INTEGER NOT NULL DEFAULT 45,
    "completedMinutes" INTEGER NOT NULL DEFAULT 0,
    "generatedBy" TEXT NOT NULL DEFAULT 'rules',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "routines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "routine_items" (
    "id" TEXT NOT NULL,
    "routineId" TEXT NOT NULL,
    "kind" "RoutineItemKind" NOT NULL,
    "status" "RoutineItemStatus" NOT NULL DEFAULT 'PENDING',
    "minutes" INTEGER NOT NULL DEFAULT 10,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "title" TEXT NOT NULL,
    "rationale" TEXT NOT NULL DEFAULT '',
    "conceptId" TEXT,
    "exerciseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "routine_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "routineItemId" TEXT,
    "conceptId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "learning_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_schedules" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conceptId" TEXT NOT NULL,
    "easeFactor" DOUBLE PRECISION NOT NULL DEFAULT 2.5,
    "intervalDays" INTEGER NOT NULL DEFAULT 0,
    "repetitions" INTEGER NOT NULL DEFAULT 0,
    "lapses" INTEGER NOT NULL DEFAULT 0,
    "dueAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastReviewedAt" TIMESTAMP(3),
    "frozenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "review_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interviews" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mode" "InterviewMode" NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "targetLevel" "InterviewTarget" NOT NULL DEFAULT 'MID',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "interviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interview_questions" (
    "id" TEXT NOT NULL,
    "interviewId" TEXT NOT NULL,
    "conceptId" TEXT,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "prompt" TEXT NOT NULL,
    "move" TEXT NOT NULL DEFAULT 'PIVOT',
    "depth" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interview_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interview_answers" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "correctness" DOUBLE PRECISION,
    "depth" DOUBLE PRECISION,
    "specificity" DOUBLE PRECISION,
    "confidence" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interview_answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interview_evaluations" (
    "id" TEXT NOT NULL,
    "interviewId" TEXT NOT NULL,
    "overallScore" DOUBLE PRECISION,
    "technicalCorrectness" DOUBLE PRECISION,
    "depth" DOUBLE PRECISION,
    "problemSolving" DOUBLE PRECISION,
    "communication" DOUBLE PRECISION,
    "confidence" DOUBLE PRECISION,
    "practicalKnowledge" DOUBLE PRECISION,
    "architectureThinking" DOUBLE PRECISION,
    "debugging" DOUBLE PRECISION,
    "codeQuality" DOUBLE PRECISION,
    "tradeOffAwareness" DOUBLE PRECISION,
    "strongAreas" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "weakAreas" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "recommendedTopics" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "interviewReadiness" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interview_evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_interactions" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "agent" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL DEFAULT 'v1',
    "inputHash" TEXT NOT NULL,
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "outcome" TEXT NOT NULL DEFAULT 'OK',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_interactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "token_usage_daily" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "tokens" INTEGER NOT NULL DEFAULT 0,
    "calls" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "token_usage_daily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_archivedAt_idx" ON "users"("archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "user_preferences_userId_key" ON "user_preferences"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "refresh_tokens_userId_familyId_idx" ON "refresh_tokens"("userId", "familyId");

-- CreateIndex
CREATE INDEX "refresh_tokens_expiresAt_idx" ON "refresh_tokens"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "technologies_slug_key" ON "technologies"("slug");

-- CreateIndex
CREATE INDEX "technologies_category_idx" ON "technologies"("category");

-- CreateIndex
CREATE INDEX "user_technologies_userId_status_idx" ON "user_technologies"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "user_technologies_userId_technologyId_key" ON "user_technologies"("userId", "technologyId");

-- CreateIndex
CREATE INDEX "curriculum_versions_technologyId_status_idx" ON "curriculum_versions"("technologyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "curriculum_versions_technologyId_version_key" ON "curriculum_versions"("technologyId", "version");

-- CreateIndex
CREATE INDEX "concepts_technologyId_orderIndex_idx" ON "concepts"("technologyId", "orderIndex");

-- CreateIndex
CREATE UNIQUE INDEX "concepts_technologyId_slug_key" ON "concepts"("technologyId", "slug");

-- CreateIndex
CREATE INDEX "concept_prerequisites_prerequisiteId_idx" ON "concept_prerequisites"("prerequisiteId");

-- CreateIndex
CREATE INDEX "skills_userId_codingAbility_idx" ON "skills"("userId", "codingAbility");

-- CreateIndex
CREATE INDEX "skills_userId_conceptMastery_idx" ON "skills"("userId", "conceptMastery");

-- CreateIndex
CREATE INDEX "skills_userId_interviewReadiness_idx" ON "skills"("userId", "interviewReadiness");

-- CreateIndex
CREATE UNIQUE INDEX "skills_userId_conceptId_key" ON "skills"("userId", "conceptId");

-- CreateIndex
CREATE INDEX "skill_events_userId_createdAt_idx" ON "skill_events"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "skill_events_skillId_createdAt_idx" ON "skill_events"("skillId", "createdAt");

-- CreateIndex
CREATE INDEX "progress_snapshots_userId_capturedOn_idx" ON "progress_snapshots"("userId", "capturedOn");

-- CreateIndex
CREATE UNIQUE INDEX "progress_snapshots_userId_capturedOn_key" ON "progress_snapshots"("userId", "capturedOn");

-- CreateIndex
CREATE INDEX "exercises_conceptId_kind_idx" ON "exercises"("conceptId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "exercises_conceptId_slug_key" ON "exercises"("conceptId", "slug");

-- CreateIndex
CREATE INDEX "exercise_test_cases_exerciseId_orderIndex_idx" ON "exercise_test_cases"("exerciseId", "orderIndex");

-- CreateIndex
CREATE INDEX "exercise_attempts_userId_createdAt_idx" ON "exercise_attempts"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "exercise_attempts_userId_exerciseId_idx" ON "exercise_attempts"("userId", "exerciseId");

-- CreateIndex
CREATE INDEX "exercise_attempts_exerciseId_outcome_idx" ON "exercise_attempts"("exerciseId", "outcome");

-- CreateIndex
CREATE INDEX "code_submissions_userId_createdAt_idx" ON "code_submissions"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "code_submissions_attemptId_idempotencyKey_key" ON "code_submissions"("attemptId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "execution_results_submissionId_key" ON "execution_results"("submissionId");

-- CreateIndex
CREATE UNIQUE INDEX "code_evaluations_submissionId_key" ON "code_evaluations"("submissionId");

-- CreateIndex
CREATE INDEX "hint_requests_attemptId_createdAt_idx" ON "hint_requests"("attemptId", "createdAt");

-- CreateIndex
CREATE INDEX "routines_userId_date_idx" ON "routines"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "routines_userId_date_key" ON "routines"("userId", "date");

-- CreateIndex
CREATE INDEX "routine_items_routineId_orderIndex_idx" ON "routine_items"("routineId", "orderIndex");

-- CreateIndex
CREATE INDEX "learning_sessions_userId_startedAt_idx" ON "learning_sessions"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "review_schedules_userId_dueAt_idx" ON "review_schedules"("userId", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "review_schedules_userId_conceptId_key" ON "review_schedules"("userId", "conceptId");

-- CreateIndex
CREATE INDEX "interviews_userId_startedAt_idx" ON "interviews"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "interview_questions_interviewId_orderIndex_idx" ON "interview_questions"("interviewId", "orderIndex");

-- CreateIndex
CREATE UNIQUE INDEX "interview_answers_questionId_key" ON "interview_answers"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX "interview_evaluations_interviewId_key" ON "interview_evaluations"("interviewId");

-- CreateIndex
CREATE INDEX "ai_interactions_userId_createdAt_idx" ON "ai_interactions"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_interactions_agent_createdAt_idx" ON "ai_interactions"("agent", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "token_usage_daily_userId_day_key" ON "token_usage_daily"("userId", "day");

-- AddForeignKey
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_technologies" ADD CONSTRAINT "user_technologies_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_technologies" ADD CONSTRAINT "user_technologies_technologyId_fkey" FOREIGN KEY ("technologyId") REFERENCES "technologies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "curriculum_versions" ADD CONSTRAINT "curriculum_versions_technologyId_fkey" FOREIGN KEY ("technologyId") REFERENCES "technologies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concepts" ADD CONSTRAINT "concepts_technologyId_fkey" FOREIGN KEY ("technologyId") REFERENCES "technologies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concepts" ADD CONSTRAINT "concepts_curriculumVersionId_fkey" FOREIGN KEY ("curriculumVersionId") REFERENCES "curriculum_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concept_prerequisites" ADD CONSTRAINT "concept_prerequisites_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "concepts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concept_prerequisites" ADD CONSTRAINT "concept_prerequisites_prerequisiteId_fkey" FOREIGN KEY ("prerequisiteId") REFERENCES "concepts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skills" ADD CONSTRAINT "skills_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skills" ADD CONSTRAINT "skills_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "concepts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_events" ADD CONSTRAINT "skill_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_events" ADD CONSTRAINT "skill_events_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progress_snapshots" ADD CONSTRAINT "progress_snapshots_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exercises" ADD CONSTRAINT "exercises_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "concepts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exercise_test_cases" ADD CONSTRAINT "exercise_test_cases_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "exercises"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exercise_attempts" ADD CONSTRAINT "exercise_attempts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exercise_attempts" ADD CONSTRAINT "exercise_attempts_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "exercises"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exercise_attempts" ADD CONSTRAINT "exercise_attempts_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "learning_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "code_submissions" ADD CONSTRAINT "code_submissions_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "exercise_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "code_submissions" ADD CONSTRAINT "code_submissions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "execution_results" ADD CONSTRAINT "execution_results_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "code_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "code_evaluations" ADD CONSTRAINT "code_evaluations_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "code_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hint_requests" ADD CONSTRAINT "hint_requests_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "exercise_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routines" ADD CONSTRAINT "routines_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routine_items" ADD CONSTRAINT "routine_items_routineId_fkey" FOREIGN KEY ("routineId") REFERENCES "routines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routine_items" ADD CONSTRAINT "routine_items_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "concepts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routine_items" ADD CONSTRAINT "routine_items_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "exercises"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_sessions" ADD CONSTRAINT "learning_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_sessions" ADD CONSTRAINT "learning_sessions_routineItemId_fkey" FOREIGN KEY ("routineItemId") REFERENCES "routine_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_sessions" ADD CONSTRAINT "learning_sessions_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "concepts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_schedules" ADD CONSTRAINT "review_schedules_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_schedules" ADD CONSTRAINT "review_schedules_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "concepts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interview_questions" ADD CONSTRAINT "interview_questions_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "interviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interview_questions" ADD CONSTRAINT "interview_questions_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "concepts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interview_answers" ADD CONSTRAINT "interview_answers_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "interview_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interview_evaluations" ADD CONSTRAINT "interview_evaluations_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "interviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_interactions" ADD CONSTRAINT "ai_interactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "token_usage_daily" ADD CONSTRAINT "token_usage_daily_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

