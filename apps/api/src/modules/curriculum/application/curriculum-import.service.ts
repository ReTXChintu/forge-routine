import { Injectable, Logger } from '@nestjs/common';

import {
  type SeedTechnology,
  assertAcyclic,
  type GraphEdge,
  type GraphNode,
} from '@forgeroutine/curriculum';
import type { Prisma } from '@forgeroutine/database';

export const GENERATOR_VERSION = 'seed-1';

/**
 * Imports a curriculum (curated seed or AI-generated — same format, one code path)
 * into PostgreSQL.
 *
 * Two properties matter:
 *
 *  1. **Atomic.** A partially-imported technology would leave concepts pointing at
 *     prerequisites that do not exist, so the whole import is one transaction and
 *     nothing partial is ever visible.
 *  2. **Idempotent by slug.** Re-running the seed must not duplicate concepts or
 *     orphan a user's skill history, which is keyed on concept ids.
 */
@Injectable()
export class CurriculumImportService {
  private readonly logger = new Logger(CurriculumImportService.name);

  async importTechnology(tx: Prisma.TransactionClient, seed: SeedTechnology): Promise<string> {
    const technology = await tx.technology.upsert({
      where: { slug: seed.slug },
      create: {
        slug: seed.slug,
        name: seed.name,
        description: seed.description,
        category: seed.category,
        curatedCurriculum: seed.concepts.length > 0,
      },
      update: {
        name: seed.name,
        description: seed.description,
        category: seed.category,
        curatedCurriculum: seed.concepts.length > 0,
      },
    });

    if (seed.concepts.length === 0) return technology.id;

    const version = await this.nextVersion(tx, technology.id);

    const curriculumVersion = await tx.curriculumVersion.create({
      data: {
        technologyId: technology.id,
        version,
        generatorVersion: GENERATOR_VERSION,
        status: 'GENERATING',
        conceptCount: seed.concepts.length,
      },
    });

    // Concepts first, so prerequisite edges have something to point at.
    const conceptIdBySlug = new Map<string, string>();

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
      conceptIdBySlug.set(`${seed.slug}:${concept.slug}`, row.id);
    }

    await this.linkPrerequisites(tx, seed, conceptIdBySlug);
    await this.importExercises(tx, seed, conceptIdBySlug);

    // Only now is the version safe to serve.
    await tx.curriculumVersion.updateMany({
      where: { technologyId: technology.id, status: 'ACTIVE' },
      data: { status: 'SUPERSEDED' },
    });
    await tx.curriculumVersion.update({
      where: { id: curriculumVersion.id },
      data: { status: 'ACTIVE' },
    });

    this.logger.log(`Imported ${seed.slug} v${version}: ${seed.concepts.length} concepts`);

    return technology.id;
  }

  private async nextVersion(tx: Prisma.TransactionClient, technologyId: string): Promise<number> {
    const latest = await tx.curriculumVersion.findFirst({
      where: { technologyId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    return (latest?.version ?? 0) + 1;
  }

  /**
   * Resolves prerequisite slugs to ids, including `tech:slug` references that cross
   * a technology boundary — the mechanism that stops the graph becoming islands.
   *
   * A reference to a technology that has not been imported yet is skipped with a
   * warning rather than failing the import: seed order should not decide whether
   * JavaScript imports successfully.
   */
  private async linkPrerequisites(
    tx: Prisma.TransactionClient,
    seed: SeedTechnology,
    conceptIdBySlug: Map<string, string>,
  ): Promise<void> {
    const edges: { conceptId: string; prerequisiteId: string; strength: 'HARD' | 'SOFT' }[] = [];

    for (const concept of seed.concepts) {
      const conceptId = conceptIdBySlug.get(`${seed.slug}:${concept.slug}`);
      if (!conceptId) continue;

      for (const prereq of concept.prerequisites) {
        const qualified = prereq.slug.includes(':') ? prereq.slug : `${seed.slug}:${prereq.slug}`;

        const prerequisiteId =
          conceptIdBySlug.get(qualified) ?? (await this.resolveExternal(tx, qualified));

        if (!prerequisiteId) {
          this.logger.warn(
            `Skipping prerequisite ${qualified} for ${seed.slug}:${concept.slug}: not imported yet`,
          );
          continue;
        }

        edges.push({ conceptId, prerequisiteId, strength: prereq.strength });
      }
    }

    // A cycle would make the routine planner non-terminating, so it must never
    // reach the database. Validated against the full graph, not just this import.
    await this.assertStillAcyclic(tx, edges);

    for (const edge of edges) {
      await tx.conceptPrerequisite.upsert({
        where: {
          conceptId_prerequisiteId: {
            conceptId: edge.conceptId,
            prerequisiteId: edge.prerequisiteId,
          },
        },
        create: edge,
        update: { strength: edge.strength },
      });
    }
  }

  private async resolveExternal(
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

  private async assertStillAcyclic(
    tx: Prisma.TransactionClient,
    incoming: readonly { conceptId: string; prerequisiteId: string; strength: 'HARD' | 'SOFT' }[],
  ): Promise<void> {
    const [concepts, existing] = await Promise.all([
      tx.concept.findMany({ select: { id: true, name: true, technologyId: true } }),
      tx.conceptPrerequisite.findMany({
        select: { conceptId: true, prerequisiteId: true, strength: true },
      }),
    ]);

    const nodes: GraphNode[] = concepts.map((c) => ({
      id: c.id,
      name: c.name,
      technologyId: c.technologyId,
    }));

    const merged = new Map<string, GraphEdge>();
    for (const edge of [...existing, ...incoming]) {
      merged.set(`${edge.conceptId}->${edge.prerequisiteId}`, {
        conceptId: edge.conceptId,
        prerequisiteId: edge.prerequisiteId,
        strength: edge.strength,
      });
    }

    assertAcyclic(nodes, [...merged.values()]);
  }

  private async importExercises(
    tx: Prisma.TransactionClient,
    seed: SeedTechnology,
    conceptIdBySlug: Map<string, string>,
  ): Promise<void> {
    for (const concept of seed.concepts) {
      const conceptId = conceptIdBySlug.get(`${seed.slug}:${concept.slug}`);
      if (!conceptId) continue;

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
            estimatedMinutes: exercise.estimatedMinutes,
          },
          update: {
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
            estimatedMinutes: exercise.estimatedMinutes,
            archivedAt: null,
          },
        });

        // Test cases are replaced wholesale: they have no stable identity of their
        // own, and a stale case would silently mis-grade every future submission.
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
  }
}
