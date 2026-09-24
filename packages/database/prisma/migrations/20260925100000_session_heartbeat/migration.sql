-- Sessions bank time as it passes, rather than measuring it at the end.
--
-- endedAt - startedAt counted idle time and lost everything if the tab was
-- closed. The client now beats while the user is actually working and the
-- server accumulates, so a closed laptop keeps what it earned and a
-- forgotten tab earns nothing.
ALTER TABLE "learning_sessions"
  ADD COLUMN IF NOT EXISTS "lastBeatAt" TIMESTAMP(3);

ALTER TABLE "learning_sessions"
  ALTER COLUMN "durationMs" SET DEFAULT 0;

UPDATE "learning_sessions" SET "durationMs" = 0 WHERE "durationMs" IS NULL;
