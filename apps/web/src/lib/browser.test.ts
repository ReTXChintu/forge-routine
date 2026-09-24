import { afterEach, describe, expect, it, vi } from 'vitest';

import { copyText, randomId } from './browser.js';

/**
 * These exist because of a real failure, not a hypothetical one.
 *
 * `crypto.randomUUID` and `navigator.clipboard` are secure-context-only.
 * The app is served over plain HTTP from an IP address, so both were
 * absent in the deployed build while working perfectly in development —
 * and every submit threw "crypto.randomUUID is not a function" before the
 * request left the page.
 *
 * So each test removes the API rather than trusting jsdom's defaults.
 */

const realCrypto = globalThis.crypto;

afterEach(() => {
  Object.defineProperty(globalThis, 'crypto', { value: realCrypto, configurable: true });
  vi.restoreAllMocks();
});

function setCrypto(value: unknown) {
  Object.defineProperty(globalThis, 'crypto', { value, configurable: true });
}

describe('randomId', () => {
  it('uses randomUUID when the page is a secure context', () => {
    setCrypto({ randomUUID: () => 'uuid-from-crypto' });
    expect(randomId()).toBe('uuid-from-crypto');
  });

  it('falls back to getRandomValues when randomUUID is missing', () => {
    // Exactly the deployed shape: plain HTTP has `crypto`, and
    // `getRandomValues` on it, but no `randomUUID`.
    setCrypto({
      getRandomValues: (array: Uint8Array) => {
        array.fill(0xab);
        return array;
      },
    });

    expect(randomId()).toBe('ab'.repeat(16));
  });

  it('still returns something when there is no crypto at all', () => {
    setCrypto(undefined);

    const id = randomId();
    expect(id.length).toBeGreaterThan(8);
    expect(id).not.toContain('undefined');
  });

  it('does not repeat itself', () => {
    setCrypto(realCrypto);
    const ids = new Set(Array.from({ length: 200 }, () => randomId()));
    expect(ids.size).toBe(200);
  });

  it('never throws, whatever crypto looks like', () => {
    // The original bug was a TypeError escaping into a mutationFn, which
    // React Query surfaced as an unhandled rejection.
    for (const shape of [undefined, {}, { randomUUID: null }, { getRandomValues: null }]) {
      setCrypto(shape);
      expect(() => randomId()).not.toThrow();
    }
  });
});

describe('copyText', () => {
  it('uses the clipboard API when it is there', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    expect(await copyText('hello')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('hello');
  });

  it('falls back to execCommand when the clipboard API is absent', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    const execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true });

    expect(await copyText('hello')).toBe(true);
    expect(execCommand).toHaveBeenCalledWith('copy');
  });

  it('reports failure rather than showing a tick for nothing', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    Object.defineProperty(document, 'execCommand', {
      value: () => {
        throw new Error('blocked');
      },
      configurable: true,
    });

    expect(await copyText('hello')).toBe(false);
  });

  it('leaves no stray textarea behind', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    Object.defineProperty(document, 'execCommand', { value: () => true, configurable: true });

    await copyText('hello');
    expect(document.querySelectorAll('textarea')).toHaveLength(0);
  });
});
