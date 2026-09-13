/**
 * Cancels queued and stalled curriculum generation jobs.
 *
 *   pnpm db:cancel-generation
 *
 * Nothing about this is destructive to learning data: a generation job is
 * only an intent to spend money on content that does not exist yet.
 * Cancelling one means the technology stays unbuilt until it is actually
 * needed, which is the behaviour the queue now has by default.
 *
 * It exists because a backlog is a standing bill. Jobs queued by an older
 * version — or left RUNNING by a process that was killed mid-build — would
 * otherwise resume the next time the user opens the app.
 */
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(resolve(import.meta.dirname, '../apps/api/index.js'));
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const pending = await prisma.generationJob.findMany({
    where: { status: { in: ['QUEUED', 'RUNNING'] } },
    select: { id: true, status: true, target: true, step: true },
  });

  if (pending.length === 0) {
    console.log('\nNothing queued or running.');
    return;
  }

  const technologies = await prisma.technology.findMany({
    where: { id: { in: pending.map((job) => job.target) } },
    select: { id: true, name: true, _count: { select: { concepts: true } } },
  });
  const byId = new Map(technologies.map((technology) => [technology.id, technology]));

  console.log(`\n${pending.length} job(s) would have run and been billed for:\n`);
  for (const job of pending) {
    const technology = byId.get(job.target);
    console.log(
      `  ${job.status.padEnd(8)} ${(technology?.name ?? job.target).padEnd(18)} ` +
        `${technology?._count.concepts ?? 0} concepts already exist`,
    );
  }

  const cancelled = await prisma.generationJob.updateMany({
    where: { status: { in: ['QUEUED', 'RUNNING'] } },
    data: {
      status: 'FAILED',
      error: 'Cancelled: curriculum is now built one technology at a time, on demand.',
      finishedAt: new Date(),
    },
  });

  console.log(`\nCancelled ${cancelled.count}. Nothing was deleted.`);
  console.log('The next technology will be queued when progress warrants it.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
