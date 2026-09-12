import {
  type ConceptDetailOutput,
  type ConceptOutlineOutput,
  type PrerequisiteProposalOutput,
  conceptDetailSchema,
  conceptOutlineSchema,
  prerequisiteProposalSchema,
} from '../contracts/index.js';
import type { AIProvider, CallContext, PromptSpec } from '../provider/ai-provider.port.js';

import { PROMPT_VERSION } from './policy.js';

/**
 * Curriculum generation (docs/curriculum-engine.md).
 *
 * Three separate calls rather than one. Asking a model to produce an entire
 * technology curriculum in a single response reliably yields shallow, uniform
 * output: every concept gets the same three bland objectives. Splitting plan
 * from expansion produces materially better depth per concept, and lets the
 * expansion step run concept-by-concept where the model can actually think
 * about one thing.
 */

const AUDIENCE = `You are designing curriculum for an experienced engineer who is deliberately rebuilding their ability to write code without AI assistance. They are not a beginner. They can read documentation. What they need is structure, and honest naming of the things that actually trip people up.

Avoid filler. "Introduction to X" and "X best practices" are not concepts. A concept is something a person can be shown, practise, and then be tested on.`;

// -- Stage 1: outline -------------------------------------------------------

export interface OutlineInput {
  technologyName: string;
  technologySlug: string;
  /** Technologies the user already has, so prerequisites can point at them. */
  existingTechnologies: readonly string[];
  targetConceptCount?: number;
}

export const outlineAgent = {
  name: 'curriculum' as const,
  promptVersion: PROMPT_VERSION,
  contract: conceptOutlineSchema,

  buildPrompt(input: OutlineInput): PromptSpec {
    const count = input.targetConceptCount ?? 10;

    return {
      model: 'reasoning',
      temperature: 0.3,
      maxTokens: 2_500,
      messages: [
        { role: 'system', content: AUDIENCE },
        {
          role: 'system',
          content: `Produce a concept outline for one technology: names, one-line descriptions, and difficulty only. No objectives, no exercises — those come later.

Rules:
- Order them the way someone should actually learn them: foundations first, each building on what came before.
- Around ${count} concepts. Fewer good ones beats more padded ones.
- Difficulty 1-5 relative to this technology, not to programming in general.
- Slugs are lowercase and hyphenated.
- Name the real thing. "Closures" not "Advanced Functions". "The Event Loop" not "Asynchronous Concepts".`,
        },
        {
          role: 'user',
          content: [
            `Technology: ${input.technologyName}`,
            input.existingTechnologies.length > 0
              ? `The learner is also studying: ${input.existingTechnologies.join(', ')}. Assume that context exists; do not re-teach it.`
              : '',
          ]
            .filter(Boolean)
            .join('\n'),
        },
      ],
    };
  },

  async run(
    provider: AIProvider,
    input: OutlineInput,
    context: Omit<CallContext, 'agent' | 'promptVersion'>,
  ): Promise<ConceptOutlineOutput> {
    const result = await provider.structured({
      prompt: outlineAgent.buildPrompt(input),
      schema: conceptOutlineSchema,
      schemaName: 'ConceptOutline',
      context: { ...context, agent: 'curriculum', promptVersion: PROMPT_VERSION },
    });

    return dedupeSlugs(result.data);
  },
};

/**
 * Two concepts sharing a slug would collide on the unique index and fail the
 * whole import, so the near-duplicate is dropped here rather than at the
 * database.
 */
function dedupeSlugs(outline: ConceptOutlineOutput): ConceptOutlineOutput {
  const seen = new Set<string>();
  return {
    concepts: outline.concepts.filter((c) => {
      if (seen.has(c.slug)) return false;
      seen.add(c.slug);
      return true;
    }),
  };
}

// -- Stage 2: concept detail ------------------------------------------------

export interface ConceptDetailInput {
  technologyName: string;
  conceptName: string;
  conceptDescription: string;
  difficulty: number;
}

export const conceptDetailAgent = {
  name: 'curriculum' as const,
  promptVersion: PROMPT_VERSION,
  contract: conceptDetailSchema,

  buildPrompt(input: ConceptDetailInput): PromptSpec {
    return {
      model: 'fast',
      temperature: 0.3,
      maxTokens: 1_200,
      messages: [
        { role: 'system', content: AUDIENCE },
        {
          role: 'system',
          content: `Expand one concept into learning objectives, coding patterns, and common mistakes.

- Objectives start with a verb and describe something observable. "Explain what a closure captures and when it is read", not "Understand closures".
- Coding patterns are the shapes that appear in real code.
- Common mistakes are the most important field. These become debugging exercises and the evaluator uses them to recognise a known failure mode in a user's code, so they must be specific and real — the thing an experienced engineer actually gets wrong at 5pm, not "forgetting semicolons".`,
        },
        {
          role: 'user',
          content: `Technology: ${input.technologyName}
Concept: ${input.conceptName}
Description: ${input.conceptDescription}
Difficulty: ${input.difficulty}/5`,
        },
      ],
    };
  },

  async run(
    provider: AIProvider,
    input: ConceptDetailInput,
    context: Omit<CallContext, 'agent' | 'promptVersion'>,
  ): Promise<ConceptDetailOutput> {
    const result = await provider.structured({
      prompt: conceptDetailAgent.buildPrompt(input),
      schema: conceptDetailSchema,
      schemaName: 'ConceptDetail',
      context: { ...context, agent: 'curriculum', promptVersion: PROMPT_VERSION },
    });

    return result.data;
  },
};

// -- Stage 3: prerequisites -------------------------------------------------

export interface PrerequisiteInput {
  technologySlug: string;
  technologyName: string;
  concepts: readonly { slug: string; name: string; description: string }[];
  /** `tech:slug` of concepts in other technologies this may depend on. */
  externalConcepts: readonly { qualifiedSlug: string; name: string }[];
}

export const prerequisiteAgent = {
  name: 'curriculum' as const,
  promptVersion: PROMPT_VERSION,
  contract: prerequisiteProposalSchema,

  buildPrompt(input: PrerequisiteInput): PromptSpec {
    const external =
      input.externalConcepts.length > 0
        ? `Concepts from other technologies the learner is studying, referenced as tech:slug:\n${input.externalConcepts
            .map((c) => `- ${c.qualifiedSlug} (${c.name})`)
            .join('\n')}`
        : '';

    return {
      model: 'reasoning',
      temperature: 0.1,
      maxTokens: 2_000,
      messages: [
        { role: 'system', content: AUDIENCE },
        {
          role: 'system',
          content: `Propose prerequisite edges between concepts.

- HARD means the concept is not learnable without the prerequisite.
- SOFT means it helps considerably but does not block.
- Cross-technology edges are valuable and encouraged: use the tech:slug form.
- Only direct prerequisites. If A needs B and B needs C, do not also state A needs C.
- Edges must form a directed acyclic graph. A cycle makes the planner non-terminating and the whole batch will be rejected.
- Be sparing. Every HARD edge you add is a gate the learner has to pass through, and an over-constrained graph is worse than a loose one.`,
        },
        {
          role: 'user',
          content: [
            `Technology: ${input.technologyName} (${input.technologySlug})`,
            `Concepts:\n${input.concepts.map((c) => `- ${c.slug}: ${c.name} — ${c.description}`).join('\n')}`,
            external,
          ]
            .filter(Boolean)
            .join('\n\n'),
        },
      ],
    };
  },

  async run(
    provider: AIProvider,
    input: PrerequisiteInput,
    context: Omit<CallContext, 'agent' | 'promptVersion'>,
  ): Promise<PrerequisiteProposalOutput> {
    const result = await provider.structured({
      prompt: prerequisiteAgent.buildPrompt(input),
      schema: prerequisiteProposalSchema,
      schemaName: 'PrerequisiteProposal',
      context: { ...context, agent: 'curriculum', promptVersion: PROMPT_VERSION },
    });

    const known = new Set(input.concepts.map((c) => c.slug));
    const external = new Set(input.externalConcepts.map((c) => c.qualifiedSlug));

    // A model will occasionally invent a prerequisite that does not exist.
    // Dropping the edge is right: the alternative is a foreign-key failure
    // that loses the entire generated technology.
    return {
      edges: result.data.edges.filter(
        (edge) =>
          known.has(edge.conceptSlug) &&
          edge.conceptSlug !== edge.prerequisiteSlug &&
          (known.has(edge.prerequisiteSlug) || external.has(edge.prerequisiteSlug)),
      ),
    };
  },
};
