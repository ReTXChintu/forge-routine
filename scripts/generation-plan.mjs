/**
 * Shows what curriculum generation would do right now, and what it would
 * cost, without calling OpenAI.
 *
 *   node scripts/generation-plan.mjs
 *
 * The point of this script is that the expensive decision — "should we build
 * another technology" — is now inspectable. Before, the only way to find out
 * was to watch the bill.
 */
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(resolve(import.meta.dirname, '../apps/api/index.js'));
const root = resolve(import.meta.dirname, '..');

const { PrismaClient } = require('@prisma/client');
const { orderTechnologies, nextToGenerate, shouldGenerateAhead, GENERATE_AHEAD_AT } = require(
  resolve(root, 'packages/curriculum/dist/index.cjs'),
);

const prisma = new PrismaClient();

/** Matches GENERATOR_VERSION. A seed-1 curriculum is a starter set, not a course. */
const CURRENT_GENERATOR = 'ai-1';

async function main() {
  const users = await prisma.user.findMany({ select: { id: true, email: true } });

  for (const user of users) {
    const rows = await prisma.userTechnology.findMany({
      where: { userId: user.id, status: 'ACTIVE', archivedAt: null },
      include: {
        technology: {
          select: {
            id: true,
            slug: true,
            name: true,
            dependsOn: true,
            learningOrder: true,
            _count: { select: { concepts: { where: { archivedAt: null } } } },
            curriculumVersions: {
              where: { status: 'ACTIVE', generatorVersion: CURRENT_GENERATOR },
              select: { id: true },
              take: 1,
            },
          },
        },
      },
    });

    const technologies = rows.map((row) => ({
      technologyId: row.technologyId,
      slug: row.technology.slug,
      dependsOn: row.technology.dependsOn,
      weight: -row.technology.learningOrder,
      // "Built" means a full course, not merely some rows. The seeded
      // JavaScript and Node.js sets are drills that open at closures; calling
      // them built is what produced a course starting in the middle.
      hasContent: row.technology.curriculumVersions.length > 0,
      conceptCount: row.technology._count.concepts,
    }));

    console.log(`\n${user.email}  (${technologies.length} technologies)`);

    if (technologies.length === 0) continue;

    const order = orderTechnologies(technologies);
    const byId = new Map(technologies.map((t) => [t.technologyId, t]));

    console.log('\n  learning order:');
    for (const [index, id] of order.entries()) {
      const technology = byId.get(id);
      const state = technology.hasContent
        ? `built (${technology.conceptCount} concepts)`
        : technology.conceptCount > 0
          ? `starter set only (${technology.conceptCount} concepts) — needs the full course`
          : 'not built';

      console.log(`   ${String(index + 1).padStart(2)}. ${technology.slug.padEnd(22)} ${state}`);
    }

    const built = technologies.filter((t) => t.hasContent);
    const totalConcepts = built.reduce((sum, t) => sum + t.conceptCount, 0);

    const practisedConcepts = await prisma.skill.count({
      where: {
        userId: user.id,
        attempts: { gt: 0 },
        concept: {
          archivedAt: null,
          technologyId: { in: built.map((t) => t.technologyId) },
        },
      },
    });

    const ready = built.length === 0 || shouldGenerateAhead({ totalConcepts, practisedConcepts });
    const target = nextToGenerate(technologies);

    console.log(
      `\n  progress: ${practisedConcepts}/${totalConcepts} concepts practised ` +
        `(threshold ${Math.round(GENERATE_AHEAD_AT * 100)}%)`,
    );

    if (!target) {
      console.log('  next: nothing left to build.');
    } else if (!ready) {
      console.log(
        `  next: ${byId.get(target).slug} — WAITING. Nothing will be generated or ` +
          'billed until progress reaches the threshold.',
      );
    } else {
      console.log(`  next: ${byId.get(target).slug} — would be queued now.`);
    }
  }

  const counts = await prisma.generationJob.groupBy({ by: ['status'], _count: true });
  console.log(`\njobs: ${counts.map((row) => `${row.status}=${row._count}`).join('  ') || 'none'}`);
  console.log('PENDING costs nothing — it is the plan, not the work.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
