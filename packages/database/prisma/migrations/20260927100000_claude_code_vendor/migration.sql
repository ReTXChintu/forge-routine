-- Claude through the locally installed Claude Code CLI.
--
-- Keyless: it answers as whatever that CLI is signed in as. Only works where
-- the API process itself runs, so a local or desktop build rather than a
-- deployed server.
ALTER TYPE "AIProviderKind" ADD VALUE 'CLAUDE_CODE';
