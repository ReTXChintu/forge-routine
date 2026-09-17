/**
 * Deletes user accounts, keeping the ones named.
 *
 *   node scripts/purge-users.mjs --keep you@example.com          # dry run
 *   node scripts/purge-users.mjs --keep you@example.com --yes    # do it
 *
 * The e2e suites register a fresh account per run and only the newest one
 * cleans up after itself, so `*@forgeroutine.test` rows accumulate in
 * whatever database the tests were pointed at. This removes them.
 *
 * Dry by default. A script that deletes accounts on being run with no
 * arguments is one nobody should have written.
 *
 * Cascades take attempts, submissions, skills, routines and interviews with
 * each user. `AIInteraction.userId` is SetNull rather than Cascade, so the
 * cost telemetry survives the accounts it came from — which is the point of
 * keeping it separately.
 */
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(resolve(import.meta.dirname, '../apps/api/index.js'));
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const args = process.argv.slice(2);
const confirmed = args.includes('--yes');

/** Every `--keep <email>`. Matched exactly, case-insensitively. */
const keep = args
  .flatMap((arg, index) => (arg === '--keep' ? [args[index + 1]] : []))
  .filter((email) => typeof email === 'string' && email.length > 0)
  .map((email) => email.toLowerCase());

async function main() {
  if (keep.length === 0) {
    // Refusing rather than defaulting to "keep nothing". The obvious typo
    // here — forgetting the flag — would otherwise empty the table.
    console.error('Refusing to run with no --keep. Name at least one account to keep.');
    process.exitCode = 1;
    return;
  }

  const users = await prisma.user.findMany({
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      email: true,
      createdAt: true,
      _count: { select: { attempts: true, submissions: true, interviews: true } },
    },
  });

  const kept = users.filter((user) => keep.includes(user.email.toLowerCase()));
  const doomed = users.filter((user) => !keep.includes(user.email.toLowerCase()));

  for (const email of keep) {
    if (!kept.some((user) => user.email.toLowerCase() === email)) {
      // A misspelled address means the account meant to be saved is in the
      // delete list. Stop rather than find out afterwards.
      console.error(`Refusing to run: "${email}" was named with --keep but does not exist.`);
      process.exitCode = 1;
      return;
    }
  }

  console.log(`keeping ${kept.length}: ${kept.map((user) => user.email).join(', ')}`);
  console.log(`deleting ${doomed.length}:`);

  for (const user of doomed) {
    const work = user._count.attempts + user._count.submissions + user._count.interviews;
    console.log(
      `  ${user.email.padEnd(46)} ${user.createdAt.toISOString().slice(0, 16)}` +
        (work > 0 ? `  ${work} pieces of work` : '  no work recorded'),
    );
  }

  if (doomed.length === 0) {
    console.log('\nnothing to do');
    return;
  }

  if (!confirmed) {
    const withWork = doomed.filter(
      (user) => user._count.attempts + user._count.submissions + user._count.interviews > 0,
    );
    if (withWork.length > 0) {
      console.log(`\n${withWork.length} of these have recorded work that will go with them.`);
    }
    console.log('\nDry run. Add --yes to delete.');
    return;
  }

  const aiBefore = await prisma.aIInteraction.count();

  const { count } = await prisma.user.deleteMany({
    where: { id: { in: doomed.map((user) => user.id) } },
  });

  const aiAfter = await prisma.aIInteraction.count();

  console.log(`\ndeleted ${count} account(s)`);
  console.log(`AI telemetry rows: ${aiBefore} before, ${aiAfter} after (SetNull, not cascade)`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
