/**
 * Ticks off routine rows for concepts whose practice is already finished, and
 * drops the question-batch rows left over from an older design.
 *
 *   pnpm db:settle-routines           # dry run
 *   pnpm db:settle-routines --apply   # do it
 *
 * The planner now skips a finished concept, but it only decides what to plan
 * *next* — rows already written stay outstanding for ever. Completion is
 * recorded when an answer lands, against the rows that existed at that moment,
 * so a concept finished on Tuesday left Wednesday's freshly planned row
 * untouched. This settles the ones already sitting there.
 *
 * Dry by default, because a script that rewrites a table on being run with no
 * arguments is one nobody should have written.
 */
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(resolve(import.meta.dirname, '../apps/api/index.js'));
const { PrismaClient } = require('@prisma/client');

const apply = process.argv.includes('--apply');
const prisma = new PrismaClient();

const outstanding = await prisma.routineItem.findMany({
  where: { status: { in: ['PENDING', 'IN_PROGRESS'] } },
  include: { routine: { select: { userId: true, id: true } } },
});

/** The same rule the concept page and the planner apply. */
async function isFinished(userId, conceptId) {
  const assignments = await prisma.practiceAssignment.findMany({
    where: { userId, conceptId },
    select: { questionId: true, exerciseId: true },
  });
  // Nothing served is not the same as everything done.
  if (assignments.length === 0) return false;

  const answers = await prisma.conceptQuestionAnswer.findMany({
    where: { userId, conceptId },
    select: { questionId: true, selectedIndex: true, selfRating: true },
  });
  const passed = await prisma.exerciseAttempt.findMany({
    where: { userId, outcome: 'PASSED', exercise: { conceptId } },
    select: { exerciseId: true },
  });

  const answered = new Set(
    answers.filter((a) => a.selectedIndex !== null || a.selfRating !== null).map((a) => a.questionId),
  );
  const passedIds = new Set(passed.map((p) => p.exerciseId));

  return assignments.every((a) =>
    a.questionId ? answered.has(a.questionId) : passedIds.has(a.exerciseId),
  );
}

const done = [];
const stale = [];

for (const item of outstanding) {
  if (item.kind === 'RECALL') {
    stale.push(item);
    continue;
  }
  if (!item.conceptId || item.exerciseId) continue;
  if (await isFinished(item.routine.userId, item.conceptId)) done.push(item);
}

for (const item of [...done, ...stale]) {
  console.log(`${done.includes(item) ? 'DONE ' : 'DROP '} ${item.kind.padEnd(8)} ${item.title}`);
}

if (apply) {
  const ids = [...done, ...stale].map((item) => item.id);
  if (ids.length > 0) {
    // Dropped rows are marked DONE rather than deleted: a routine that loses
    // a row reads as though the day was smaller than it was.
    await prisma.routineItem.updateMany({ where: { id: { in: ids } }, data: { status: 'DONE' } });

    for (const routineId of new Set([...done, ...stale].map((item) => item.routine.id))) {
      const items = await prisma.routineItem.findMany({
        where: { routineId },
        select: { minutes: true, status: true },
      });
      await prisma.routine.update({
        where: { id: routineId },
        data: {
          completedMinutes: items
            .filter((i) => i.status === 'DONE')
            .reduce((sum, i) => sum + i.minutes, 0),
        },
      });
    }
  }
}

console.log(
  apply
    ? `Settled ${done.length} finished and ${stale.length} leftover rows.`
    : `Would settle ${done.length} finished and ${stale.length} leftover rows. Re-run with --apply.`,
);

await prisma.$disconnect();
