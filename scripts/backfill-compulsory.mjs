/**
 * Adds the compulsory technologies to accounts that predate them.
 *
 *   node scripts/backfill-compulsory.mjs
 *
 * Onboarding adds DSA for every new user. Anyone who signed up before that
 * existed has no DSA row, and nothing would ever create one — their daily
 * plan would silently be missing the part that is supposed to be
 * non-negotiable.
 *
 * Skips users who archived it. Removing it was a decision, and a backfill
 * that overrides decisions is a backfill nobody can trust.
 */
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(resolve(import.meta.dirname, '../apps/api/index.js'));
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const COMPULSORY_SLUGS = ['dsa'];

async function main() {
  for (const slug of COMPULSORY_SLUGS) {
    const technology = await prisma.technology.findUnique({
      where: { slug },
      select: { id: true, name: true },
    });

    if (!technology) {
      console.log(`${slug}: not in the catalogue — run pnpm db:seed first`);
      continue;
    }

    const users = await prisma.user.findMany({ select: { id: true, email: true } });
    let added = 0;

    for (const user of users) {
      const existing = await prisma.userTechnology.findUnique({
        where: { userId_technologyId: { userId: user.id, technologyId: technology.id } },
        select: { id: true, status: true },
      });

      if (existing) {
        console.log(`  ·  ${user.email} already has ${slug} (${existing.status.toLowerCase()})`);
        continue;
      }

      await prisma.userTechnology.create({
        data: {
          userId: user.id,
          technologyId: technology.id,
          priority: 'HIGH',
          targetProficiency: 'PROFICIENT',
          interviewImportance: 5,
          frequency: 'DAILY',
          existingKnowledge: 0,
          status: 'ACTIVE',
        },
      });

      console.log(`  ✓  ${user.email} — added ${technology.name}`);
      added += 1;
    }

    console.log(`\n${slug}: ${added} added, ${users.length - added} already had it`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
