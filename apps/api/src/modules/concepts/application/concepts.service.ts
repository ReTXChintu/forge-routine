import { Injectable } from '@nestjs/common';

import {
  type GraphEdge,
  type GraphNode,
  KnowledgeGraph,
  type Readiness,
  type RootCauseTrace,
  type SequenceGate,
  computeReadiness,
  gateSequence,
  traceRootCause,
} from '@forgeroutine/curriculum';
import type { Concept, SkillVector } from '@forgeroutine/shared-types';

import { Problems } from '../../../common/http/problem-details.js';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';
import { CacheService } from '../../../infrastructure/redis/cache.service.js';
import { SkillsService } from '../../skills/application/skills.service.js';

export interface ConceptDetail extends Concept {
  technologyName: string;
  prerequisites: { conceptId: string; name: string; strength: 'HARD' | 'SOFT' }[];
  readiness: Readiness;
  skill: SkillVector | null;
  exerciseCount: number;
}

/**
 * Concepts and the knowledge graph (docs/knowledge-graph.md).
 *
 * The graph is loaded whole and traversed in memory. It is small (thousands of
 * nodes at most) and changes rarely, which is what lets the routine planner and
 * readiness checks run on every request without a recursive SQL query each time.
 */
@Injectable()
export class ConceptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly skills: SkillsService,
    private readonly cache: CacheService,
  ) {}

  async listForTechnology(technologyId: string): Promise<Concept[]> {
    const rows = await this.prisma.concept.findMany({
      where: { technologyId, archivedAt: null },
      orderBy: { orderIndex: 'asc' },
    });

    return rows.map(toConcept);
  }

  async getDetail(userId: string, conceptId: string): Promise<ConceptDetail> {
    const row = await this.prisma.concept.findUnique({
      where: { id: conceptId },
      include: {
        technology: { select: { id: true, name: true } },
        prerequisites: {
          include: { prerequisite: { select: { id: true, name: true } } },
        },
        _count: { select: { exercises: true } },
      },
    });

    if (!row || row.archivedAt !== null) throw Problems.notFound('Concept');

    const [graph, skillMap, sequence] = await Promise.all([
      this.loadGraph(),
      this.skills.getSkillMap(userId),
      this.sequenceFor(userId, row.technologyId),
    ]);

    const gate = sequence.get(conceptId);
    const readiness = computeReadiness(graph, conceptId, (id) => skillMap.get(id));

    // Two gates, and both must be open.
    //
    // The graph asks "do you know enough to attempt this", which leaves most
    // concepts open from day one. The sequence asks "have you finished the
    // one before it", which is what makes a course a course. Merged here so
    // every caller gets the same answer rather than each deciding for itself.
    const blockedBySequence = gate !== undefined && !gate.unlocked;

    return {
      ...toConcept(row),
      technologyName: row.technology.name,
      prerequisites: row.prerequisites.map((p) => ({
        conceptId: p.prerequisiteId,
        name: p.prerequisite.name,
        strength: p.strength as 'HARD' | 'SOFT',
      })),
      readiness: {
        ...readiness,
        unlocked: readiness.unlocked && !blockedBySequence,
        blockingConceptIds:
          blockedBySequence && gate?.blockedByConceptId
            ? [gate.blockedByConceptId, ...readiness.blockingConceptIds]
            : readiness.blockingConceptIds,
      },
      skill: skillMap.get(conceptId) ?? null,
      exerciseCount: row._count.exercises,
    };
  }

  /**
   * The sequential gate for every concept in one technology.
   *
   * "Cleared" is a passed attempt, not a mastery score. Mastery decays and
   * is estimated from several signals, so gating on it would re-lock
   * material the user has genuinely finished — the single most frustrating
   * thing a course can do to someone.
   */
  async sequenceFor(
    userId: string,
    technologyId: string,
  ): Promise<Map<string, SequenceGate>> {
    const concepts = await this.prisma.concept.findMany({
      where: { technologyId, archivedAt: null },
      orderBy: { orderIndex: 'asc' },
      select: {
        id: true,
        orderIndex: true,
        _count: { select: { exercises: true, questions: true } },
      },
    });

    if (concepts.length === 0) return new Map();

    const [passed, answered] = await Promise.all([
      this.prisma.exerciseAttempt.findMany({
        where: {
          userId,
          outcome: 'PASSED',
          exercise: { concept: { technologyId } },
        },
        select: { exercise: { select: { conceptId: true } } },
        distinct: ['exerciseId'],
      }),
      // A concept with questions and no exercises is cleared by answering
      // one correctly — otherwise every question-only technology would be
      // impassable at its first concept.
      this.prisma.skill.findMany({
        where: { userId, concept: { technologyId }, recallStrength: { gte: 0.5 } },
        select: { conceptId: true },
      }),
    ]);

    const clearedConceptIds = new Set<string>([
      ...passed.map((attempt) => attempt.exercise.conceptId),
      ...answered.map((skill) => skill.conceptId),
    ]);

    const gates = gateSequence(
      concepts.map((concept) => ({
        conceptId: concept.id,
        orderIndex: concept.orderIndex,
        hasPractice: concept._count.exercises > 0 || concept._count.questions > 0,
      })),
      { clearedConceptIds },
    );

    return new Map(gates.map((gate) => [gate.conceptId, gate]));
  }

  /**
   * Why the user is struggling with a concept: the concept itself, or an unmet
   * prerequisite (§6). The routine engine consumes this to insert the
   * prerequisite ahead of a retry.
   */
  async traceWeakness(userId: string, conceptId: string): Promise<RootCauseTrace> {
    const [graph, skillMap] = await Promise.all([
      this.loadGraph(),
      this.skills.getSkillMap(userId),
    ]);

    return traceRootCause(graph, conceptId, (id) => skillMap.get(id));
  }

  /**
   * The graph is a pure function of concept rows, so it is cached under a version
   * that bumps on any edge change — invalidating the whole namespace without
   * key-by-key deletion.
   */
  private async loadGraph(): Promise<KnowledgeGraph> {
    const version = await this.graphVersion();
    const cacheKey = `kg:full:${version}`;

    const cached = await this.cache.get<{ nodes: GraphNode[]; edges: GraphEdge[] }>(cacheKey);
    if (cached) return new KnowledgeGraph(cached.nodes, cached.edges);

    const [concepts, edges] = await Promise.all([
      this.prisma.concept.findMany({
        where: { archivedAt: null },
        select: { id: true, name: true, technologyId: true },
      }),
      this.prisma.conceptPrerequisite.findMany({
        select: { conceptId: true, prerequisiteId: true, strength: true },
      }),
    ]);

    const nodes: GraphNode[] = concepts;
    const graphEdges: GraphEdge[] = edges.map((e) => ({
      conceptId: e.conceptId,
      prerequisiteId: e.prerequisiteId,
      strength: e.strength as 'HARD' | 'SOFT',
    }));

    await this.cache.set(cacheKey, { nodes, edges: graphEdges }, 86_400);

    return new KnowledgeGraph(nodes, graphEdges);
  }

  /** Edge count plus the newest edge timestamp is a cheap, sufficient version. */
  private async graphVersion(): Promise<string> {
    const [count, newest] = await Promise.all([
      this.prisma.conceptPrerequisite.count(),
      this.prisma.conceptPrerequisite.findFirst({
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
    ]);

    return `${count}-${newest?.createdAt.getTime() ?? 0}`;
  }
}

function toConcept(row: {
  id: string;
  technologyId: string;
  slug: string;
  name: string;
  description: string;
  difficulty: number;
  orderIndex: number;
  learningObjectives: string[];
  codingPatterns: string[];
  commonMistakes: string[];
  createdAt: Date;
  updatedAt: Date;
}): Concept {
  return {
    id: row.id,
    technologyId: row.technologyId,
    slug: row.slug,
    name: row.name,
    description: row.description,
    difficulty: row.difficulty as Concept['difficulty'],
    orderIndex: row.orderIndex,
    learningObjectives: row.learningObjectives,
    codingPatterns: row.codingPatterns,
    commonMistakes: row.commonMistakes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
