import { describe, expect, it } from 'vitest';

import { TECHNOLOGY_CATALOGUE } from './seed/catalogue.js';
import {
  assertAcyclicTechnologies,
  nextToGenerate,
  orderTechnologies,
  shouldGenerateAhead,
  type OrderableTechnology,
} from './technology-order.js';

/**
 * This order decides what gets paid for and when, so its failures are
 * expensive rather than merely wrong: an order that generates React before
 * JavaScript spends real money building the thing the user cannot start.
 */

function tech(
  slug: string,
  dependsOn: string[] = [],
  extra: Partial<OrderableTechnology> = {},
): OrderableTechnology {
  return { technologyId: `id-${slug}`, slug, dependsOn, ...extra };
}

const slugs = (ids: string[]) => ids.map((id) => id.replace('id-', ''));

describe('orderTechnologies', () => {
  it('puts a dependency before the thing that needs it', () => {
    const ordered = slugs(
      orderTechnologies([tech('react', ['javascript']), tech('javascript')]),
    );

    expect(ordered.indexOf('javascript')).toBeLessThan(ordered.indexOf('react'));
  });

  it('respects a chain', () => {
    const ordered = slugs(
      orderTechnologies([
        tech('nextjs', ['react']),
        tech('react', ['javascript', 'typescript']),
        tech('typescript', ['javascript']),
        tech('javascript'),
      ]),
    );

    expect(ordered).toEqual(['javascript', 'typescript', 'react', 'nextjs']);
  });

  it('ignores a dependency the user did not choose rather than adding it', () => {
    // Someone who picks React and not TypeScript has made a choice. Quietly
    // inserting TypeScript into their plan overrides it.
    const ordered = slugs(orderTechnologies([tech('react', ['javascript', 'typescript'])]));

    expect(ordered).toEqual(['react']);
  });

  it('is stable regardless of input order', () => {
    const first = slugs(
      orderTechnologies([tech('docker', ['linux']), tech('git'), tech('linux')]),
    );
    const second = slugs(
      orderTechnologies([tech('linux'), tech('docker', ['linux']), tech('git')]),
    );

    expect(first).toEqual(second);
  });

  it('breaks ties by weight before slug', () => {
    const ordered = slugs(
      orderTechnologies([
        tech('alpha', [], { weight: 0 }),
        tech('zulu', [], { weight: 10 }),
      ]),
    );

    expect(ordered).toEqual(['zulu', 'alpha']);
  });

  it('returns everything even when a cycle sneaks in', () => {
    // A partial order would silently drop half the user's technologies,
    // which is worse than an imperfect one.
    const ordered = orderTechnologies([tech('a', ['b']), tech('b', ['a'])]);

    expect(ordered).toHaveLength(2);
  });

  it('handles an empty selection', () => {
    expect(orderTechnologies([])).toEqual([]);
  });
});

describe('nextToGenerate', () => {
  it('picks the earliest technology with no content', () => {
    const next = nextToGenerate([
      { ...tech('react', ['javascript']), hasContent: false },
      { ...tech('javascript'), hasContent: false },
    ]);

    expect(next).toBe('id-javascript');
  });

  it('skips what is already built', () => {
    const next = nextToGenerate([
      { ...tech('react', ['javascript']), hasContent: false },
      { ...tech('javascript'), hasContent: true },
    ]);

    expect(next).toBe('id-react');
  });

  it('returns null when everything is built', () => {
    expect(
      nextToGenerate([
        { ...tech('javascript'), hasContent: true },
        { ...tech('react', ['javascript']), hasContent: true },
      ]),
    ).toBeNull();
  });

  it('never picks a blocked technology before its dependency', () => {
    // The expensive mistake: paying to build React while JavaScript, which
    // the user must do first, does not exist yet.
    const next = nextToGenerate([
      { ...tech('nextjs', ['react']), hasContent: false },
      { ...tech('react', ['javascript']), hasContent: false },
      { ...tech('javascript'), hasContent: false },
    ]);

    expect(next).toBe('id-javascript');
  });
});

describe('shouldGenerateAhead', () => {
  it('waits while the user has barely started', () => {
    expect(shouldGenerateAhead({ totalConcepts: 20, practisedConcepts: 2 })).toBe(false);
  });

  it('builds ahead once they are well into what they have', () => {
    expect(shouldGenerateAhead({ totalConcepts: 20, practisedConcepts: 14 })).toBe(true);
  });

  it('treats an empty curriculum as needing the first technology', () => {
    expect(shouldGenerateAhead({ totalConcepts: 0, practisedConcepts: 0 })).toBe(true);
  });
});

describe('the shipped catalogue', () => {
  it('has no dependency cycles and no typos in a dependency slug', () => {
    // A typo would silently stop constraining anything, and a cycle would
    // leave a technology permanently ungeneratable with nothing in the logs.
    expect(() =>
      assertAcyclicTechnologies(
        TECHNOLOGY_CATALOGUE.map((technology) => ({
          slug: technology.slug,
          dependsOn: technology.dependsOn ?? [],
        })),
      ),
    ).not.toThrow();
  });

  const catalogueOrder = () =>
    slugs(
      orderTechnologies(
        TECHNOLOGY_CATALOGUE.map((technology) => ({
          technologyId: `id-${technology.slug}`,
          slug: technology.slug,
          dependsOn: technology.dependsOn ?? [],
          weight: -(technology.learningOrder ?? 500),
        })),
      ),
    );

  it('never violates a declared prerequisite', () => {
    const ordered = catalogueOrder();

    const before = (a: string, b: string) =>
      expect(ordered.indexOf(a), `${a} must come before ${b}`).toBeLessThan(
        ordered.indexOf(b),
      );

    before('javascript', 'typescript');
    before('javascript', 'nodejs');
    before('typescript', 'react');
    before('react', 'nextjs');
    before('nodejs', 'nestjs');
    before('linux', 'docker');
    before('docker', 'traefik');
    before('git', 'github');
    before('github', 'github-actions');
    before('postgresql', 'prisma');
    before('postgresql', 'typeorm');
    before('typescript', 'typeorm');
  });

  it('keeps learningOrder and dependsOn from contradicting each other', () => {
    // The two are authored separately, so nothing stops someone renumbering
    // react above typescript. If that happened the topological sort would
    // silently override the intended order and the catalogue would lie about
    // what it teaches when.
    const rank = new Map(
      TECHNOLOGY_CATALOGUE.map((technology) => [technology.slug, technology.learningOrder ?? 500]),
    );

    for (const technology of TECHNOLOGY_CATALOGUE) {
      for (const dependency of technology.dependsOn ?? []) {
        expect(
          rank.get(dependency)!,
          `${dependency} is a prerequisite of ${technology.slug} but is numbered after it`,
        ).toBeLessThan(rank.get(technology.slug)!);
      }
    }
  });

  it('follows the intended reading order exactly', () => {
    // Since the two agree, the emitted order is just learningOrder. Asserted
    // in full so a reordering is a visible diff rather than a surprise.
    expect(catalogueOrder()).toEqual([
      'javascript',
      'typescript',
      'nodejs',
      'git',
      'linux',
      'react',
      'nextjs',
      'nestjs',
      'postgresql',
      'prisma',
      'typeorm',
      'mongodb',
      'redis',
      'docker',
      'github',
      'github-actions',
      'jenkins',
      'nginx',
      'traefik',
      'rust',
      'software-architecture',
      'system-design',
    ]);
  });

  it('gives every technology a distinct place in the order', () => {
    const ranks = TECHNOLOGY_CATALOGUE.map((technology) => technology.learningOrder ?? 500);
    expect(new Set(ranks).size, 'two technologies share a learningOrder').toBe(ranks.length);
  });

  it('rejects a dependency on a technology that does not exist', () => {
    expect(() =>
      assertAcyclicTechnologies([{ slug: 'react', dependsOn: ['typescrpt'] }]),
    ).toThrow(/unknown "typescrpt"/);
  });

  it('names the technologies involved in a cycle', () => {
    expect(() =>
      assertAcyclicTechnologies([
        { slug: 'a', dependsOn: ['b'] },
        { slug: 'b', dependsOn: ['a'] },
      ]),
    ).toThrow(/cycle: a -> b -> a/);
  });
});
