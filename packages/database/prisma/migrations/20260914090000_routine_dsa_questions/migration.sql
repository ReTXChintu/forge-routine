-- Routine items can now be projects and checkpoints.
--
-- The roadmap has always produced both, and the routine planner copied the
-- kind across verbatim, so a user whose next roadmap item was a project hit
-- an enum violation on insert. The cast that hid it in TypeScript is gone
-- with this migration.
ALTER TYPE "RoutineItemKind" ADD VALUE IF NOT EXISTS 'PROJECT';
ALTER TYPE "RoutineItemKind" ADD VALUE IF NOT EXISTS 'CHECKPOINT';

-- How many questions a RECALL item should ask.
--
-- Stored rather than counted at read time so today's plan says the same
-- thing all day, even if the concept gains questions while it is open.
ALTER TABLE "routine_items"
  ADD COLUMN IF NOT EXISTS "questionCount" INTEGER NOT NULL DEFAULT 0;
