import { Injectable } from '@nestjs/common';

import {
  KnowledgeGraph,
  computeReadiness,
  traceRootCause,
  type GraphEdge,
  type GraphNode,
  type Readiness,
  type RootCauseTrace,
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
        technology: { select: { name: true } },
        prerequisites: {
          include: { prerequisite: { select: { id: true, name: true } } },
        },
        _count: { select: { exercises: true } },
      },
    });

    if (!row || row.archivedAt !== null) throw Problems.notFound('Concept');

    const [graph, skillMap] = await Promise.all([
      this.loadGraph(),
      this.skills.getSkillMap(userId),
    ]);

    return {
      ...toConcept(row),
      technologyName: row.technology.name,
      prerequisites: row.prerequisites.map((p) => ({
        conceptId: p.prerequisiteId,
        name: p.prerequisite.name,
        strength: p.strength as 'HARD' | 'SOFT',
      })),
      readiness: computeReadiness(graph, conceptId, (id) => skillMap.get(id)),
      skill: skillMap.get(conceptId) ?? null,
      exerciseCount: row._count.exercises,
    };
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
