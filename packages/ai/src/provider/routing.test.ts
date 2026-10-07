import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  AIContractViolation,
  AIUnavailable,
  type AIProvider,
  type CallContext,
  type GenerateRequest,
} from './ai-provider.port.js';
import type { AIVendor } from './catalogue.js';
import { RoutingAIProvider, type ResolvedVendor } from './routing.provider.js';

/**
 * The chain: the user's local CLIs through the agent first, then each saved
 * key, moving on only when a vendor could not answer at all.
 */

const ctx: CallContext = { userId: 'u1', agent: 'test', promptVersion: 'v1' };
const req = (context: CallContext = ctx): GenerateRequest => ({
  prompt: { model: 'fast', messages: [{ role: 'user', content: 'hi' }] },
  context,
});

const entry = (vendor: AIVendor, extra: Partial<ResolvedVendor> = {}): ResolvedVendor => ({
  vendor,
  apiKey: `key-${vendor}`,
  modelFast: 'fast',
  modelReasoning: 'reasoning',
  embeddingModel: null,
  ...extra,
});

type Behaviour = 'answer' | 'unavailable' | 'contract';

/** A provider per vendor that answers, is unavailable, or breaks its contract. */
function harness(behaviour: Partial<Record<AIVendor, Behaviour>>) {
  const calls: { vendor: AIVendor; context: CallContext }[] = [];
  let builds = 0;

  const providerFor = (resolved: ResolvedVendor): AIProvider => {
    builds += 1;
    const act = async (context: CallContext) => {
      calls.push({ vendor: resolved.vendor, context });
      const mode = behaviour[resolved.vendor] ?? 'answer';
      if (mode === 'unavailable')
        throw new AIUnavailable(context.agent, new Error(`${resolved.vendor} down`));
      if (mode === 'contract') throw new AIContractViolation(context.agent, ['bad'], '{}');
    };

    return {
      name: resolved.vendor,
      async generate(request) {
        await act(request.context);
        return {
          text: resolved.vendor,
          usage: { promptTokens: 1, completionTokens: 1 },
          model: resolved.vendor,
          latencyMs: 0,
        };
      },
      async *stream(request) {
        await act(request.context);
        yield { delta: resolved.vendor, done: false };
        yield { delta: '', done: true };
      },
      async structured(request) {
        await act(request.context);
        return {
          data: { from: resolved.vendor } as never,
          usage: { promptTokens: 1, completionTokens: 1 },
          model: resolved.vendor,
          latencyMs: 0,
          repairAttempts: 0,
        };
      },
      async embed(request) {
        await act(request.context);
        return {
          vectors: [[1]],
          model: resolved.vendor,
          usage: { promptTokens: 1, completionTokens: 0 },
        } as never;
      },
      async listModels() {
        return [{ id: resolved.vendor, label: resolved.vendor }];
      },
    };
  };

  return { calls, builds: () => builds, providerFor };
}

describe('routing across the user’s vendors', () => {
  it('uses the first vendor that answers', async () => {
    const h = harness({});
    const routing = new RoutingAIProvider(
      async () => [entry('CLAUDE_CODE'), entry('GEMINI')],
      h.providerFor,
    );

    expect((await routing.generate(req())).text).toBe('CLAUDE_CODE');
    expect(h.calls.map((c) => c.vendor)).toEqual(['CLAUDE_CODE']);
  });

  it('falls through every unavailable vendor to the next saved key', async () => {
    const h = harness({ CLAUDE_CODE: 'unavailable', CODEX: 'unavailable' });
    const routing = new RoutingAIProvider(
      async () => [entry('CLAUDE_CODE'), entry('CODEX'), entry('GEMINI'), entry('OPENAI')],
      h.providerFor,
    );

    expect((await routing.generate(req())).text).toBe('GEMINI');
    expect(h.calls.map((c) => c.vendor)).toEqual(['CLAUDE_CODE', 'CODEX', 'GEMINI']);
  });

  it('surfaces the last failure when nobody answers', async () => {
    const h = harness({ CLAUDE_CODE: 'unavailable', GEMINI: 'unavailable' });
    const routing = new RoutingAIProvider(
      async () => [entry('CLAUDE_CODE'), entry('GEMINI')],
      h.providerFor,
    );

    const error = await routing.generate(req()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AIUnavailable);
    expect(String((error as AIUnavailable).cause)).toContain('GEMINI down');
  });

  it('does not spend a second vendor on an answer that broke its contract', async () => {
    const h = harness({ CODEX: 'contract' });
    const routing = new RoutingAIProvider(
      async () => [entry('CODEX'), entry('OPENAI')],
      h.providerFor,
    );

    await expect(
      routing.structured({
        prompt: req().prompt,
        schema: z.object({}),
        schemaName: 'x',
        context: ctx,
      }),
    ).rejects.toBeInstanceOf(AIContractViolation);
    expect(h.calls.map((c) => c.vendor)).toEqual(['CODEX']);
  });

  it('says how to get AI when the user has nothing at all', async () => {
    const routing = new RoutingAIProvider(async () => [], harness({}).providerFor);

    const error = await routing.generate(req()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AIUnavailable);
    expect(String((error as AIUnavailable).cause)).toContain('ForgeRoutine Agent');
  });

  it('keeps a pinned model only for the vendor it belongs to', async () => {
    const h = harness({ CLAUDE_CODE: 'unavailable' });
    const routing = new RoutingAIProvider(
      async () => [entry('CLAUDE_CODE', { keepsModelOverride: false }), entry('OPENAI')],
      h.providerFor,
    );

    await routing.generate(req({ ...ctx, modelOverride: 'gpt-5' }));

    expect(h.calls[0]!.context.modelOverride).toBeUndefined();
    expect(h.calls[1]!.context.modelOverride).toBe('gpt-5');
  });

  it('falls through a stream only before its first chunk', async () => {
    const h = harness({ CODEX: 'unavailable' });
    const routing = new RoutingAIProvider(
      async () => [entry('CODEX'), entry('GEMINI')],
      h.providerFor,
    );

    const text: string[] = [];
    for await (const chunk of routing.stream(req())) text.push(chunk.delta);

    expect(text.join('')).toBe('GEMINI');
  });

  it('falls through embeddings to a vendor that has them', async () => {
    const h = harness({ CLAUDE_CODE: 'unavailable' });
    const routing = new RoutingAIProvider(
      async () => [entry('CLAUDE_CODE'), entry('OPENAI')],
      h.providerFor,
    );

    const result = await routing.embed({ texts: ['x'], context: ctx } as never);
    expect(result.model).toBe('OPENAI');
  });

  it('caches key clients but builds agent entries fresh', async () => {
    const h = harness({});
    const executor = async () => ({ stdout: '', stderr: '', code: 0, answer: null });
    const routing = new RoutingAIProvider(async () => [entry('GEMINI')], h.providerFor);
    await routing.generate(req());
    await routing.generate(req());
    expect(h.builds()).toBe(1);

    const viaAgent = new RoutingAIProvider(
      async () => [entry('CODEX', { executor })],
      h.providerFor,
    );
    await viaAgent.generate(req());
    await viaAgent.generate(req());
    expect(h.builds()).toBe(3);
  });
});
