-- The model the assistant answers with, separate from the fast tier.
--
-- The fast tier is shared by the assistant chat and the submission evaluator,
-- so raising it to get better tutoring would also change how code is graded.
-- Nobody would choose that trade deliberately, so the tutor gets its own field.
-- Null follows modelFast, which is the behaviour before this column existed.
ALTER TABLE "ai_credentials" ADD COLUMN "modelTutor" TEXT;
