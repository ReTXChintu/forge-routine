/**
 * Exercises the Phase 9 challenge path end to end against the live database.
 *
 *   node scripts/challenges-live.mjs
 *
 * The terminal half is free and deterministic. The written half calls OpenAI
 * once, because the only question that matters about a design reviewer is
 * whether it names real gaps instead of praising whatever it is shown — and
 * nothing offline can answer that.
 */
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(resolve(import.meta.dirname, '../apps/api/index.js'));
const root = resolve(import.meta.dirname, '..');

const { NestFactory } = require('@nestjs/core');
const { AppModule } = require(resolve(root, 'apps/api/dist/app.module.js'));
const { ChallengesService } = require(
  resolve(root, 'apps/api/dist/modules/challenges/application/challenges.service.js'),
);
const { PrismaClient } = require('@prisma/client');

const EMAIL = 'challenges-live@forgeroutine.test';

/** Deliberately shallow: a review that calls this complete is not a review. */
const THIN_DESIGN = `I would accept the upload in an Express route and read the file with fs.readFileSync, then split on newlines and insert each row with a prepared statement. If a row fails I would log it. For retries the client can just upload again.`;

async function main() {
  const prisma = new PrismaClient();
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  const challenges = app.get(ChallengesService);

  const userId = await seedUser(prisma);

  const list = await challenges.list(userId);
  console.log(`\n${list.length} challenges visible:\n`);
  for (const challenge of list) {
    console.log(
      `  [${challenge.kind.padEnd(13)}] ${challenge.title}  (${challenge.technologyName})`,
    );
  }

  // -- Terminal, the free and deterministic half ---------------------------

  const terminal = list.find((c) => c.kind === 'TERMINAL');
  if (terminal) {
    console.log(`\n--- ${terminal.title} ---`);

    const view = await challenges.get(userId, terminal.exerciseId);
    console.log('  goals shown up front:');
    for (const goal of view.brief.terminal?.goals ?? []) console.log(`    · ${goal}`);

    const wrong = await challenges.runTerminal(terminal.exerciseId, ['ls -la']);
    console.log(`\n  doing nothing useful: passed=${wrong.passed}`);

    const started = await challenges.start(userId, terminal.exerciseId);
    const right = await challenges.submitTerminal(userId, started.attemptId, [
      'chmod 600 .ssh/id_deploy',
      'chmod 700 .ssh',
    ]);
    console.log(`  solving it:           passed=${right.passed}`);
    for (const check of right.checks) {
      console.log(`    ${check.passed ? 'PASS' : 'FAIL'}  ${check.description}`);
    }
  }

  // -- A written challenge, which costs a model call -----------------------

  const design = list.find((c) => c.kind === 'SYSTEM_DESIGN');
  if (design) {
    console.log(`\n--- ${design.title} ---`);

    const started = await challenges.start(userId, design.exerciseId);
    console.log(`  brief withholds expectedTopics: ${!('expectedTopics' in started.brief)}`);

    const review = await challenges.submitWritten(userId, started.attemptId, THIN_DESIGN);

    console.log(`\n  passed: ${review.passed}`);
    for (const [dimension, value] of Object.entries(review.scores)) {
      console.log(
        `  ${dimension.padEnd(26)} ${value === null ? 'not addressed' : value.toFixed(2)}`,
      );
    }
    console.log(`\n  ${review.summary}\n`);
    for (const issue of review.issues) {
      console.log(`  [${issue.severity}] ${issue.title}`);
      console.log(`      ${issue.explanation.slice(0, 160)}`);
    }
    console.log('\n  follow-ups:');
    for (const question of review.followUpQuestions) console.log(`    · ${question}`);

    // The rule that matters: a review must not hand over the architecture.
    const handedOver = review.issues.some((issue) => issue.explanation.includes('```'));
    console.log(`\n  contains a code block (must be false): ${handedOver}`);
  }

  await app.close();
  await prisma.$disconnect();
}

async function seedUser(prisma) {
  const user = await prisma.user.upsert({
    where: { email: EMAIL },
    create: { email: EMAIL, passwordHash: 'not-a-real-login', displayName: 'Challenges Live' },
    update: {},
  });

  // Challenges are listed for technologies the user has taken on, so the
  // scoping in `list` is exercised rather than bypassed.
  const technologies = await prisma.technology.findMany({
    where: { slug: { in: ['nodejs', 'javascript', 'linux'] } },
    select: { id: true },
  });

  for (const technology of technologies) {
    await prisma.userTechnology.upsert({
      where: { userId_technologyId: { userId: user.id, technologyId: technology.id } },
      create: { userId: user.id, technologyId: technology.id },
      update: { archivedAt: null, status: 'ACTIVE' },
    });
  }

  // Attempts are reused when open, so a rerun would otherwise grade against
  // the first run's attempt and never exercise `start`.
  await prisma.exerciseAttempt.deleteMany({ where: { userId: user.id } });

  return user.id;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
