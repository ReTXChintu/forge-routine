import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

import * as AGENTS from '../../agents/index.js';

import { stripAbsent, toStrictSchema } from './strict-schema.js';

/** The same conversion the provider performs, for a Zod schema. */
function convert(schema: z.ZodTypeAny) {
  return toStrictSchema(
    zodToJsonSchema(schema, {
      target: 'jsonSchema7',
      $refStrategy: 'none',
    }) as Record<string, unknown>,
  );
}

/** Walks every object node, so a violation anywhere in the tree is caught. */
function objectNodes(node: unknown, found: Record<string, unknown>[] = []) {
  if (Array.isArray(node)) {
    for (const element of node) objectNodes(element, found);
    return found;
  }
  if (typeof node !== 'object' || node === null) return found;

  const record = node as Record<string, unknown>;
  if (record['properties'] !== undefined || record['type'] === 'object') found.push(record);
  for (const value of Object.values(record)) objectNodes(value, found);
  return found;
}

describe('toStrictSchema', () => {
  it('marks every object closed and every property required', () => {
    const { schema } = convert(
      z.object({
        title: z.string(),
        note: z.string().optional(),
        nested: z.object({ deep: z.number().optional() }),
      }),
    );

    for (const node of objectNodes(schema)) {
      expect(node['additionalProperties'], JSON.stringify(node)).toBe(false);
      expect(new Set(node['required'] as string[]), 'required must list every property').toEqual(
        new Set(Object.keys(node['properties'] as object)),
      );
    }
  });

  it('turns an optional field into a nullable one and records it', () => {
    const { schema, absence } = convert(z.object({ a: z.string(), b: z.string().optional() }));

    const properties = schema['properties'] as Record<string, Record<string, unknown>>;
    expect(properties['a']!['type']).toBe('string');
    expect(properties['b']!['type']).toEqual(['string', 'null']);
    expect(absence.optional).toEqual(['b']);
  });

  it('leaves a deliberately nullable field alone', () => {
    // `.nullable()` means null is the answer, not the absence of one, so it
    // must survive stripAbsent — a ReviewIssue with no line number needs the
    // key present and null, and deleting it would fail validation.
    const schema = z.object({ line: z.number().nullable() });
    const { absence } = convert(schema);

    expect(absence.optional).toBeUndefined();
    const value = stripAbsent({ line: null }, absence);
    expect(schema.safeParse(value).success).toBe(true);
  });

  it('strips validation keywords strict mode rejects', () => {
    const { schema } = convert(
      z.object({
        name: z.string().min(2).max(40),
        score: z.number().min(0).max(1),
        tags: z.array(z.string()).min(1).max(5),
      }),
    );

    const serialised = JSON.stringify(schema);
    for (const keyword of ['minLength', 'maxLength', 'minimum', 'maximum', 'minItems']) {
      expect(serialised, `${keyword} must not survive`).not.toContain(keyword);
    }
  });

  it('recurses into arrays of objects', () => {
    const schema = z.object({
      issues: z.array(z.object({ title: z.string(), line: z.number().optional() })),
    });
    const { absence } = convert(schema);

    const value = stripAbsent(
      {
        issues: [
          { title: 'a', line: null },
          { title: 'b', line: 3 },
        ],
      },
      absence,
    );
    expect(schema.safeParse(value).success).toBe(true);
    expect((value as { issues: object[] }).issues[0]).toEqual({ title: 'a' });
  });

  it('round-trips a schema with every shape an agent uses', () => {
    const schema = z.object({
      summary: z.string(),
      passed: z.boolean(),
      severity: z.enum(['critical', 'major', 'minor']),
      confidence: z.number().nullable(),
      hint: z.string().optional(),
      issues: z.array(
        z.object({
          title: z.string(),
          line: z.number().nullable(),
          category: z.string().optional(),
        }),
      ),
    });

    const { absence } = convert(schema);

    // What strict mode actually sends back: every key present, absences null.
    const response = {
      summary: 'ok',
      passed: true,
      severity: 'minor',
      confidence: null,
      hint: null,
      issues: [{ title: 'x', line: null, category: null }],
    };

    const parsed = schema.safeParse(stripAbsent(response, absence));
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(parsed.data).toEqual({
      summary: 'ok',
      passed: true,
      severity: 'minor',
      confidence: null,
      issues: [{ title: 'x', line: null }],
    });
  });

  it('refuses a $ref rather than sending an under-constrained schema', () => {
    expect(() => toStrictSchema({ $ref: '#/definitions/Thing' })).toThrow(/\$ref/);
  });
});

describe('every shipped agent contract', () => {
  // The conversion is only useful if it covers the schemas actually sent.
  // A new agent whose contract strict mode rejects would otherwise surface
  // as a 400 from OpenAI on the first real call, in production, mid-course.
  const isAgent = (value: unknown): value is { name: string; contract: z.ZodTypeAny } =>
    typeof value === 'object' &&
    value !== null &&
    'contract' in value &&
    'name' in value &&
    typeof (value as { contract: unknown }).contract === 'object';

  const agents = Object.entries(AGENTS as Record<string, unknown>).flatMap(([key, value]) =>
    isAgent(value) ? [[key, value] as const] : [],
  );

  it('finds the agents to check', () => {
    expect(agents.length).toBeGreaterThanOrEqual(14);
  });

  it.each(agents)('%s converts to a strict-legal schema', (_name, agent) => {
    const { schema } = convert(agent.contract);

    for (const node of objectNodes(schema)) {
      expect(node['additionalProperties'], JSON.stringify(node).slice(0, 200)).toBe(false);
      expect(new Set(node['required'] as string[])).toEqual(
        new Set(Object.keys((node['properties'] ?? {}) as object)),
      );
    }

    const serialised = JSON.stringify(schema);
    expect(serialised).not.toContain('"$ref"');
    for (const keyword of ['minLength', 'maxLength', 'minimum', 'maximum', 'minItems', 'format']) {
      expect(serialised, `${keyword} survived conversion`).not.toContain(`"${keyword}"`);
    }
  });
});
