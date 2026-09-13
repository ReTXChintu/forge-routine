/**
 * Pushes the hand-authored learning order into the database.
 *
 *   node scripts/sync-technology-order.mjs
 *
 * `learningOrder` and `dependsOn` live in the catalogue but are read from the
 * `Technology` table at runtime, so changing the catalogue alone changes
 * nothing until the rows are updated.
 *
 * A narrower operation than `pnpm db:seed`, on purpose: the full seed also
 * re-imports every curated curriculum and challenge, which is a lot of
 * writing to do to a live database when the only thing that changed is two
 * columns.
 */
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(resolve(import.meta.dirname, '../apps/api/index.js'));
const root = resolve(import.meta.dirname, '..');

const { PrismaClient } = require('@prisma/client');
const { TECHNOLOGY_CATALOGUE, assertAcyclicTechnologies } = require(
  resolve(root, 'packages/curriculum/dist/index.cjs'),
);

const prisma = new PrismaClient();

async function main() {
  // A cycle here would leave some technology permanently ungeneratable, with
  // nothing in the logs to say why. Refuse before writing anything.
  assertAcyclicTechnologies(
    TECHNOLOGY_CATALOGUE.map((technology) => ({
      slug: technology.slug,
      dependsOn: technology.dependsOn ?? [],
    })),
  );

  const existing = await prisma.technology.findMany({
    select: { slug: true, name: true, learningOrder: true, dependsOn: true },
  });
  const before = new Map(existing.map((row) => [row.slug, row]));

  const ordered = [...TECHNOLOGY_CATALOGUE].sort(
    (a, b) => (a.learningOrder ?? 500) - (b.learningOrder ?? 500),
  );

  let changed = 0;
  let missing = 0;

  for (const technology of ordered) {
    const current = before.get(technology.slug);
    const learningOrder = technology.learningOrder ?? 500;
    const dependsOn = technology.dependsOn ?? [];

    if (!current) {
      // Seeded rows only. Creating one here would give it a name and a rank
      // but no concepts, which reads as a built course that teaches nothing.
      console.log(`  ?  ${technology.slug} — not in the database, run pnpm db:seed`);
      missing += 1;
      continue;
    }

    const sameOrder = current.learningOrder === learningOrder;
    const sameDeps =
      current.dependsOn.length === dependsOn.length &&
      current.dependsOn.every((slug, index) => slug === dependsOn[index]);

    if (sameOrder && sameDeps) {
      console.log(`  ·  ${String(learningOrder).padStart(2)}  ${technology.name}`);
      continue;
    }

    await prisma.technology.update({
      where: { slug: technology.slug },
      data: { learningOrder, dependsOn },
    });

    console.log(
      `  ✓  ${String(learningOrder).padStart(2)}  ${technology.name}` +
        (sameOrder ? '  (dependsOn)' : `  (was ${current.learningOrder})`),
    );
    changed += 1;
  }

  console.log(`\n${changed} updated, ${ordered.length - changed - missing} already correct`);
  if (missing > 0) console.log(`${missing} missing from the database`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
