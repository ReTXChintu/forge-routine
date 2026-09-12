import type {
  AIProvider,
  EmbedRequest,
  EmbedResult,
  GenerateRequest,
  GenerateResult,
  StreamChunk,
  StructuredRequest,
  StructuredResult,
} from '../ai-provider.port.js';

/**
 * Deterministic fake provider.
 *
 * NOT a second AI vendor. It exists so §32's structured-output, evaluation-consistency,
 * and prompt-regression suites can run offline, in CI, with no key and no flakiness.
 * It must never be constructed by application code — the factory refuses outside tests.
 */
export interface FakeResponse {
  /** Matched against the last user message. First match wins. */
  when?: RegExp;
  text?: string;
  data?: unknown;
}

export class FakeAIProvider implements AIProvider {
  readonly name = 'fake';

  public readonly calls: { agent: string; messages: string; schemaName?: string }[] = [];

  constructor(private readonly responses: FakeResponse[] = []) {}

  private match(req: GenerateRequest | StructuredRequest<unknown>): FakeResponse | undefined {
    const lastUser = [...req.prompt.messages].reverse().find((m) => m.role === 'user');
    const haystack = lastUser?.content ?? '';
    return this.responses.find((r) => !r.when || r.when.test(haystack));
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    this.calls.push({
      agent: req.context.agent,
      messages: req.prompt.messages.map((m) => m.content).join('\n'),
    });

    return {
      text: this.match(req)?.text ?? 'What have you tried so far?',
      usage: { promptTokens: 100, completionTokens: 20 },
      model: 'fake-model',
      latencyMs: 1,
    };
  }

  async *stream(req: GenerateRequest): AsyncIterable<StreamChunk> {
    const { text } = await this.generate(req);
    for (const word of text.split(' ')) {
      yield { delta: `${word} `, done: false };
    }
    yield { delta: '', done: true };
  }

  async structured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.calls.push({
      agent: req.context.agent,
      messages: req.prompt.messages.map((m) => m.content).join('\n'),
      schemaName: req.schemaName,
    });

    const candidate = this.match(req)?.data;
    if (candidate === undefined) {
      throw new Error(
        `FakeAIProvider has no canned response for schema "${req.schemaName}". ` +
          `Register one so the test asserts a known shape rather than a guess.`,
      );
    }

    // Parse rather than cast: a canned response that drifts from the contract must
    // fail the test loudly, which is most of the value of this fake.
    const parsed = req.schema.safeParse(candidate);
    if (!parsed.success) {
      throw new Error(
        `FakeAIProvider canned response for "${req.schemaName}" violates its own schema: ` +
          parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      );
    }

    return {
      data: parsed.data,
      usage: { promptTokens: 100, completionTokens: 50 },
      model: 'fake-model',
      latencyMs: 1,
      repairAttempts: 0,
    };
  }

  async embed(req: EmbedRequest): Promise<EmbedResult> {
    return {
      // Deterministic pseudo-embedding: stable across runs, distinct per input.
      vectors: req.inputs.map((input) => {
        const seed = [...input].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
        return Array.from({ length: 8 }, (_, i) => ((seed + i * 31) % 100) / 100);
      }),
      usage: { promptTokens: 10, completionTokens: 0 },
      model: 'fake-embedding',
    };
  }
}
