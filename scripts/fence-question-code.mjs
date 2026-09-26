/**
 * Puts code fences around code in questions written before the prompt asked
 * for them.
 *
 *   pnpm db:fence-questions            # dry run
 *   pnpm db:fence-questions --apply    # do it
 *
 * Questions came back with real newlines and correctly indented code and no
 * fences, so the page rendered each snippet as one unreadable line. The prompt
 * now demands fences and the page fences anything arriving without them — but
 * the stored text is also what the model is shown when it writes further
 * questions on the same concept, so it is worth fixing at the source.
 *
 * Idempotent: anything already fenced is left alone. Dry by default, because a
 * script that rewrites a table on being run with no arguments is one nobody
 * should have written.
 */
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

// Resolved from the api workspace, the way every other script here does it:
// the repo root has no node_modules entry for the workspace packages.
const require = createRequire(resolve(import.meta.dirname, '../apps/api/index.js'));
const { PrismaClient } = require('@prisma/client');
const { fenceCode } = require('@forgeroutine/utils');

const apply = process.argv.includes('--apply');
const prisma = new PrismaClient();

const questions = await prisma.conceptQuestion.findMany({
  where: { archivedAt: null },
  select: { id: true, prompt: true, explanation: true, modelAnswer: true },
});

let changed = 0;

for (const question of questions) {
  const prompt = fenceCode(question.prompt);
  const explanation = fenceCode(question.explanation);
  const modelAnswer = question.modelAnswer ? fenceCode(question.modelAnswer) : question.modelAnswer;

  if (
    prompt === question.prompt &&
    explanation === question.explanation &&
    modelAnswer === question.modelAnswer
  ) {
    continue;
  }

  changed += 1;

  if (apply) {
    await prisma.conceptQuestion.update({
      where: { id: question.id },
      data: { prompt, explanation, modelAnswer },
    });
  } else if (changed <= 2) {
    // A sample, not all of them: enough to see the shape before committing to
    // a write across the whole table.
    console.log('---');
    console.log(prompt.slice(0, 400));
  }
}

console.log(
  apply
    ? `Fenced code in ${changed} of ${questions.length} questions.`
    : `Would fence code in ${changed} of ${questions.length} questions. Re-run with --apply.`,
);

await prisma.$disconnect();
