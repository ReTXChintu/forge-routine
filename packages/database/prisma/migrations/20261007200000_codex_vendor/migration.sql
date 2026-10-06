-- ChatGPT through the locally installed Codex CLI.
--
-- Keyless: it answers as whatever ChatGPT account that CLI is signed in as.
-- Like Claude Code, it only works where the API process itself runs.
ALTER TYPE "AIProviderKind" ADD VALUE 'CODEX';
