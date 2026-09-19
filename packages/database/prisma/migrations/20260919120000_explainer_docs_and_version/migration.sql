-- A link to the official documentation, and the prompt that wrote the page.
--
-- The version matters more than it looks: explainers are generated once and
-- cached for ever, so without it an improved prompt would only ever reach
-- concepts nobody had opened yet. Existing rows are marked v1 so the next
-- open rewrites them.
ALTER TABLE "concept_explainers"
  ADD COLUMN IF NOT EXISTS "docsUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "promptVersion" TEXT NOT NULL DEFAULT 'v1';
