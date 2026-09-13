/**
 * Seeds the technology catalogue and the curated curricula.
 *
 * Idempotent: safe to run repeatedly against an existing database. Concepts are
 * upserted by slug so a user's skill history — which is keyed on concept ids —
 * survives every reseed.
 */
import { PrismaClient, type Prisma } from '@prisma/client';

import {
  SEED_CHALLENGES,
  TECHNOLOGY_CATALOGUE,
  assertAcyclic,
  getCuratedCurricula,
  seedTechnologySchema,
  type GraphEdge,
  type GraphNode,
  type SeedChallenge,
  type SeedTechnology,
} from '@forgeroutine/curriculum';

const prisma = new PrismaClient();

const GENERATOR_VERSION = 'seed-1';

async function main(): Promise<void> {
  console.info('Seeding ForgeRoutine…\n');

  // 1. Catalogue rows for every §41 technology, so a user can add any of them.
  for (const technology of TECHNOLOGY_CATALOGUE) {
    await prisma.technology.upsert({
      where: { slug: technology.slug },
      create: {
        slug: technology.slug,
        name: technology.name,
        description: technology.description ?? '',
        category: technology.category ?? 'general',
        exerciseLanguage: technology.exerciseLanguage ?? null,
      },
      update: {
        name: technology.name,
        description: technology.description ?? '',
        category: technology.category ?? 'general',
        exerciseLanguage: technology.exerciseLanguage ?? null,
      },
    });
  }
  console.info(`  ${TECHNOLOGY_CATALOGUE.length} technologies in the catalogue`);

  // 2. Curated concept graphs and exercises.
  // JavaScript imports before Node.js so the cross-technology prerequisites in
  // the Node curriculum resolve rather than being skipped.
  const curricula = getCuratedCurricula();

  for (const curriculum of curricula) {
    await prisma.$transaction((tx) => importTechnology(tx, curriculum), { timeout: 60_000 });
  }

  await verifyGraph();

  // 3. Phase 9 challenges. After the curricula, because each one attaches to
  // a concept that must already exist.
  await seedChallenges();

  const [technologies, concepts, exercises, testCases, challenges] = await Promise.all([
    prisma.technology.count(),
    prisma.concept.count(),
    prisma.exercise.count(),
    prisma.exerciseTestCase.count(),
    prisma.exercise.count({ where: { kind: { in: ['SYSTEM_DESIGN', 'INCIDENT', 'TERMINAL'] } } }),
  ]);

  console.info('\nSeed complete.');
  console.info(`  technologies: ${technologies}`);
  console.info(`  concepts:     ${concepts}`);
  console.info(`  exercises:    ${exercises}`);
  console.info(`  test cases:   ${testCases}`);
  console.info(`  challenges:   ${challenges}`);
}

async function importTechnology(
  tx: Prisma.TransactionClient,
  input: SeedTechnology,
): Promise<void> {
  const seed = seedTechnologySchema.parse(input);

  const technology = await tx.technology.upsert({
    where: { slug: seed.slug },
    create: {
      slug: seed.slug,
      name: seed.name,
      description: seed.description,
      category: seed.category,
      curatedCurriculum: true,
    },
    update: { curatedCurriculum: true },
  });

  const latest = await tx.curriculumVersion.findFirst({
    where: { technologyId: technology.id },
    orderBy: { version: 'desc' },
    select: { version: true },
  });

  const curriculumVersion = await tx.curriculumVersion.create({
    data: {
      technologyId: technology.id,
      version: (latest?.version ?? 0) + 1,
      generatorVersion: GENERATOR_VERSION,
      status: 'GENERATING',
      conceptCount: seed.concepts.length,
    },
  });

  const conceptIds = new Map<string, string>();

  for (const [index, concept] of seed.concepts.entries()) {
    const row = await tx.concept.upsert({
      where: { technologyId_slug: { technologyId: technology.id, slug: concept.slug } },
      create: {
        technologyId: technology.id,
        curriculumVersionId: curriculumVersion.id,
        slug: concept.slug,
        name: concept.name,
        description: concept.description,
        difficulty: concept.difficulty,
        orderIndex: index,
        learningObjectives: concept.learningObjectives,
        codingPatterns: concept.codingPatterns,
        commonMistakes: concept.commonMistakes,
      },
      update: {
        curriculumVersionId: curriculumVersion.id,
        name: concept.name,
        description: concept.description,
        difficulty: concept.difficulty,
        orderIndex: index,
        learningObjectives: concept.learningObjectives,
        codingPatterns: concept.codingPatterns,
        commonMistakes: concept.commonMistakes,
        archivedAt: null,
      },
    });
    conceptIds.set(concept.slug, row.id);
  }

  for (const concept of seed.concepts) {
    const conceptId = conceptIds.get(concept.slug);
    if (!conceptId) continue;

    for (const prereq of concept.prerequisites) {
      const prerequisiteId = prereq.slug.includes(':')
        ? await resolveExternal(tx, prereq.slug)
        : conceptIds.get(prereq.slug);

      if (!prerequisiteId) {
        console.warn(`  ! unresolved prerequisite ${prereq.slug} for ${concept.slug}`);
        continue;
      }

      await tx.conceptPrerequisite.upsert({
        where: { conceptId_prerequisiteId: { conceptId, prerequisiteId } },
        create: { conceptId, prerequisiteId, strength: prereq.strength },
        update: { strength: prereq.strength },
      });
    }

    for (const exercise of concept.exercises) {
      const row = await tx.exercise.upsert({
        where: { conceptId_slug: { conceptId, slug: exercise.slug } },
        create: {
          conceptId,
          slug: exercise.slug,
          title: exercise.title,
          kind: exercise.kind,
          difficulty: exercise.difficulty,
          language: exercise.language,
          objective: exercise.objective,
          requirements: exercise.requirements,
          functionSignature: exercise.functionSignature,
          starterCode: exercise.starterCode,
          examples: exercise.examples,
          staticHints: exercise.staticHints,
          referenceSolution: exercise.referenceSolution,
          brokenCode: exercise.brokenCode,
          bugExplanation: exercise.bugExplanation,
          estimatedMinutes: exercise.estimatedMinutes,
        },
        update: {
          title: exercise.title,
          objective: exercise.objective,
          requirements: exercise.requirements,
          functionSignature: exercise.functionSignature,
          starterCode: exercise.starterCode,
          examples: exercise.examples,
          staticHints: exercise.staticHints,
          referenceSolution: exercise.referenceSolution,
          brokenCode: exercise.brokenCode,
          bugExplanation: exercise.bugExplanation,
          estimatedMinutes: exercise.estimatedMinutes,
          archivedAt: null,
        },
      });

      // Replaced wholesale: test cases have no stable identity, and a stale case
      // would silently mis-grade every future submission.
      await tx.exerciseTestCase.deleteMany({ where: { exerciseId: row.id } });
      await tx.exerciseTestCase.createMany({
        data: exercise.testCases.map((testCase, index) => ({
          exerciseId: row.id,
          name: testCase.name,
          hidden: testCase.hidden,
          orderIndex: index,
          code: testCase.code,
        })),
      });
    }
  }

  await tx.curriculumVersion.updateMany({
    where: { technologyId: technology.id, status: 'ACTIVE' },
    data: { status: 'SUPERSEDED' },
  });
  await tx.curriculumVersion.update({
    where: { id: curriculumVersion.id },
    data: { status: 'ACTIVE' },
  });

  console.info(`  ${seed.slug}: ${seed.concepts.length} concepts`);
}

async function resolveExternal(
  tx: Prisma.TransactionClient,
  qualified: string,
): Promise<string | undefined> {
  const [technologySlug, conceptSlug] = qualified.split(':');
  if (!technologySlug || !conceptSlug) return undefined;

  const concept = await tx.concept.findFirst({
    where: { slug: conceptSlug, technology: { slug: technologySlug } },
    select: { id: true },
  });
  return concept?.id;
}

/** A cycle in the stored graph would make the routine planner non-terminating. */
async function verifyGraph(): Promise<void> {
  const [concepts, edges] = await Promise.all([
    prisma.concept.findMany({ select: { id: true, name: true, technologyId: true } }),
    prisma.conceptPrerequisite.findMany({
      select: { conceptId: true, prerequisiteId: true, strength: true },
    }),
  ]);

  const nodes: GraphNode[] = concepts;
  const graphEdges: GraphEdge[] = edges.map((e) => ({
    conceptId: e.conceptId,
    prerequisiteId: e.prerequisiteId,
    strength: e.strength as 'HARD' | 'SOFT',
  }));

  assertAcyclic(nodes, graphEdges);
  console.info(`  graph verified acyclic: ${nodes.length} nodes, ${graphEdges.length} edges`);
}

main()
  .catch((error) => {
    console.error('\nSeed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });

/**
 * Attaches Phase 9 challenges to concepts.
 *
 * A challenge names the concept it belongs on, but most technologies here
 * have AI-generated curricula whose concept slugs are not known in advance.
 * So: exact slug first, then a keyword match on the slug, then the
 * technology's first concept. The fallback is deliberate — a system design
 * hanging off a slightly wrong concept is still worth doing, whereas silently
 * seeding nothing leaves the whole feature looking broken.
 *
 * A technology with no concepts at all is skipped and reported, because that
 * means its curriculum has not been generated yet.
 */
async function seedChallenges(): Promise<void> {
  let attached = 0;
  const skipped: string[] = [];

  for (const challenge of SEED_CHALLENGES) {
    const conceptId = await resolveConcept(challenge);

    if (!conceptId) {
      skipped.push(challenge.slug);
      continue;
    }

    await prisma.exercise.upsert({
      where: { conceptId_slug: { conceptId, slug: challenge.slug } },
      create: {
        conceptId,
        slug: challenge.slug,
        title: challenge.title,
        kind: challenge.spec.kind,
        difficulty: challenge.difficulty,
        // Not JavaScript: none of these is graded by running the user's code.
        language: 'text',
        objective: challenge.objective,
        requirements: '',
        estimatedMinutes: challenge.estimatedMinutes,
        challengeSpec: challenge.spec as unknown as Prisma.InputJsonValue,
      },
      update: {
        title: challenge.title,
        kind: challenge.spec.kind,
        difficulty: challenge.difficulty,
        objective: challenge.objective,
        estimatedMinutes: challenge.estimatedMinutes,
        challengeSpec: challenge.spec as unknown as Prisma.InputJsonValue,
        archivedAt: null,
      },
    });

    attached += 1;
  }

  console.info(`  ${attached} Phase 9 challenges attached`);
  if (skipped.length > 0) {
    console.info(
      `  ${skipped.length} skipped (no curriculum yet): ${skipped.join(', ')}`,
    );
  }
}

async function resolveConcept(challenge: SeedChallenge): Promise<string | null> {
  const technology = await prisma.technology.findUnique({
    where: { slug: challenge.technologySlug },
    select: { id: true },
  });
  if (!technology) return null;

  const exact = await prisma.concept.findUnique({
    where: { technologyId_slug: { technologyId: technology.id, slug: challenge.conceptSlug } },
    select: { id: true },
  });
  if (exact) return exact.id;

  // The generated curriculum will have named this differently. Match on the
  // most distinctive word in the intended slug before giving up on placement.
  const keyword = challenge.conceptSlug
    .split('-')
    .sort((a, b) => b.length - a.length)[0];

  if (keyword && keyword.length > 3) {
    const near = await prisma.concept.findFirst({
      where: {
        technologyId: technology.id,
        archivedAt: null,
        slug: { contains: keyword, mode: 'insensitive' },
      },
      select: { id: true },
    });
    if (near) return near.id;
  }

  const first = await prisma.concept.findFirst({
    where: { technologyId: technology.id, archivedAt: null },
    orderBy: { orderIndex: 'asc' },
    select: { id: true },
  });

  return first?.id ?? null;
}
