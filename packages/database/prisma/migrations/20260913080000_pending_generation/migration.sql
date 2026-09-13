-- A generation job that is in the plan but not yet runnable.
--
-- Distinct from QUEUED so the whole pipeline is visible to the user without
-- those rows being work the runner will pick up. Only the technology whose
-- turn it is becomes QUEUED; everything after it waits in PENDING and costs
-- nothing.
ALTER TYPE "GenerationStatus" ADD VALUE IF NOT EXISTS 'PENDING' BEFORE 'QUEUED';
