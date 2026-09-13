/**
 * Runs one real interview end to end against OpenAI and prints the transcript
 * and the debrief.
 *
 *   node scripts/interview-live.mjs [mode] [targetLevel]
 *
 * This spends money. It exists because the only question that matters about
 * an adaptive interviewer is whether the next question actually responds to
 * the last answer, and nothing offline can answer that — the deterministic
 * fake returns whatever it was handed.
 *
 * The answers below are deliberately mixed: one strong, one vague, one wrong.
 * A working engine should visibly change direction after each.
 */
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(resolve(import.meta.dirname, '../apps/api/index.js'));
const root = resolve(import.meta.dirname, '..');

const { NestFactory } = require('@nestjs/core');
const { AppModule } = require(resolve(root, 'apps/api/dist/app.module.js'));
const { InterviewsService } = require(
  resolve(root, 'apps/api/dist/modules/interviews/application/interviews.service.js'),
);
const { InterviewGuideService } = require(
  resolve(root, 'apps/api/dist/modules/interviews/application/interview-guide.service.js'),
);
const { PrismaClient } = require('@prisma/client');

const mode = process.argv[2] ?? 'QUICK';
const targetLevel = process.argv[3] ?? 'MID';

const EMAIL = 'interview-live@forgeroutine.test';

/** Cycled through, so the grader sees a range rather than one register. */
const ANSWERS = [
  'It keeps a reference to the variables in the scope where it was defined, so those stay alive after the outer function returns. The classic bug is a loop with var, where every closure ends up sharing one binding.',
  'I think it handles it automatically, mostly. It just works out what to do.',
  'You would use it when you need to share state between calls without putting it on a global. The trade-off is memory: the captured scope cannot be collected while the closure is alive, so holding one in a long-lived cache can pin a large object by accident.',
  'Honestly I am not sure. I have not had to reason about that directly.',
];

async function main() {
  const prisma = new PrismaClient();
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });

  const interviews = app.get(InterviewsService);
  const guide = app.get(InterviewGuideService);

  const userId = await seedPractisedUser(prisma);

  console.log(`\nUser ${userId}`);
  console.log(`Mode ${mode}, target ${targetLevel}\n`);

  // -- Guide before ---------------------------------------------------------

  const before = await guide.build(userId);
  console.log('Guide before:');
  console.log(
    `  overall readiness: ${
      before.overallReadiness === null
        ? 'null (not enough practised)'
        : before.overallReadiness.toFixed(2)
    }`,
  );
  for (const priority of before.priorities.slice(0, 3)) {
    console.log(`  · ${priority.title} — ${priority.reason}`);
  }

  // -- Interview ------------------------------------------------------------

  console.log('\nInterview:\n');
  let view = await interviews.start(userId, mode, targetLevel);

  let turn = 0;
  while (view.currentQuestion && turn < 12) {
    const question = view.currentQuestion;
    const answer = ANSWERS[turn % ANSWERS.length];

    console.log(`  Q${turn + 1}: ${question.prompt}`);
    console.log(`  A${turn + 1}: ${answer.slice(0, 90)}…\n`);

    view = await interviews.answer(userId, question.id, answer);
    turn += 1;
  }

  // -- Debrief --------------------------------------------------------------

  const report = await interviews.end(userId, view.id);

  console.log('Debrief:');
  console.log(`  overall: ${report.overallScore?.toFixed(2) ?? 'null'}`);
  console.log(`  degraded: ${report.degraded}`);
  for (const [dimension, value] of Object.entries(report.dimensions)) {
    console.log(`  ${dimension.padEnd(22)} ${value === null ? 'not tested' : value.toFixed(2)}`);
  }
  console.log(`\n  ${report.summary ?? '(no written summary)'}\n`);
  for (const area of report.weakAreas) console.log(`  weak: ${area}`);
  for (const area of report.strongAreas) console.log(`  strong: ${area}`);
  console.log(`  study next: ${report.recommendedTopics.join(', ')}`);

  // -- Did the interview move the skill model? ------------------------------

  const after = await guide.build(userId);
  console.log(
    `\nGuide after: overall readiness ${
      after.overallReadiness === null ? 'null' : after.overallReadiness.toFixed(2)
    }, ${after.interviewsTaken} interview(s) on record`,
  );

  await app.close();
  await prisma.$disconnect();
}

/**
 * An interview needs practised concepts, because interviewing someone on
 * material they have never studied measures nothing. This fabricates the
 * minimum evidence for that precondition and nothing more.
 */
async function seedPractisedUser(prisma) {
  const user = await prisma.user.upsert({
    where: { email: EMAIL },
    create: {
      email: EMAIL,
      passwordHash: 'not-a-real-login',
      displayName: 'Interview Live Test',
    },
    update: {},
  });

  // Any technology that actually has concepts.
  const technology = await prisma.technology.findFirst({
    where: { concepts: { some: { archivedAt: null } } },
    include: { concepts: { where: { archivedAt: null }, take: 6, orderBy: { orderIndex: 'asc' } } },
  });

  if (!technology) throw new Error('No technology has concepts. Generate curriculum first.');

  await prisma.userTechnology.upsert({
    where: { userId_technologyId: { userId: user.id, technologyId: technology.id } },
    create: {
      userId: user.id,
      technologyId: technology.id,
      interviewImportance: 5,
    },
    update: { interviewImportance: 5, status: 'ACTIVE', archivedAt: null },
  });

  // A spread of mastery, so the selector has both strong and weak to work with.
  const levels = [0.85, 0.3, 0.6, 0.15, 0.75, 0.45];

  for (const [index, concept] of technology.concepts.entries()) {
    const mastery = levels[index % levels.length];
    await prisma.skill.upsert({
      where: { userId_conceptId: { userId: user.id, conceptId: concept.id } },
      create: {
        userId: user.id,
        conceptId: concept.id,
        attempts: 3,
        conceptMastery: mastery,
        codingAbility: mastery,
        explanationAbility: Math.max(0, mastery - 0.15),
        recallStrength: mastery,
        lastPracticedAt: new Date(),
      },
      update: { attempts: 3, conceptMastery: mastery },
    });
  }

  console.log(`Seeded ${technology.concepts.length} practised concepts in ${technology.name}`);

  return user.id;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
