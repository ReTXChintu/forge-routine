/**
 * Empties every table and re-runs the seed.
 *
 *   pnpm db:reset -- --yes
 *
 * Destructive and irreversible. It exists because "start fresh" is a real
 * recurring need in development, and the alternative — improvising a DELETE
 * at a prompt — is how this project's database got wiped by accident once
 * already (see database.md).
 *
 * Two guards, both deliberate:
 *
 *   1. `--yes` is required. There is no interactive confirmation, because a
 *      prompt trains you to hit return.
 *   2. It refuses outright if any account does not look like a test account,
 *      unless `--force-real-users` is also passed. The wipe that hurt was not
 *      a typo in the SQL; it was running a destructive command against the
 *      wrong database. This makes that failure loud rather than silent.
 *
 * `_prisma_migrations` is preserved: the schema is not being rebuilt, only
 * emptied, so the migration history must stay consistent with it.
 */
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(resolve(import.meta.dirname, '../apps/api/index.js'));
const { PrismaClient } = require('@prisma/client');

const args = new Set(process.argv.slice(2));
const confirmed = args.has('--yes');
const allowRealUsers = args.has('--force-real-users');

/** Anything not matching this is treated as a real account. */
const TEST_ACCOUNT = /@forgeroutine\.test$/;

const prisma = new PrismaClient();

async function main() {
  const url = process.env.DATABASE_URL ?? '';
  const host = url.replace(/^[^@]*@/, '').split('/')[0] ?? 'unknown host';
  const database = url.split('/').pop()?.split('?')[0] ?? 'unknown database';

  console.log(`\nTarget: ${database} at ${host}`);

  const users = await prisma.user.findMany({ select: { email: true } });
  const real = users.filter((user) => !TEST_ACCOUNT.test(user.email));

  console.log(`  ${users.length} accounts, ${real.length} of which look real`);

  if (real.length > 0 && !allowRealUsers) {
    console.error(
      `\nRefusing: ${real.length} account(s) do not end in @forgeroutine.test.\n` +
        real.map((user) => `  ${user.email}`).join('\n') +
        '\n\nIf this is genuinely the right database, pass --force-real-users.',
    );
    process.exitCode = 1;
    return;
  }

  if (!confirmed) {
    console.error('\nRefusing: pass --yes to actually empty it.');
    process.exitCode = 1;
    return;
  }

  // Every table Prisma manages, read from the catalogue rather than listed
  // here — a hand-maintained list silently misses whatever was added last.
  const tables = await prisma.$queryRaw`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename <> '_prisma_migrations'
  `;

  const names = tables.map((row) => `"public"."${row.tablename}"`);

  if (names.length === 0) {
    console.error('\nNo tables found. Has the migration been applied?');
    process.exitCode = 1;
    return;
  }

  console.log(`\nTruncating ${names.length} tables…`);

  // One statement so foreign keys never see an inconsistent intermediate
  // state. CASCADE follows references; RESTART IDENTITY resets sequences so
  // a fresh database really does start from the beginning.
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${names.join(', ')} RESTART IDENTITY CASCADE`,
  );

  const remaining = await prisma.user.count();
  console.log(`  done — ${remaining} accounts remain`);
  console.log('\nNow run: pnpm --filter @forgeroutine/database seed');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
