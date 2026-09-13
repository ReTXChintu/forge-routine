import { type GeneratedExerciseSetOutput, generatedExerciseSetSchema } from '../contracts/index.js';
import type { AIProvider, CallContext, PromptSpec } from '../provider/ai-provider.port.js';

import { PROMPT_VERSION } from './policy.js';

/**
 * Generates coding and debugging exercises for one concept.
 *
 * Unlike every other agent, this one produces code that will actually be
 * executed — the test cases run in the sandbox, and the reference solution is
 * run against them before anything is persisted. The prompt therefore has to
 * describe the harness contract exactly, because a plausible-looking test that
 * does not match it produces a HARNESS_ERROR the user cannot act on.
 */

/**
 * The exact environment a test case body runs in. Kept as one constant so the
 * prompt and packages/sandbox cannot drift apart silently.
 */
const HARNESS_CONTRACT = `Each test case \`code\` is the BODY of an async function with exactly three things in scope:

  solution  — the user's default export
  assert    — assert.equal(received, expected, message?)
              assert.deepEqual(received, expected, message?)
              assert.ok(value, message?)
              assert.throws(fn, expectedMessageSubstring?)
              await assert.rejects(asyncFn, expectedMessageSubstring?)
  helpers   — await helpers.sleep(ms)
              helpers.mockRes()  → an Express-like response double exposing
                                   status(code), json(body), send(body), end(),
                                   setHeader(k,v), and readable .statusCode / .body
                                   (.statusCode is null until something sets it)

Rules for test code:
- It is a function body. Do NOT write a function wrapper, imports, exports, describe or it blocks.
- \`await\` is allowed at the top level of the body.
- Failure is signalled by throwing, which the assert helpers do for you.
- Nothing else is in scope. No require, no import, no fs, no network, no test framework.
- Timers are real. Keep any sleep under 150ms; the whole run is killed at 5 seconds.`;

export interface ExerciseGenerationInput {
  technologyName: string;
  conceptName: string;
  conceptDescription: string;
  difficulty: number;
  learningObjectives: readonly string[];
  commonMistakes: readonly string[];
  language: 'javascript' | 'typescript';
  /** Slugs already used on this concept, so a regeneration does not collide. */
  existingSlugs: readonly string[];
  /** Ask for a DEBUGGING exercise built from one of the common mistakes. */
  includeDebugging?: boolean;
}

export const exerciseAgent = {
  name: 'curriculum' as const,
  promptVersion: PROMPT_VERSION,
  contract: generatedExerciseSetSchema,

  buildPrompt(input: ExerciseGenerationInput): PromptSpec {
    const debugging = input.includeDebugging
      ? `\nInclude one DEBUGGING exercise. For it, \`referenceSolution\` is the REPAIRED code, and \`starterCode\` is the broken version the learner sees. Base the fault on one of the common mistakes listed below — a real fault, not a syntax error.`
      : '';

    return {
      model: 'reasoning',
      temperature: 0.35,
      maxTokens: 3_000,
      messages: [
        {
          role: 'system',
          content: `You write exercises for an experienced engineer rebuilding their ability to write code unaided. The exercise must be something they write from scratch and a machine can grade.

${HARNESS_CONTRACT}

The single most common failure is forgetting the default export, so get this
right first. A solution and its tests always look like this shape:

  referenceSolution:
    export default function rateLimit(max) {
      let count = 0;
      return () => (count += 1) <= max;
    }

  a test case code:
    const limiter = solution(2);
    assert.equal(limiter(), true);
    assert.equal(limiter(), true);
    assert.equal(limiter(), false, 'third call is over the limit');

Note what that shows:
- \`referenceSolution\` STARTS with \`export default\`. Not a bare function, not a
  named export, not a class declared without export. If it does not start with
  \`export default\`, the exercise is thrown away.
- Tests call \`solution\`. They never reference the function by the name you gave
  it — \`rateLimit\` is not in scope inside a test, only \`solution\` is.
- No imports, no module wrapper, no namespace, no \`declare\`, no tsconfig.

Every exercise must satisfy all of this:
- The user's solution is a module with a DEFAULT export. Tests reach it as \`solution\`.
- \`referenceSolution\` is a complete, correct implementation that passes every test case you write. It will be executed against them, and the exercise is discarded if it fails. Write the tests and the solution together and check them against each other.
- \`objective\` is the entire prompt at the hardest assistance level, so it must make sense with nothing else on screen. One sentence, imperative.
- At least one test case must be hidden. Visible-only tests let someone pattern-match to green without generalising.
- Test the behaviour that actually matters, including the edge case the common mistakes point at. Do not test trivia.
- \`staticHints\` are QUESTIONS that narrow the search, never answers, and never code.
- Prefer pure functions and small classes. No I/O, no network, no filesystem, no timers longer than 150ms.
- Nothing that needs a build step or a config file: no decorators, no namespaces, no ambient declarations, no module resolution. If a concept cannot be exercised as one self-contained module, write a simpler exercise that touches the same idea.${debugging}`,
        },
        {
          role: 'user',
          content: [
            `Technology: ${input.technologyName}`,
            `Concept: ${input.conceptName} — ${input.conceptDescription}`,
            `Difficulty: ${input.difficulty}/5`,
            `Language: ${input.language}`,
            input.learningObjectives.length > 0
              ? `Objectives:\n${input.learningObjectives.map((o) => `- ${o}`).join('\n')}`
              : '',
            input.commonMistakes.length > 0
              ? `Common mistakes to target:\n${input.commonMistakes.map((m) => `- ${m}`).join('\n')}`
              : '',
            input.existingSlugs.length > 0
              ? `Slugs already taken, do not reuse: ${input.existingSlugs.join(', ')}`
              : '',
            `Produce ${input.includeDebugging ? '2' : '1'} exercise(s).`,
          ]
            .filter(Boolean)
            .join('\n\n'),
        },
      ],
    };
  },

  async run(
    provider: AIProvider,
    input: ExerciseGenerationInput,
    context: Omit<CallContext, 'agent' | 'promptVersion'>,
  ): Promise<GeneratedExerciseSetOutput> {
    const result = await provider.structured({
      prompt: exerciseAgent.buildPrompt(input),
      schema: generatedExerciseSetSchema,
      schemaName: 'GeneratedExerciseSet',
      context: { ...context, agent: 'curriculum', promptVersion: PROMPT_VERSION },
    });

    const taken = new Set(input.existingSlugs);

    return {
      exercises: result.data.exercises.filter((exercise) => {
        if (taken.has(exercise.slug)) return false;
        taken.add(exercise.slug);
        return true;
      }),
    };
  },
};

export { HARNESS_CONTRACT };
