/**
 * Runs one technology through the real generation pipeline — the same code
 * path onboarding uses — and prints what landed in the database.
 *
 *   node scripts/generate-live.mjs <technology-slug>
 *
 * This spends money. It exists because the only question that matters about
 * generated curriculum is whether it is good enough to learn from, and no
 * amount of testing against the deterministic fake answers it.
 */
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, '..');

const { NestFactory } = require('@nestjs/core');
const { AppModule } = require(resolve(root, 'apps/api/dist/app.module.js'));
const {
  CurriculumGeneratorService,
} = require(resolve(root, 'apps/api/dist/modules/generation/application/curriculum-generator.service.js'));
const { PrismaClient } = require('@prisma/client');

const slug = process.argv[2] ?? 'docker';
const prisma = new PrismaClient();

async function main() {
  const technology = await prisma.technology.findUnique({ where: { slug } });
  if (!technology) throw new Error(`No technology with slug "${slug}"`);

  console.log(`\n${technology.name}  (exerciseLanguage: ${technology.exerciseLanguage ?? 'null → concept questions'})\n`);

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  const generator = app.get(CurriculumGeneratorService);

  const started = Date.now();
  const outcome = await generator.generateForTechnology(technology.id, 'script', (step, pct) => {
    console.log(`  ${String(pct).padStart(3)}%  ${step}`);
  });

  console.log(
    `\n  done in ${Math.round((Date.now() - started) / 1000)}s — ` +
      `${outcome.conceptsCreated} concepts, ${outcome.edgesCreated} edges, ` +
      `${outcome.exercisesCreated} exercises, ${outcome.questionsCreated} questions, ` +
      `${outcome.exercisesRejected} rejected\n`,
  );

  // Read it back from the database: what was persisted is what matters.
  const concepts = await prisma.concept.findMany({
    where: { technologyId: technology.id, archivedAt: null },
    include: {
      questions: true,
      exercises: { include: { testCases: true } },
      prerequisites: { include: { prerequisite: { select: { name: true } } } },
    },
    orderBy: { orderIndex: 'asc' },
  });

  for (const concept of concepts) {
    const needs = concept.prerequisites.map((p) => p.prerequisite.name).join(', ');
    console.log(`  ${concept.orderIndex + 1}. ${concept.name}  (difficulty ${concept.difficulty})`);
    if (needs) console.log(`       after: ${needs}`);
    if (concept.commonMistakes.length > 0) {
      console.log(`       mistake: ${concept.commonMistakes[0]}`);
    }
    for (const exercise of concept.exercises) {
      console.log(`       [${exercise.kind}] ${exercise.title} — ${exercise.testCases.length} tests`);
    }
    for (const question of concept.questions.slice(0, 1)) {
      console.log(`       Q: ${question.prompt}`);
      question.options.forEach((option, index) => {
        console.log(`          ${index === question.correctIndex ? '✓' : ' '} ${option}`);
      });
      console.log(`          why: ${question.explanation.slice(0, 110)}`);
    }
  }

  await app.close();
}

main()
  .catch((error) => {
    console.error('\nFAILED:', error?.message ?? error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
