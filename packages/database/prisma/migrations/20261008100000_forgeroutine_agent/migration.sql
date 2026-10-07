-- ForgeRoutine Agent: paired devices, one-time pairing codes, and the order
-- in which a user's local CLIs are tried.

ALTER TABLE "user_preferences"
  ADD COLUMN "localAiOrder" "AIProviderKind"[] NOT NULL DEFAULT ARRAY['CLAUDE_CODE', 'CODEX']::"AIProviderKind"[];

CREATE TABLE "agent_devices" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_devices_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "agent_pairings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_pairings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "agent_devices_tokenHash_key" ON "agent_devices"("tokenHash");
CREATE INDEX "agent_devices_userId_idx" ON "agent_devices"("userId");
CREATE UNIQUE INDEX "agent_pairings_codeHash_key" ON "agent_pairings"("codeHash");
CREATE INDEX "agent_pairings_userId_idx" ON "agent_pairings"("userId");

ALTER TABLE "agent_devices" ADD CONSTRAINT "agent_devices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_pairings" ADD CONSTRAINT "agent_pairings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
