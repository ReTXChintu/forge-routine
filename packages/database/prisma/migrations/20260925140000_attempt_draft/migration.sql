-- The editor's contents, saved as they are typed.
--
-- Only submitted code was ever stored, so navigating away lost everything
-- since the last submit. An editor that quietly discards work is one nobody
-- trusts, and this is the one place the product needs to be trusted.
ALTER TABLE "exercise_attempts"
  ADD COLUMN IF NOT EXISTS "draftCode" TEXT,
  ADD COLUMN IF NOT EXISTS "draftSavedAt" TIMESTAMP(3);
