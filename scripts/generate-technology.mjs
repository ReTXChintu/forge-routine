/**
 * Generates one technology's curriculum for real, against OpenAI, and prints
 * what came back so its quality can actually be judged.
 *
 *   node scripts/generate-technology.mjs <technology-slug>
 *
 * This spends money. It exists because no amount of testing against the
 * deterministic fake answers the only question that matters: is generated
 * curriculum good enough to learn from?
 */
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, '..');

const { loadConfig } = require(resolve(root, 'packages/config/dist/index.cjs'));
const ai = require(resolve(root, 'packages/ai/dist/index.cjs'));
const sandbox = require(resolve(root, 'packages/sandbox/dist/index.cjs'));
const { PrismaClient } = require('@prisma/client');

const slug = process.argv[2] ?? 'docker';

const config = loadConfig({ cwd: root });
if (!config.aiEnabled) {
  console.error('OPENAI_API_KEY is not set.');
  process.exit(1);
}

const provider = ai.createAIProvider(config);
const prisma = new PrismaClient();

const usage = { promptTokens: 0, completionTokens: 0, calls: 0 };

/** Wraps the provider so the run reports what it actually cost. */
const metered = {
  name: provider.name,
  generate: (r) => provider.generate(r),
  stream: (r) => provider.stream(r),
  embed: (r) => provider.embed(r),
  async structured(request) {
    const started = Date.now();
    const result = await provider.structured(request);
    usage.promptTokens += result.usage.promptTokens;
    usage.completionTokens += result.usage.completionTokens;
    usage.calls += 1;
    console.log(
      `    ← ${request.schemaName} (${Date.now() - started}ms, ` +
        `${result.usage.promptTokens}+${result.usage.completionTokens} tok` +
        `${result.repairAttempts > 0 ? `, ${result.repairAttempts} repair` : ''})`,
    );
    return result;
  },
};

function estimateCost() {
  // gpt-4o pricing, USD per 1M tokens. Indicative only.
  const inputPerM = 2.5;
  const outputPerM = 10;
  return (
    (usage.promptTokens / 1_000_000) * inputPerM + (usage.completionTokens / 1_000_000) * outputPerM
  );
}

async function main() {
  const technology = await prisma.technology.findUnique({ where: { slug } });
  if (!technology) {
    console.error(`No technology with slug "${slug}".`);
    process.exit(1);
  }

  console.log(`\nGenerating curriculum for ${technology.name}\n`);
  const ctx = { userId: 'script' };

  console.log('  [1/4] outline');
  const outline = await ai.outlineAgent.run(
    metered,
    { technologyName: technology.name, technologySlug: technology.slug, existingTechnologies: [] },
    ctx,
  );
  console.log(`        ${outline.concepts.length} concepts:`);
  for (const c of outline.concepts) {
    console.log(`          ${String(c.difficulty)}  ${c.name}`);
    console.log(`             ${c.description}`);
  }

  // Only the first few concepts are expanded: this is a quality probe, not a
  // full run, and each concept costs real money.
  const sample = outline.concepts.slice(0, 3);

  console.log(`\n  [2/4] detail for ${sample.length} sample concepts`);
  const detailed = [];
  for (const concept of sample) {
    const detail = await ai.conceptDetailAgent.run(
      metered,
      {
        technologyName: technology.name,
        conceptName: concept.name,
        conceptDescription: concept.description,
        difficulty: concept.difficulty,
      },
      ctx,
    );
    detailed.push({ ...concept, ...detail });
    console.log(`\n        ${concept.name}`);
    console.log('          objectives:');
    for (const o of detail.learningObjectives) console.log(`            - ${o}`);
    console.log('          common mistakes:');
    for (const m of detail.commonMistakes) console.log(`            - ${m}`);
  }

  console.log('\n  [3/4] prerequisites');
  const edges = await ai.prerequisiteAgent.run(
    metered,
    {
      technologySlug: technology.slug,
      technologyName: technology.name,
      concepts: outline.concepts,
      externalConcepts: [],
    },
    ctx,
  );
  console.log(`        ${edges.edges.length} edges:`);
  for (const e of edges.edges.slice(0, 12)) {
    console.log(
      `          ${e.conceptSlug} ${e.strength === 'HARD' ? '<-' : '<~'} ${e.prerequisiteSlug}`,
    );
  }

  console.log('\n  [4/4] exercises for the first concept, verified in the sandbox');
  const first = detailed[0];
  const generated = await ai.exerciseAgent.run(
    metered,
    {
      technologyName: technology.name,
      conceptName: first.name,
      conceptDescription: first.description,
      difficulty: first.difficulty,
      learningObjectives: first.learningObjectives,
      commonMistakes: first.commonMistakes,
      language: 'javascript',
      existingSlugs: [],
      includeDebugging: true,
    },
    ctx,
  );

  const permissionFlag = await sandbox.detectPermissionFlag();
  const options = {
    workDir: '.sandbox-runs',
    timeoutMs: 10_000,
    maxMemoryMb: 128,
    maxOutputBytes: 16_384,
    permissionFlag,
  };

  for (const exercise of generated.exercises) {
    console.log(`\n        ${exercise.kind}  ${exercise.title}`);
    console.log(`          objective: ${exercise.objective}`);
    console.log(`          hints:`);
    for (const h of exercise.staticHints) console.log(`            - ${h}`);
    console.log(`          ${exercise.testCases.length} test cases`);

    const result = await sandbox.runInSandbox(
      {
        code: exercise.referenceSolution,
        language: 'javascript',
        testCases: exercise.testCases.map((t) => ({
          name: t.name,
          hidden: t.hidden,
          code: t.code,
        })),
      },
      options,
    );

    const verdict =
      result.status === 'PASSED'
        ? `ACCEPTED (${result.testsPassed}/${result.testsTotal})`
        : `REJECTED (${result.status}, ${result.testsPassed}/${result.testsTotal})`;
    console.log(`          sandbox verdict: ${verdict}`);

    for (const c of result.cases.filter((c) => !c.passed)) {
      console.log(`            failed: ${c.name} — ${c.error ?? ''}`);
    }
  }

  console.log(
    `\n  cost: ${usage.calls} calls, ${usage.promptTokens} in + ${usage.completionTokens} out` +
      ` ≈ $${estimateCost().toFixed(3)}\n`,
  );
}

main()
  .catch((error) => {
    console.error('\nFAILED:', error?.message ?? error);
    console.error(`  spent so far ≈ $${estimateCost().toFixed(3)}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
