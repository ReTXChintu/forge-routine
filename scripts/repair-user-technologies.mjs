/**
 * Brings a user's technology selection and generation pipeline back into a
 * correct state.
 *
 *   node scripts/repair-user-technologies.mjs <email> [--yes]
 *
 * Adds any catalogue technologies the user does not have, clears stale job
 * rows, and rebuilds the pending pipeline in learning order. Nothing is
 * generated and nothing is billed: the pipeline is a plan, and the runner
 * promotes one entry at a time when progress warrants it.
 *
 * Needed because job rows accumulate state that no longer reflects reality —
 * an older version queued seventeen technologies at once, a killed process
 * left one RUNNING forever, and a cancellation marked nine as FAILED when
 * they had simply not started.
 */
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(resolve(import.meta.dirname, '../apps/api/index.js'));
const root = resolve(import.meta.dirname, '..');

const { PrismaClient } = require('@prisma/client');
const { orderTechnologies } = require(resolve(root, 'packages/curriculum/dist/index.cjs'));

const email = process.argv[2];
const confirmed = process.argv.includes('--yes');

const prisma = new PrismaClient();

/** Matches GENERATOR_VERSION. A seed-1 curriculum is a starter set. */
const CURRENT_GENERATOR = 'ai-1';

async function main() {
  if (!email) {
    console.error('Usage: node scripts/repair-user-technologies.mjs <email> [--yes]');
    process.exitCode = 1;
    return;
  }

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) {
    console.error(`No user with email ${email}`);
    process.exitCode = 1;
    return;
  }

  // 1. Every catalogue technology the user does not yet have.
  const all = await prisma.technology.findMany({
    select: { id: true, slug: true, name: true, dependsOn: true, learningOrder: true },
  });
  const existing = await prisma.userTechnology.findMany({
    where: { userId: user.id },
    select: { technologyId: true },
  });
  const have = new Set(existing.map((row) => row.technologyId));
  const missing = all.filter((technology) => !have.has(technology.id));

  // 2. What is actually finished, as opposed to merely having rows.
  const complete = new Set(
    (
      await prisma.curriculumVersion.findMany({
        where: { status: 'ACTIVE', generatorVersion: CURRENT_GENERATOR },
        select: { technologyId: true },
      })
    ).map((version) => version.technologyId),
  );

  const conceptCounts = new Map(
    (
      await prisma.concept.groupBy({
        by: ['technologyId'],
        where: { archivedAt: null },
        _count: true,
      })
    ).map((row) => [row.technologyId, row._count]),
  );

  const order = orderTechnologies(
    all.map((technology) => ({
      technologyId: technology.id,
      slug: technology.slug,
      dependsOn: technology.dependsOn,
      weight: -technology.learningOrder,
    })),
  );
  const byId = new Map(all.map((technology) => [technology.id, technology]));

  console.log(`\n${email}`);
  console.log(`  technologies held:    ${have.size} of ${all.length}`);
  console.log(`  would be added:       ${missing.map((t) => t.slug).join(', ') || 'none'}`);

  const unfinished = order.filter((id) => !complete.has(id));
  console.log(`  full courses built:   ${complete.size}`);
  console.log(`  still to build:       ${unfinished.length}`);

  const jobs = await prisma.generationJob.groupBy({ by: ['status'], _count: true });
  console.log(`  existing job rows:    ${jobs.map((j) => `${j.status}=${j._count}`).join(' ')}`);

  if (!confirmed) {
    console.log('\nPass --yes to apply. Nothing is generated or billed either way.');
    return;
  }

  if (missing.length > 0) {
    await prisma.userTechnology.createMany({
      data: missing.map((technology) => ({ userId: user.id, technologyId: technology.id })),
      skipDuplicates: true,
    });
  }

  // Clear every open or cancelled row and rebuild from scratch. Reconciling
  // in place would preserve whatever wrong state caused the repair.
  await prisma.generationJob.deleteMany({
    where: {
      userId: user.id,
      kind: 'TECHNOLOGY_CURRICULUM',
      status: { in: ['PENDING', 'QUEUED', 'RUNNING', 'FAILED'] },
    },
  });

  const pending = unfinished.map((technologyId, index) => ({
    userId: user.id,
    kind: 'TECHNOLOGY_CURRICULUM',
    target: technologyId,
    status: 'PENDING',
    step: `${byId.get(technologyId).name} is waiting its turn (#${index + 1})`,
  }));

  if (pending.length > 0) {
    await prisma.generationJob.createMany({ data: pending });
  }

  console.log(`\nApplied. ${pending.length} technologies are pending, in this order:\n`);
  for (const [index, technologyId] of unfinished.entries()) {
    const technology = byId.get(technologyId);
    const concepts = conceptCounts.get(technologyId) ?? 0;
    console.log(
      `  ${String(index + 1).padStart(2)}. ${technology.slug.padEnd(22)}` +
        (concepts > 0 ? `${concepts} starter concepts, needs the full course` : ''),
    );
  }
  console.log('\nNothing was generated. The first one starts when it is asked for.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
