import { z } from 'zod';

import { codeReviewSchema, type CodeReviewOutput } from '../contracts/index.js';
import type { AIProvider, CallContext, PromptSpec } from '../provider/ai-provider.port.js';

import { HARNESS_CONTRACT } from './exercise.agent.js';
import { PROMPT_VERSION } from './policy.js';

/**
 * Projects (§14) and the tech-lead review that grades them (§31).
 *
 * A project is the only thing that exercises composition. Isolated drills
 * never do, which is why `problemSolving` and `architecture` are otherwise
 * starved of evidence — you cannot demonstrate architecture in a function that
 * fits on one screen.
 */

export const projectStepSchema = z.object({
  title: z.string().min(1).max(120),
  requirements: z.string().min(20).max(1_500),
  /**
   * The previous step's reference solution, so the project accumulates rather
   * than restarting. Null on the first step.
   */
  starterCode: z.string().max(8_000).nullable(),
  referenceSolution: z.string().min(1).max(10_000),
  estimatedMinutes: z.number().int().min(5).max(90),
  testCases: z
    .array(
      z.object({
        name: z.string().min(1).max(120),
        hidden: z.boolean(),
        code: z.string().min(1).max(4_000),
      }),
    )
    .min(1)
    .max(6),
});

export const generatedProjectSchema = z.object({
  slug: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: z.string().min(1).max(160),
  /** The whole thing in one line, shown before any step is opened. */
  objective: z.string().min(20).max(400),
  requirements: z.string().min(20).max(2_000),
  difficulty: z.number().int().min(1).max(5),
  steps: z.array(projectStepSchema).min(2).max(5),
});

export type GeneratedProjectOutput = z.infer<typeof generatedProjectSchema>;

export interface ProjectGenerationInput {
  technologyName: string;
  /** The concepts this phase covered. The project must compose them. */
  concepts: readonly { name: string; description: string }[];
  difficulty: number;
  language: 'javascript' | 'typescript';
}

export const projectAgent = {
  name: 'curriculum' as const,
  promptVersion: PROMPT_VERSION,
  contract: generatedProjectSchema,

  buildPrompt(input: ProjectGenerationInput): PromptSpec {
    return {
      model: 'reasoning',
      temperature: 0.35,
      maxTokens: 3_500,
      messages: [
        {
          role: 'system',
          content: `You design a small project that makes an experienced engineer combine several concepts they have just practised in isolation.

${HARNESS_CONTRACT}

A project is built in ordered steps, each submitted and graded on its own:

- Step 1 establishes the core. Later steps add a real concern — validation,
  error handling, a second behaviour — the way requirements actually arrive.
- Each step's \`starterCode\` is the PREVIOUS step's \`referenceSolution\`, so the
  work accumulates instead of restarting. Step 1's starterCode is null.
- Each step's \`referenceSolution\` must pass that step's tests AND every earlier
  step's tests. It is executed against them and the project is discarded if it
  fails, so write the tests and the solution together.
- Every \`referenceSolution\` STARTS with \`export default\`. Tests reach it as
  \`solution\` and never by name.
- One self-contained module. No imports, no filesystem, no network, no build
  step, no decorators.

The point is composition, not volume. Two or three well-chosen steps beat five
thin ones, and a step that only renames something is wasted.`,
        },
        {
          role: 'user',
          content: [
            `Technology: ${input.technologyName}`,
            `Language: ${input.language}`,
            `Difficulty: ${input.difficulty}/5`,
            `Concepts this project must combine:\n${input.concepts
              .map((c) => `- ${c.name}: ${c.description}`)
              .join('\n')}`,
          ].join('\n\n'),
        },
      ],
    };
  },

  async run(
    provider: AIProvider,
    input: ProjectGenerationInput,
    context: Omit<CallContext, 'agent' | 'promptVersion'>,
  ): Promise<GeneratedProjectOutput> {
    const result = await provider.structured({
      prompt: projectAgent.buildPrompt(input),
      schema: generatedProjectSchema,
      schemaName: 'GeneratedProject',
      context: { ...context, agent: 'curriculum', promptVersion: PROMPT_VERSION },
    });

    return result.data;
  },
};

// -- Tech-lead review -------------------------------------------------------

export interface ProjectReviewInput {
  projectTitle: string;
  stepTitle: string;
  requirements: string;
  code: string;
  language: string;
  testsPassed: boolean;
  conceptNames: readonly string[];
}

const REVIEW_SYSTEM = `You are the tech lead reviewing a colleague's pull request. They are an experienced engineer deliberately rebuilding their ability to write code unaided.

The tests have already run; you are not re-deciding whether the code works. Your job is the part tests cannot see: structure, naming, error handling, edge cases, and whether this will still make sense in six months.

Rules:
- Do NOT rewrite their code. Name the problem, say why it matters, and stop. They fix it. That is the entire point of the exercise, and handing over a patch removes it.
- Be specific enough to act on. "Consider refactoring" is noise; "the retry loop swallows the original error, so a permanent failure looks like a timeout" is a review.
- Say what is genuinely good, briefly, and only if it is. Padding every review with praise makes the praise worthless.
- Rank by severity honestly. A nit is a nit; do not inflate it to look thorough.
- At most five issues. A review nobody finishes changes nothing.`;

export const projectReviewAgent = {
  name: 'reviewer' as const,
  promptVersion: PROMPT_VERSION,
  contract: codeReviewSchema,

  buildPrompt(input: ProjectReviewInput): PromptSpec {
    return {
      model: 'reasoning',
      temperature: 0.2,
      maxTokens: 2_000,
      messages: [
        { role: 'system', content: REVIEW_SYSTEM },
        {
          role: 'user',
          content: [
            `Project: ${input.projectTitle}`,
            `Step: ${input.stepTitle}`,
            `Requirements:\n${input.requirements}`,
            `Concepts being combined: ${input.conceptNames.join(', ')}`,
            `Tests: ${input.testsPassed ? 'all passing' : 'some failing'}`,
            `Submitted ${input.language}:\n\`\`\`\n${input.code}\n\`\`\``,
          ].join('\n\n'),
        },
      ],
    };
  },

  async run(
    provider: AIProvider,
    input: ProjectReviewInput,
    context: Omit<CallContext, 'agent' | 'promptVersion'>,
  ): Promise<CodeReviewOutput> {
    const result = await provider.structured({
      prompt: projectReviewAgent.buildPrompt(input),
      schema: codeReviewSchema,
      schemaName: 'CodeReview',
      context: { ...context, agent: 'reviewer', promptVersion: PROMPT_VERSION },
    });

    // A review that hands over the fix defeats the exercise. Fenced code is
    // stripped rather than the whole review discarded: the prose around it is
    // still worth reading.
    return {
      summary: result.data.summary,
      issues: result.data.issues.map((issue) => ({
        ...issue,
        explanation: issue.explanation.replace(
          /```[\s\S]*?```/g,
          '_(a suggested patch was removed — fixing it yourself is the point)_',
        ),
      })),
    };
  },
};
