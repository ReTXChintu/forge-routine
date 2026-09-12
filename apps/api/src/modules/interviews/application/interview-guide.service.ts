import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';

export interface GuideTopic {
  conceptId: string;
  name: string;
  description: string;
  /** 0-1, or null when never practised. */
  readiness: number | null;
  /** Where the gap actually is, when there is one. */
  weakestDimension: string | null;
  /** What an interviewer is likely to probe here. From the curriculum. */
  likelyProbes: string[];
  /** Mistakes people make on this, so they can be pre-empted. */
  commonMistakes: string[];
  status: 'STRONG' | 'SHAKY' | 'WEAK' | 'UNPRACTISED';
}

export interface GuideTechnology {
  technologyId: string;
  name: string;
  slug: string;
  interviewImportance: number;
  readiness: number | null;
  /** Ordered: the ones worth the user's remaining preparation time first. */
  topics: GuideTopic[];
}

export interface InterviewGuideView {
  /** Null until enough has been practised to say anything honest. */
  overallReadiness: number | null;
  technologies: GuideTechnology[];
  /** The specific, ordered next moves. Not encouragement. */
  priorities: { title: string; reason: string; conceptId: string | null }[];
  /** What past interviews found, so the guide is not purely theoretical. */
  recurringWeaknesses: string[];
  interviewsTaken: number;
  lastInterviewAt: string | null;
}

const STRONG = 0.7;
const SHAKY = 0.45;

/** Below this many practised concepts, an overall number is not meaningful. */
const MIN_CONCEPTS_FOR_OVERALL = 5;

/**
 * The interview guide (§17): a readiness dossier, not a study plan.
 *
 * The roadmap answers "what should I learn next". This answers a different
 * question — "if the interview were tomorrow, where would I be caught out" —
 * and the two give different answers on purpose. The roadmap is ordered by
 * what builds on what; this is ordered by exposure, which means a topic that
 * is certain to come up and is shaky outranks a foundational topic that is
 * already solid.
 *
 * Derived on read rather than stored. A dossier that goes stale the moment
 * the user practises anything is worse than no dossier, because they would
 * act on it.
 */
@Injectable()
export class InterviewGuideService {
  constructor(private readonly prisma: PrismaService) {}

  async build(userId: string): Promise<InterviewGuideView> {
    const [userTechnologies, interviews] = await Promise.all([
      this.prisma.userTechnology.findMany({
        where: { userId, status: 'ACTIVE', archivedAt: null },
        include: { technology: { select: { id: true, name: true, slug: true } } },
        orderBy: { interviewImportance: 'desc' },
      }),
      this.prisma.interview.findMany({
        where: { userId, status: 'COMPLETED' },
        orderBy: { startedAt: 'desc' },
        take: 5,
        include: { evaluation: { select: { weakAreas: true, recommendedTopics: true } } },
      }),
    ]);

    if (userTechnologies.length === 0) {
      return {
        overallReadiness: null,
        technologies: [],
        priorities: [],
        recurringWeaknesses: [],
        interviewsTaken: 0,
        lastInterviewAt: null,
      };
    }

    const concepts = await this.prisma.concept.findMany({
      where: {
        technologyId: { in: userTechnologies.map((t) => t.technologyId) },
        archivedAt: null,
      },
      orderBy: { orderIndex: 'asc' },
      select: {
        id: true,
        name: true,
        description: true,
        technologyId: true,
        commonMistakes: true,
        learningObjectives: true,
        skills: {
          where: { userId },
          select: {
            attempts: true,
            interviewReadiness: true,
            conceptMastery: true,
            explanationAbility: true,
            recallStrength: true,
            codingAbility: true,
          },
        },
      },
    });

    const technologies = userTechnologies.map((userTechnology) => {
      const topics = concepts
        .filter((concept) => concept.technologyId === userTechnology.technologyId)
        .map((concept) => toTopic(concept))
        .sort(byPreparationValue);

      const scored = topics
        .map((topic) => topic.readiness)
        .filter((value): value is number => value !== null);

      return {
        technologyId: userTechnology.technology.id,
        name: userTechnology.technology.name,
        slug: userTechnology.technology.slug,
        interviewImportance: userTechnology.interviewImportance,
        readiness: scored.length > 0 ? average(scored) : null,
        topics,
      };
    });

    return {
      overallReadiness: this.overall(technologies),
      technologies,
      priorities: this.priorities(technologies),
      recurringWeaknesses: recurring(interviews),
      interviewsTaken: interviews.length,
      lastInterviewAt: interviews[0]?.startedAt.toISOString() ?? null,
    };
  }

  /**
   * Weighted by how much each technology matters to this user's interviews —
   * being strong on something they will never be asked about should not read
   * as being ready.
   */
  private overall(technologies: readonly GuideTechnology[]): number | null {
    const practised = technologies.filter((technology) => technology.readiness !== null);
    if (practised.length === 0) return null;

    const conceptCount = technologies
      .flatMap((technology) => technology.topics)
      .filter((topic) => topic.status !== 'UNPRACTISED').length;

    // A single well-drilled concept is not 90% interview readiness.
    if (conceptCount < MIN_CONCEPTS_FOR_OVERALL) return null;

    const totalWeight = practised.reduce((sum, t) => sum + Math.max(1, t.interviewImportance), 0);

    return practised.reduce(
      (sum, t) => sum + (t.readiness ?? 0) * (Math.max(1, t.interviewImportance) / totalWeight),
      0,
    );
  }

  /**
   * The ordered list of what to do next, each with the reason.
   *
   * Exposure first: a shaky topic in a technology the user rated 5 for
   * interviews is more urgent than a weak one they rated 1.
   */
  private priorities(technologies: readonly GuideTechnology[]) {
    const candidates = technologies.flatMap((technology) =>
      technology.topics
        .filter((topic) => topic.status === 'SHAKY' || topic.status === 'WEAK')
        .map((topic) => ({
          topic,
          technology,
          urgency: (1 - (topic.readiness ?? 0)) * Math.max(1, technology.interviewImportance),
        })),
    );

    const unpractisedHighValue = technologies
      .filter((technology) => technology.interviewImportance >= 4)
      .flatMap((technology) =>
        technology.topics
          .filter((topic) => topic.status === 'UNPRACTISED')
          .slice(0, 2)
          .map((topic) => ({ topic, technology, urgency: technology.interviewImportance * 0.8 })),
      );

    return [...candidates, ...unpractisedHighValue]
      .sort((a, b) => b.urgency - a.urgency)
      .slice(0, 6)
      .map(({ topic, technology }) => ({
        title: `${technology.name}: ${topic.name}`,
        reason:
          topic.status === 'UNPRACTISED'
            ? `Never practised, and you rated ${technology.name} ${technology.interviewImportance}/5 for interviews.`
            : topic.weakestDimension
              ? `${describeDimension(topic.weakestDimension)} — the part an interview exposes first.`
              : `Readiness is ${Math.round((topic.readiness ?? 0) * 100)}%.`,
        conceptId: topic.conceptId,
      }));
  }
}

interface ConceptRow {
  id: string;
  name: string;
  description: string;
  commonMistakes: string[];
  learningObjectives: string[];
  skills: {
    attempts: number;
    interviewReadiness: number;
    conceptMastery: number;
    explanationAbility: number;
    recallStrength: number;
    codingAbility: number;
  }[];
}

function toTopic(concept: ConceptRow): GuideTopic {
  const skill = concept.skills[0];
  const practised = (skill?.attempts ?? 0) > 0;

  if (!skill || !practised) {
    return {
      conceptId: concept.id,
      name: concept.name,
      description: concept.description,
      readiness: null,
      weakestDimension: null,
      likelyProbes: concept.learningObjectives.slice(0, 3),
      commonMistakes: concept.commonMistakes.slice(0, 3),
      status: 'UNPRACTISED',
    };
  }

  // Interview readiness is not mastery. Being able to write it and being able
  // to explain it under pressure are different things, and the second is what
  // is being measured here — so explanation carries the most weight.
  const readiness =
    skill.explanationAbility * 0.35 +
    skill.conceptMastery * 0.25 +
    skill.recallStrength * 0.2 +
    skill.codingAbility * 0.2;

  const dimensions: [string, number][] = [
    ['explanationAbility', skill.explanationAbility],
    ['conceptMastery', skill.conceptMastery],
    ['recallStrength', skill.recallStrength],
    ['codingAbility', skill.codingAbility],
  ];
  const weakest = dimensions.reduce((low, current) => (current[1] < low[1] ? current : low));

  return {
    conceptId: concept.id,
    name: concept.name,
    description: concept.description,
    readiness,
    weakestDimension: readiness < STRONG ? weakest[0] : null,
    likelyProbes: concept.learningObjectives.slice(0, 3),
    commonMistakes: concept.commonMistakes.slice(0, 3),
    status: readiness >= STRONG ? 'STRONG' : readiness >= SHAKY ? 'SHAKY' : 'WEAK',
  };
}

/**
 * Shaky before weak before unpractised before strong.
 *
 * Shaky leads because it is the cheapest ground to convert: almost there is
 * closer to ready than nowhere near. Strong sinks to the bottom — rereading
 * what you already know is the most comfortable way to waste preparation
 * time, so the guide refuses to put it in front of you.
 */
function byPreparationValue(a: GuideTopic, b: GuideTopic): number {
  const rank = { SHAKY: 0, WEAK: 1, UNPRACTISED: 2, STRONG: 3 };
  if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
  return (a.readiness ?? 0) - (b.readiness ?? 0);
}

/** Weaknesses two or more past interviews agreed on. One is an off day. */
function recurring(
  interviews: readonly { evaluation: { weakAreas: string[]; recommendedTopics: string[] } | null }[],
): string[] {
  const counts = new Map<string, number>();

  for (const interview of interviews) {
    const seen = new Set<string>();
    for (const area of interview.evaluation?.weakAreas ?? []) {
      const key = area.toLowerCase().trim();
      if (seen.has(key)) continue;
      seen.add(key);
      counts.set(area, (counts.get(area) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([area]) => area);
}

function describeDimension(dimension: string): string {
  switch (dimension) {
    case 'explanationAbility':
      return 'You can use it but struggle to explain it';
    case 'recallStrength':
      return 'It fades between sessions';
    case 'codingAbility':
      return 'You can describe it but not yet write it unaided';
    case 'conceptMastery':
    default:
      return 'The underlying model is still thin';
  }
}

function average(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
