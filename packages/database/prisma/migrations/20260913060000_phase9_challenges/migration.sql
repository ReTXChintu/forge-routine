-- Phase 9: system design, incident and terminal challenges.

-- None of these three are graded by running the user's code. A design and an
-- incident diagnosis are prose; a terminal scenario is graded by replaying the
-- commands against the simulator in @forgeroutine/terminal.
ALTER TYPE "ExerciseKind" ADD VALUE IF NOT EXISTS 'SYSTEM_DESIGN';
ALTER TYPE "ExerciseKind" ADD VALUE IF NOT EXISTS 'INCIDENT';
ALTER TYPE "ExerciseKind" ADD VALUE IF NOT EXISTS 'TERMINAL';

-- Kind-specific payload. JSON rather than three sets of columns: the shapes
-- have nothing in common, and fifteen nullable columns that are null for every
-- ordinary exercise would make the table harder to read for no gain.
ALTER TABLE "exercises" ADD COLUMN "challengeSpec" JSONB;
