-- Learning order for technologies, so curriculum is generated one at a time
-- in a sensible sequence rather than all at once on sign-up.
--
-- Hand-authored rather than inferred: the generator can propose
-- cross-technology prerequisites, but only once both sides already exist,
-- which is too late to decide what to build first and pays a model to answer
-- a question we already know.
ALTER TABLE "technologies"
  ADD COLUMN "dependsOn" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "learningOrder" INTEGER NOT NULL DEFAULT 500;
