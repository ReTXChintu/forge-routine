import { describe, expect, it } from 'vitest';

import { AIUnavailable, describeAIFailure } from './ai-provider.port.js';

/**
 * What a user reads when a key does not work.
 *
 * This is the only error in the product that a non-engineer is expected to
 * act on, so it is worth testing that the actionable sentence survives the
 * two layers it is buried under: our own wrapper, and the vendor's JSON.
 */
describe('describeAIFailure', () => {
  it('digs the vendor sentence out of a wrapped JSON envelope', () => {
    // Exactly what Gemini returns for a bad key, wrapped as the provider
    // wraps it. Before this existed the user saw only the outer message.
    const vendorError = new Error(
      JSON.stringify({
        error: {
          code: 400,
          message: 'API key not valid. Please pass a valid API key.',
          status: 'INVALID_ARGUMENT',
        },
      }),
    );

    const wrapped = new AIUnavailable('settings-test', vendorError);

    expect(wrapped.message).toBe('AI provider unavailable for agent "settings-test"');
    expect(describeAIFailure(wrapped)).toBe('API key not valid. Please pass a valid API key.');
  });

  it('handles a status line glued in front of the JSON', () => {
    const vendorError = new Error(
      '401 status code (no body) {"error":{"message":"Incorrect API key provided."}}',
    );

    expect(describeAIFailure(new AIUnavailable('settings-test', vendorError))).toBe(
      'Incorrect API key provided.',
    );
  });

  it('keeps a plain message when there is no JSON', () => {
    const wrapped = new AIUnavailable('settings-test', new Error('Connection timed out'));
    expect(describeAIFailure(wrapped)).toBe('Connection timed out');
  });

  it('reaches through more than one layer of cause', () => {
    const inner = new Error('{"error":{"message":"deepest"}}');
    const middle = new AIUnavailable('a', inner);
    const outer = new AIUnavailable('b', middle);

    expect(describeAIFailure(outer)).toBe('deepest');
  });

  it('surfaces our own explanation when there is no vendor at all', () => {
    // The routing provider throws this when a user has saved no key. It
    // is already a sentence, and must not be replaced by the wrapper.
    const wrapped = new AIUnavailable(
      'tutor',
      new Error('No AI provider is configured. Add a key in Settings → AI.'),
    );

    expect(describeAIFailure(wrapped)).toBe(
      'No AI provider is configured. Add a key in Settings → AI.',
    );
  });

  it('truncates rather than rendering a wall of text into a settings panel', () => {
    const wrapped = new AIUnavailable('x', new Error('y'.repeat(500)));
    const described = describeAIFailure(wrapped, 80);

    expect(described).toHaveLength(80);
    expect(described.endsWith('…')).toBe(true);
  });

  it('survives a cause cycle instead of looping forever', () => {
    const a = new Error('first');
    const b = new Error('second');
    (a as { cause?: unknown }).cause = b;
    (b as { cause?: unknown }).cause = a;

    expect(() => describeAIFailure(a)).not.toThrow();
  });

  it('falls back to something rather than an empty string', () => {
    expect(describeAIFailure(undefined)).toBe('Unknown error');
    expect(describeAIFailure(new Error(''))).toBe('Unknown error');
  });
});
