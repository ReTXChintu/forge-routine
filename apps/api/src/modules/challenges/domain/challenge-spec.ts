import { z } from 'zod';

/**
 * The kind-specific payload stored on `Exercise.challengeSpec`.
 *
 * Parsed at the boundary rather than trusted. The column is JSON, so the only
 * thing standing between a malformed row and a 500 in front of the user is
 * this file — and a challenge that fails to load is indistinguishable to them
 * from a product that is broken.
 */

export const systemDesignSpecSchema = z.object({
  kind: z.literal('SYSTEM_DESIGN'),
  brief: z.string().min(1),
  constraints: z.array(z.string().min(1)).default([]),
  /** A checklist for the reviewer. Never shown before submission. */
  expectedTopics: z.array(z.string().min(1)).default([]),
  /** Prompts shown alongside the brief — the shape of a good answer. */
  sections: z.array(z.string().min(1)).default([]),
});

export const incidentSpecSchema = z.object({
  kind: z.literal('INCIDENT'),
  scenario: z.string().min(1),
  /** Logs, metrics and alerts. Shown in full: the signal is always there. */
  telemetry: z.string().min(1),
  /** Withheld until the user has submitted a diagnosis (§13). */
  rootCause: z.string().min(1),
  /** What they should be asked to produce. */
  sections: z.array(z.string().min(1)).default([]),
});

const goalCheckSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('fileExists'), path: z.string() }),
  z.object({ kind: z.literal('fileAbsent'), path: z.string() }),
  z.object({ kind: z.literal('fileContains'), path: z.string(), text: z.string() }),
  z.object({ kind: z.literal('fileEquals'), path: z.string(), content: z.string() }),
  z.object({ kind: z.literal('fileMode'), path: z.string(), mode: z.number().int() }),
  z.object({ kind: z.literal('fileOwner'), path: z.string(), owner: z.string() }),
  z.object({ kind: z.literal('directoryExists'), path: z.string() }),
  z.object({ kind: z.literal('cwdIs'), path: z.string() }),
  z.object({ kind: z.literal('outputMatches'), pattern: z.string() }),
  z.object({ kind: z.literal('commandUsed'), pattern: z.string() }),
  z.object({ kind: z.literal('commandNotUsed'), pattern: z.string() }),
]);

/**
 * A terminal challenge is just a pointer at a curated scenario.
 *
 * `task` and `checks` may be denormalised here, but the scenario registry is
 * the source of truth and is read first. Requiring them was the original
 * mistake: the seed wrote only a slug and every terminal challenge silently
 * failed to parse, so five of them never appeared at all.
 */
export const terminalSpecSchema = z.object({
  kind: z.literal('TERMINAL'),
  scenarioSlug: z.string().min(1),
  task: z.string().min(1).optional(),
  checks: z.array(goalCheckSchema).optional(),
});

export const challengeSpecSchema = z.discriminatedUnion('kind', [
  systemDesignSpecSchema,
  incidentSpecSchema,
  terminalSpecSchema,
]);

export type SystemDesignSpec = z.infer<typeof systemDesignSpecSchema>;
export type IncidentSpec = z.infer<typeof incidentSpecSchema>;
export type TerminalSpec = z.infer<typeof terminalSpecSchema>;
export type ChallengeSpec = z.infer<typeof challengeSpecSchema>;

/**
 * Parses a stored spec, returning null rather than throwing.
 *
 * A single malformed row must not take down the list it appears in. The
 * caller filters it out and logs; the user sees one fewer challenge rather
 * than an error page.
 */
export function parseChallengeSpec(value: unknown): ChallengeSpec | null {
  const result = challengeSpecSchema.safeParse(value);
  return result.success ? result.data : null;
}
