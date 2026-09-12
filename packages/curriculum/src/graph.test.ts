import { describe, expect, it } from 'vitest';

import {
  type GraphEdge,
  type GraphNode,
  GraphCycleError,
  KnowledgeGraph,
  assertAcyclic,
  computeReadiness,
  traceRootCause,
} from './graph.js';

/**
 * The worked example from docs/knowledge-graph.md:
 *
 *   streams ──HARD──▶ buffers ──HARD──▶ binary
 *           ──HARD──▶ async   ──HARD──▶ promises
 *           ──SOFT──▶ pipes
 */
const nodes: GraphNode[] = ['streams', 'buffers', 'binary', 'async', 'promises', 'pipes'].map(
  (id) => ({ id, name: id, technologyId: 'nodejs' }),
);

const edges: GraphEdge[] = [
  { conceptId: 'streams', prerequisiteId: 'buffers', strength: 'HARD' },
  { conceptId: 'streams', prerequisiteId: 'async', strength: 'HARD' },
  { conceptId: 'streams', prerequisiteId: 'pipes', strength: 'SOFT' },
  { conceptId: 'buffers', prerequisiteId: 'binary', strength: 'HARD' },
  { conceptId: 'async', prerequisiteId: 'promises', strength: 'HARD' },
];

const graph = new KnowledgeGraph(nodes, edges);

function skills(map: Record<string, { conceptMastery: number; codingAbility: number }>) {
  return (id: string) => map[id];
}

describe('KnowledgeGraph', () => {
  it('rejects a self-edge at construction', () => {
    expect(
      () =>
        new KnowledgeGraph(nodes, [
          { conceptId: 'streams', prerequisiteId: 'streams', strength: 'HARD' },
        ]),
    ).toThrow(GraphCycleError);
  });

  it('detects a multi-node cycle', () => {
    const cyclic: GraphEdge[] = [
      { conceptId: 'a', prerequisiteId: 'b', strength: 'HARD' },
      { conceptId: 'b', prerequisiteId: 'c', strength: 'HARD' },
      { conceptId: 'c', prerequisiteId: 'a', strength: 'HARD' },
    ];
    const cyclicNodes = ['a', 'b', 'c'].map((id) => ({ id, name: id, technologyId: 't' }));

    expect(() => assertAcyclic(cyclicNodes, cyclic)).toThrow(GraphCycleError);
  });

  it('orders prerequisites before dependents', () => {
    const order = graph.topologicalOrder();

    expect(order.indexOf('binary')).toBeLessThan(order.indexOf('buffers'));
    expect(order.indexOf('buffers')).toBeLessThan(order.indexOf('streams'));
    expect(order.indexOf('promises')).toBeLessThan(order.indexOf('async'));
  });

  it('returns transitive prerequisites nearest-first', () => {
    const result = graph.transitivePrerequisites('streams');

    const depthOf = (id: string) => result.find((r) => r.conceptId === id)?.depth;
    expect(depthOf('buffers')).toBe(1);
    expect(depthOf('async')).toBe(1);
    expect(depthOf('binary')).toBe(2);
    expect(depthOf('promises')).toBe(2);
  });

  it('propagates SOFT along a path: a soft link makes everything beyond it soft', () => {
    const g = new KnowledgeGraph(nodes, [
      { conceptId: 'streams', prerequisiteId: 'pipes', strength: 'SOFT' },
      { conceptId: 'pipes', prerequisiteId: 'binary', strength: 'HARD' },
    ]);

    const binary = g.transitivePrerequisites('streams').find((r) => r.conceptId === 'binary');

    expect(binary?.strength).toBe('SOFT');
  });

  it('respects the depth cap so one bad attempt does not reach the fundamentals', () => {
    const result = graph.transitivePrerequisites('streams', 1);

    expect(result.map((r) => r.conceptId).sort()).toEqual(['async', 'buffers', 'pipes']);
  });
});

describe('traceRootCause', () => {
  it('identifies the weak prerequisite rather than blaming the concept', () => {
    const trace = traceRootCause(
      graph,
      'streams',
      skills({
        buffers: { conceptMastery: 0.34, codingAbility: 0.3 },
        binary: { conceptMastery: 0.9, codingAbility: 0.9 },
        async: { conceptMastery: 0.77, codingAbility: 0.8 },
        promises: { conceptMastery: 0.85, codingAbility: 0.8 },
        pipes: { conceptMastery: 0.7, codingAbility: 0.7 },
      }),
    );

    expect(trace.cause).toBe('PREREQUISITE_GAP');
    expect(trace.weak[0]?.conceptId).toBe('buffers');
  });

  it('blames the concept itself when every prerequisite is solid', () => {
    const strong = { conceptMastery: 0.9, codingAbility: 0.9 };
    const trace = traceRootCause(
      graph,
      'streams',
      skills({
        buffers: strong,
        binary: strong,
        async: strong,
        promises: strong,
        pipes: strong,
      }),
    );

    expect(trace.cause).toBe('CONCEPT_ITSELF');
    expect(trace.weak).toHaveLength(0);
  });

  it('treats an unpractised prerequisite as a full gap', () => {
    const trace = traceRootCause(graph, 'streams', skills({}));

    expect(trace.cause).toBe('PREREQUISITE_GAP');
    expect(trace.weak.length).toBeGreaterThan(0);
    expect(trace.weak[0]?.deficit).toBeGreaterThan(0);
  });

  it('orders nearest and HARD before distant and SOFT', () => {
    const weakEverywhere = { conceptMastery: 0.1, codingAbility: 0.1 };
    const trace = traceRootCause(
      graph,
      'streams',
      skills({
        buffers: weakEverywhere,
        binary: weakEverywhere,
        async: weakEverywhere,
        promises: weakEverywhere,
        pipes: weakEverywhere,
      }),
    );

    expect(trace.weak[0]?.depth).toBe(1);
    expect(trace.weak[0]?.strength).toBe('HARD');
    expect(trace.weak.at(-1)?.depth).toBe(2);
  });

  it('flags a concept as weak when understanding is fine but implementation is not', () => {
    // The exact gap this product exists to detect: 84% concept, 51% code.
    const trace = traceRootCause(
      graph,
      'streams',
      skills({
        buffers: { conceptMastery: 0.84, codingAbility: 0.31 },
        binary: { conceptMastery: 0.9, codingAbility: 0.9 },
        async: { conceptMastery: 0.9, codingAbility: 0.9 },
        promises: { conceptMastery: 0.9, codingAbility: 0.9 },
        pipes: { conceptMastery: 0.9, codingAbility: 0.9 },
      }),
    );

    expect(trace.cause).toBe('PREREQUISITE_GAP');
    expect(trace.weak[0]?.conceptId).toBe('buffers');
  });
});

describe('computeReadiness', () => {
  it('unlocks when every hard prerequisite clears the threshold', () => {
    const readiness = computeReadiness(
      graph,
      'streams',
      skills({
        buffers: { conceptMastery: 0.7, codingAbility: 0.7 },
        async: { conceptMastery: 0.8, codingAbility: 0.8 },
      }),
    );

    expect(readiness.unlocked).toBe(true);
    expect(readiness.score).toBe(1);
  });

  it('blocks on an unmet hard prerequisite and names it', () => {
    const readiness = computeReadiness(
      graph,
      'streams',
      skills({
        buffers: { conceptMastery: 0.3, codingAbility: 0.3 },
        async: { conceptMastery: 0.8, codingAbility: 0.8 },
      }),
    );

    expect(readiness.unlocked).toBe(false);
    expect(readiness.blockingConceptIds).toEqual(['buffers']);
    expect(readiness.score).toBeCloseTo(0.5, 5);
  });

  it('never blocks on a soft prerequisite, only advises', () => {
    const readiness = computeReadiness(
      graph,
      'streams',
      skills({
        buffers: { conceptMastery: 0.9, codingAbility: 0.9 },
        async: { conceptMastery: 0.9, codingAbility: 0.9 },
        pipes: { conceptMastery: 0.1, codingAbility: 0.1 },
      }),
    );

    expect(readiness.unlocked).toBe(true);
    expect(readiness.advisoryConceptIds).toEqual(['pipes']);
  });

  it('treats a root concept with no prerequisites as unlocked', () => {
    const readiness = computeReadiness(graph, 'binary', skills({}));

    expect(readiness.unlocked).toBe(true);
    expect(readiness.score).toBe(1);
  });
});
