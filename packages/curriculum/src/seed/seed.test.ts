import { describe, expect, it } from 'vitest';

import { type GraphEdge, type GraphNode, assertAcyclic } from '../graph.js';

import { TECHNOLOGY_CATALOGUE } from './catalogue.js';

import { getCuratedCurricula } from './index.js';

/**
 * Seed data is the one place where a typo silently produces a broken learning
 * experience rather than a crash. These tests are the guardrail.
 */
describe('technology catalogue', () => {
  const catalogue = TECHNOLOGY_CATALOGUE;

  it('covers the §41 starting set', () => {
    expect(catalogue.length).toBeGreaterThanOrEqual(19);
  });

  it('has unique slugs', () => {
    const slugs = catalogue.map((t) => t.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('uses well-formed slugs', () => {
    for (const tech of catalogue) {
      expect(tech.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    }
  });

  it('gives every technology a name and description', () => {
    for (const tech of catalogue) {
      expect(tech.name).toBeTruthy();
      expect(tech.description).toBeTruthy();
    }
  });
});

describe('curated curricula', () => {
  const curricula = getCuratedCurricula();

  it('parses against the seed schema', () => {
    expect(curricula.length).toBeGreaterThan(0);
  });

  it('only curates technologies that exist in the catalogue', () => {
    const known = new Set(TECHNOLOGY_CATALOGUE.map((t) => t.slug));
    for (const tech of curricula) {
      expect(known.has(tech.slug)).toBe(true);
    }
  });

  it('has unique concept slugs within each technology', () => {
    for (const tech of curricula) {
      const slugs = tech.concepts.map((c) => c.slug);
      expect(new Set(slugs).size, `duplicate concept slug in ${tech.slug}`).toBe(slugs.length);
    }
  });

  it('resolves every prerequisite, including cross-technology references', () => {
    const known = new Set<string>();
    for (const tech of curricula) {
      for (const concept of tech.concepts) known.add(`${tech.slug}:${concept.slug}`);
    }

    for (const tech of curricula) {
      for (const concept of tech.concepts) {
        for (const prereq of concept.prerequisites) {
          const qualified = prereq.slug.includes(':') ? prereq.slug : `${tech.slug}:${prereq.slug}`;
          expect(known.has(qualified), `unresolved prerequisite ${qualified}`).toBe(true);
        }
      }
    }
  });

  it('forms a DAG across the whole curated graph', () => {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    for (const tech of curricula) {
      for (const concept of tech.concepts) {
        const id = `${tech.slug}:${concept.slug}`;
        nodes.push({ id, name: concept.name, technologyId: tech.slug });
        for (const prereq of concept.prerequisites) {
          edges.push({
            conceptId: id,
            prerequisiteId: prereq.slug.includes(':') ? prereq.slug : `${tech.slug}:${prereq.slug}`,
            strength: prereq.strength,
          });
        }
      }
    }

    expect(() => assertAcyclic(nodes, edges)).not.toThrow();
  });

  it('gives every exercise at least one test case and a standalone objective', () => {
    for (const tech of curricula) {
      for (const concept of tech.concepts) {
        for (const exercise of concept.exercises) {
          expect(exercise.testCases.length, `${exercise.slug} has no tests`).toBeGreaterThan(0);
          // The objective is the entire prompt at level 4, so it must make sense alone.
          expect(exercise.objective.length, `${exercise.slug} objective too short`).toBeGreaterThan(
            20,
          );
        }
      }
    }
  });

  it('gives every exercise at least one hidden test case', () => {
    // Visible-only tests let a user pattern-match to green without generalising.
    for (const tech of curricula) {
      for (const concept of tech.concepts) {
        for (const exercise of concept.exercises) {
          const hidden = exercise.testCases.filter((t) => t.hidden);
          expect(hidden.length, `${exercise.slug} has no hidden tests`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('records common mistakes for every concept', () => {
    // The debugging-exercise generator uses these as its source of realistic faults.
    for (const tech of curricula) {
      for (const concept of tech.concepts) {
        expect(
          concept.commonMistakes.length,
          `${tech.slug}:${concept.slug} has no commonMistakes`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it('has unique exercise slugs within a concept', () => {
    for (const tech of curricula) {
      for (const concept of tech.concepts) {
        const slugs = concept.exercises.map((e) => e.slug);
        expect(new Set(slugs).size).toBe(slugs.length);
      }
    }
  });
});
