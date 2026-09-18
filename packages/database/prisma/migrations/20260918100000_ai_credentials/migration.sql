-- Per-user choice of model vendor, with the key to reach it.
--
-- Switching vendor used to mean editing .env and restarting. It is now a
-- settings change, which is the difference between "we could try Gemini"
-- and "we will try Gemini".

CREATE TYPE "AIProviderKind" AS ENUM ('OPENAI', 'ANTHROPIC', 'GEMINI');

ALTER TABLE "user_preferences"
  ADD COLUMN IF NOT EXISTS "aiProvider" "AIProviderKind";

CREATE TABLE "ai_credentials" (
  "id"             TEXT NOT NULL,
  "userId"         TEXT NOT NULL,
  "provider"       "AIProviderKind" NOT NULL,
  -- AES-256-GCM, as v1:iv:tag:ciphertext. Never returned by the API.
  "keyCipher"      TEXT NOT NULL,
  "keyLast4"       TEXT NOT NULL,
  "modelFast"      TEXT,
  "modelReasoning" TEXT,
  "verifiedAt"     TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ai_credentials_pkey" PRIMARY KEY ("id")
);

-- One key per vendor per user. Saving a new one replaces the old.
CREATE UNIQUE INDEX "ai_credentials_userId_provider_key"
  ON "ai_credentials"("userId", "provider");

-- Cascade: a deleted account must not leave its vendor keys behind.
ALTER TABLE "ai_credentials"
  ADD CONSTRAINT "ai_credentials_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
