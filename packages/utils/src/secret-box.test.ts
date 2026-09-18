import { describe, expect, it } from 'vitest';

import { decryptSecret, encryptSecret, lastFour, secretsMatch } from './secret-box.js';

const PASSPHRASE = 'a-sufficiently-long-test-passphrase';

describe('secret box', () => {
  it('round-trips a secret', () => {
    const key = 'sk-ant-api03-abcdefghijklmnop';
    expect(decryptSecret(encryptSecret(key, PASSPHRASE), PASSPHRASE)).toBe(key);
  });

  it('produces a different ciphertext every time', () => {
    // A fresh IV per encryption. Without it, two users with the same key
    // would have identical rows, which leaks that they are the same key.
    const a = encryptSecret('same-secret', PASSPHRASE);
    const b = encryptSecret('same-secret', PASSPHRASE);

    expect(a).not.toBe(b);
    expect(decryptSecret(a, PASSPHRASE)).toBe(decryptSecret(b, PASSPHRASE));
  });

  it('refuses the wrong passphrase rather than returning rubbish', () => {
    const stored = encryptSecret('sk-live-123', PASSPHRASE);
    expect(() => decryptSecret(stored, 'a-different-passphrase-entirely')).toThrow(/decrypt/i);
  });

  it('detects a tampered ciphertext', () => {
    // The whole reason for GCM over CBC. A flipped bit must fail loudly,
    // not decrypt to a plausible-looking string that gets sent to a vendor.
    const stored = encryptSecret('sk-live-123', PASSPHRASE);
    const parts = stored.split(':');
    const body = Buffer.from(parts[3]!, 'base64url');
    body[0] = body[0]! ^ 0xff;
    parts[3] = body.toString('base64url');

    expect(() => decryptSecret(parts.join(':'), PASSPHRASE)).toThrow(/decrypt/i);
  });

  it('rejects a passphrase too short to be worth anything', () => {
    expect(() => encryptSecret('x', 'short')).toThrow(/at least 16/);
  });

  it('rejects a stored value that is not in the expected format', () => {
    expect(() => decryptSecret('not-encrypted-at-all', PASSPHRASE)).toThrow(/format/i);
    expect(() => decryptSecret('v2:a:b:c', PASSPHRASE)).toThrow(/format/i);
  });

  it('shows only the tail of a key', () => {
    // The head of a vendor key identifies the vendor, not the key, and a
    // leading fragment of a secret is a head start on guessing the rest.
    expect(lastFour('sk-ant-api03-abcdB3kW')).toBe('B3kW');
    expect(lastFour('abc')).toBe('••••');
  });

  it('compares secrets without leaking length by early exit', () => {
    expect(secretsMatch('abcd', 'abcd')).toBe(true);
    expect(secretsMatch('abcd', 'abce')).toBe(false);
    expect(secretsMatch('abcd', 'abcde')).toBe(false);
  });
});
