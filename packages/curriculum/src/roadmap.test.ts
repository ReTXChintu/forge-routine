import { describe, expect, it } from 'vitest';

import type { GraphEdge } from './graph.js';
import {
  type BuildRoadmapInput,
  type RoadmapConcept,
  type RoadmapSkill,
  type RoadmapTechnology,
  buildRoadmap,
} from './roadmap.js';

/**
 * The roadmap is the first thing a new user sees and the thing they judge the
 * product by. An ordering that schedules Node.js before JavaScript, or reteaches
 * something they already know, loses their trust before they write a line.
 */

const JS = 'tech-js';
const NODE = 'tech-node';

function tech(id: string, overrides: Partial<RoadmapTechnology> = {}): RoadmapTechnology {
  return {
    technologyId: id,
    slug: id,
    name: id === JS ? 'JavaScript' : 'Node.js',
    priority: 'NORMAL',
    targetProficiency: 'WORKING',
    interviewImportance: 3,
    ...overrides,
  };
}

function concept(
  id: string,
  technologyId: string,
  overrides: Partial<RoadmapConcept> = {},
): RoadmapConcept {
  return {
    id,
    technologyId,
    slug: id,
    name: id,
    difficulty: 3,
    orderIndex: 0,
    exercises: [{ id: `${id}-ex`, kind: 'CODING', difficulty: 3, estimatedMinutes: 15 }],
    ...overrides,
  };
}

const preferences: BuildRoadmapInput['preferences'] = {
  dailyMinutes: 45,
  primaryGoal: 'CODING',
  interviewTarget: 'MID',
};

function build(overrides: Partial<BuildRoadmapInput> = {}) {
  return buildRoadmap({
    technologies: [tech(JS)],
    concepts: [concept('closures', JS)],
    edges: [],
    skills: new Map<string, RoadmapSkill>(),
    preferences,
    ...overrides,
  });
}

const allItems = (r: ReturnType<typeof buildRoadmap>) => r.phases.flatMap((p) => p.items);

describe('technology ordering', () => {
  it('puts a dependency before the thing that depends on it', () => {
    // Node's event loop hard-requires a JavaScript concept, so JavaScript
    // must come first regardless of how the user ranked them.
    const edges: GraphEdge[] = [
      { conceptId: 'event-loop', prerequisiteId: 'promises', strength: 'HARD' },
    ];

    const result = build({
      technologies: [tech(NODE, { priority: 'CRITICAL' }), tech(JS, { priority: 'LOW' })],
      concepts: [concept('promises', JS), concept('event-loop', NODE)],
      edges,
    });

    expect(result.technologyOrder).toEqual([JS, NODE]);
  });

  it('ignores SOFT edges when ordering, since advice is not a constraint', () => {
    const edges: GraphEdge[] = [
      { conceptId: 'event-loop', prerequisiteId: 'promises', strength: 'SOFT' },
    ];

    const result = build({
      technologies: [tech(NODE, { priority: 'CRITICAL' }), tech(JS, { priority: 'LOW' })],
      concepts: [concept('promises', JS), concept('event-loop', NODE)],
      edges,
    });

    expect(result.technologyOrder).toEqual([NODE, JS]);
  });

  it('breaks dependency ties by priority', () => {
    const result = build({
      technologies: [tech(JS, { priority: 'LOW' }), tech(NODE, { priority: 'CRITICAL' })],
      concepts: [concept('a', JS), concept('b', NODE)],
    });

    expect(result.technologyOrder).toEqual([NODE, JS]);
  });

  it('weights interview importance only when the goal is interview-shaped', () => {
    const technologies = [
      tech(JS, { priority: 'NORMAL', interviewImportance: 0 }),
      tech(NODE, { priority: 'NORMAL', interviewImportance: 5 }),
    ];
    const concepts = [concept('a', JS), concept('b', NODE)];

    const coding = build({
      technologies,
      concepts,
      preferences: { ...preferences, primaryGoal: 'CODING' },
    });
    const interview = build({
      technologies,
      concepts,
      preferences: { ...preferences, primaryGoal: 'INTERVIEW' },
    });

    expect(interview.technologyOrder).toEqual([NODE, JS]);
    // Without an interview goal the tie falls back to slug order.
    expect(coding.technologyOrder).toEqual([JS, NODE]);
  });

  it('is deterministic when everything ties', () => {
    const args = {
      technologies: [tech(NODE), tech(JS)],
      concepts: [concept('a', JS), concept('b', NODE)],
    };

    expect(build(args).technologyOrder).toEqual(build(args).technologyOrder);
  });

  it('never drops a technology, even if the graph is somehow cyclic', () => {
    const edges: GraphEdge[] = [
      { conceptId: 'a', prerequisiteId: 'b', strength: 'HARD' },
      { conceptId: 'b', prerequisiteId: 'a', strength: 'HARD' },
    ];

    const result = build({
      technologies: [tech(JS), tech(NODE)],
      concepts: [concept('a', JS), concept('b', NODE)],
      edges,
    });

    expect(result.technologyOrder.sort()).toEqual([JS, NODE].sort());
  });
});

describe('concept ordering', () => {
  it('schedules prerequisites first', () => {
    const result = build({
      concepts: [
        concept('streams', JS, { orderIndex: 0 }),
        concept('buffers', JS, { orderIndex: 1 }),
      ],
      edges: [{ conceptId: 'streams', prerequisiteId: 'buffers', strength: 'HARD' }],
    });

    const learn = allItems(result).filter((i) => i.kind === 'LEARN');
    expect(learn.map((i) => i.conceptId)).toEqual(['buffers', 'streams']);
  });

  it('falls back to curriculum order when prerequisites do not decide it', () => {
    const result = build({
      concepts: [concept('second', JS, { orderIndex: 2 }), concept('first', JS, { orderIndex: 1 })],
    });

    const learn = allItems(result).filter((i) => i.kind === 'LEARN');
    expect(learn.map((i) => i.conceptId)).toEqual(['first', 'second']);
  });
});

describe('skipping what the user already knows', () => {
  it('skips a concept that meets the target on both dimensions', () => {
    const skills = new Map<string, RoadmapSkill>([
      ['known', { conceptMastery: 0.9, codingAbility: 0.9 }],
    ]);

    const result = build({
      concepts: [concept('known', JS), concept('unknown', JS)],
      skills,
    });

    const conceptIds = allItems(result).map((i) => i.conceptId);
    expect(conceptIds).not.toContain('known');
    expect(conceptIds).toContain('unknown');
  });

  it('keeps a concept the user understands but cannot implement', () => {
    // The exact gap the product exists to close: 90% understanding, 20% code.
    const skills = new Map<string, RoadmapSkill>([
      ['closures', { conceptMastery: 0.9, codingAbility: 0.2 }],
    ]);

    const result = build({ concepts: [concept('closures', JS)], skills });

    expect(allItems(result).map((i) => i.conceptId)).toContain('closures');
  });

  it('respects target proficiency: EXPERT keeps more than AWARENESS', () => {
    const skills = new Map<string, RoadmapSkill>([
      ['c', { conceptMastery: 0.7, codingAbility: 0.7 }],
    ]);

    const awareness = build({
      technologies: [tech(JS, { targetProficiency: 'AWARENESS' })],
      concepts: [concept('c', JS)],
      skills,
    });
    const expert = build({
      technologies: [tech(JS, { targetProficiency: 'EXPERT' })],
      concepts: [concept('c', JS)],
      skills,
    });

    expect(allItems(awareness).map((i) => i.conceptId)).not.toContain('c');
    expect(allItems(expert).map((i) => i.conceptId)).toContain('c');
  });

  it('says so plainly when a whole technology is already solid', () => {
    const skills = new Map<string, RoadmapSkill>([
      ['c', { conceptMastery: 0.95, codingAbility: 0.95 }],
    ]);

    const result = build({ concepts: [concept('c', JS)], skills });

    expect(result.phases).toHaveLength(1);
    expect(result.phases[0]?.items).toEqual([]);
    expect(result.phases[0]?.goal).toContain('already meet your target');
  });
});

describe('phases and projects', () => {
  const many = Array.from({ length: 12 }, (_, i) => concept(`c${i}`, JS, { orderIndex: i }));

  it('chunks concepts into phases of the configured size', () => {
    const result = build({ concepts: many, conceptsPerPhase: 5 });

    // 12 concepts at 5 per phase = 3 phases.
    expect(result.phases).toHaveLength(3);
  });

  it('closes every phase with a project or a checkpoint', () => {
    const result = build({ concepts: many, conceptsPerPhase: 5 });

    for (const phase of result.phases) {
      const last = phase.items[phase.items.length - 1];
      expect(['PROJECT', 'CHECKPOINT', 'INTERVIEW']).toContain(last?.kind);
    }
  });

  it('uses a real PROJECT exercise when the curriculum has one', () => {
    const withProject = [
      concept('a', JS),
      concept('b', JS, {
        exercises: [{ id: 'proj-1', kind: 'PROJECT', difficulty: 4, estimatedMinutes: 90 }],
      }),
    ];

    const result = build({ concepts: withProject, conceptsPerPhase: 5 });
    const project = allItems(result).find((i) => i.kind === 'PROJECT');

    expect(project?.exerciseId).toBe('proj-1');
    expect(project?.estimatedMinutes).toBe(90);
    expect(project?.awaitingContent).toBe(false);
  });

  it('marks a checkpoint as awaiting content when no project exists yet', () => {
    const result = build({ concepts: [concept('a', JS)] });
    const closing = allItems(result).find((i) => i.kind === 'CHECKPOINT');

    expect(closing?.awaitingContent).toBe(true);
  });
});

describe('items per concept', () => {
  it('produces learn then code', () => {
    const result = build({ concepts: [concept('a', JS)] });
    const kinds = allItems(result).map((i) => i.kind);

    expect(kinds.slice(0, 2)).toEqual(['LEARN', 'CODE']);
  });

  it('adds a debugging item when the concept has a debugging exercise', () => {
    const result = build({
      concepts: [
        concept('a', JS, {
          exercises: [
            { id: 'code', kind: 'CODING', difficulty: 3, estimatedMinutes: 15 },
            { id: 'debug', kind: 'DEBUGGING', difficulty: 3, estimatedMinutes: 12 },
          ],
        }),
      ],
    });

    const debug = allItems(result).find((i) => i.kind === 'DEBUG');
    expect(debug?.exerciseId).toBe('debug');
  });

  it('picks the easiest available exercise so the path starts gently', () => {
    const result = build({
      concepts: [
        concept('a', JS, {
          exercises: [
            { id: 'hard', kind: 'CODING', difficulty: 5, estimatedMinutes: 40 },
            { id: 'easy', kind: 'CODING', difficulty: 1, estimatedMinutes: 10 },
          ],
        }),
      ],
    });

    expect(allItems(result).find((i) => i.kind === 'CODE')?.exerciseId).toBe('easy');
  });

  it('omits the coding item when the concept has no runnable exercise', () => {
    const result = build({ concepts: [concept('a', JS, { exercises: [] })] });

    expect(allItems(result).some((i) => i.kind === 'CODE')).toBe(false);
    expect(allItems(result).some((i) => i.kind === 'LEARN')).toBe(true);
  });

  it('names the understanding/implementation gap in the rationale', () => {
    const skills = new Map<string, RoadmapSkill>([
      ['a', { conceptMastery: 0.8, codingAbility: 0.3 }],
    ]);

    const result = build({ concepts: [concept('a', JS)], skills });
    const code = allItems(result).find((i) => i.kind === 'CODE');

    expect(code?.rationale).toContain('understand this better than you can');
  });

  it('gives every item a rationale, because an opaque path is not trusted', () => {
    const result = build({ concepts: [concept('a', JS), concept('b', JS)] });

    for (const item of allItems(result)) {
      expect(item.rationale.length).toBeGreaterThan(10);
    }
  });
});

describe('awaiting content', () => {
  it('keeps an ungenerated technology visible in the path', () => {
    const result = build({
      technologies: [tech(JS), tech(NODE)],
      concepts: [concept('a', JS)],
    });

    const nodePhase = result.phases.find((p) => p.technologyId === NODE);
    expect(nodePhase).toBeDefined();
    expect(nodePhase?.items[0]?.awaitingContent).toBe(true);
    expect(nodePhase?.items[0]?.rationale).toContain('check back shortly');
  });

  it('contributes no time estimate for content that does not exist', () => {
    const result = build({
      technologies: [tech(NODE)],
      concepts: [],
    });

    expect(result.totalMinutes).toBe(0);
  });
});

describe('interview checkpoints', () => {
  it('adds one when the technology is marked interview-critical', () => {
    const result = build({
      technologies: [tech(JS, { interviewImportance: 5 })],
      concepts: [concept('a', JS)],
    });

    expect(allItems(result).some((i) => i.kind === 'INTERVIEW')).toBe(true);
  });

  it('omits it for a low-importance technology under a coding goal', () => {
    const result = build({
      technologies: [tech(JS, { interviewImportance: 1 })],
      concepts: [concept('a', JS)],
      preferences: { ...preferences, primaryGoal: 'CODING' },
    });

    expect(allItems(result).some((i) => i.kind === 'INTERVIEW')).toBe(false);
  });

  it('adds one regardless when the whole goal is an interview', () => {
    const result = build({
      technologies: [tech(JS, { interviewImportance: 0 })],
      concepts: [concept('a', JS)],
      preferences: { ...preferences, primaryGoal: 'INTERVIEW' },
    });

    expect(allItems(result).some((i) => i.kind === 'INTERVIEW')).toBe(true);
  });
});

describe('totals', () => {
  it('sums phase minutes into the roadmap total', () => {
    const result = build({ concepts: [concept('a', JS), concept('b', JS)] });
    const summed = result.phases.reduce((s, p) => s + p.estimatedMinutes, 0);

    expect(result.totalMinutes).toBe(summed);
    expect(result.totalMinutes).toBeGreaterThan(0);
  });

  it('handles an empty universe without throwing', () => {
    const result = buildRoadmap({
      technologies: [],
      concepts: [],
      edges: [],
      skills: new Map(),
      preferences,
    });

    expect(result.phases).toEqual([]);
    expect(result.totalMinutes).toBe(0);
    expect(result.generatedBy).toBe('rules');
  });
});
