import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/**
 * Symmetric encryption for secrets held at rest — today, vendor API keys.
 *
 * AES-256-GCM rather than CBC: GCM authenticates as well as encrypts, so a
 * tampered ciphertext fails to decrypt instead of decrypting to plausible
 * rubbish that then gets sent to a vendor as somebody's key.
 *
 * The stored form is `v1:<iv>:<tag>:<ciphertext>`, all base64url. The version
 * prefix is there so the algorithm can be changed later without having to
 * guess what old rows were written with.
 */

const VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
/** 96 bits, the size GCM is defined for. */
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class SecretBoxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretBoxError';
  }
}

/**
 * Derives the 32-byte key from whatever the operator configured.
 *
 * SHA-256 of the passphrase, so the env var can be any length. This is not
 * a password hash and does not need to be slow: the input is a
 * high-entropy secret from a config file, not something a human chose, so
 * there is nothing for a slow KDF to defend against here.
 */
function deriveKey(passphrase: string): Buffer {
  if (passphrase.trim().length < 16) {
    throw new SecretBoxError(
      'ENCRYPTION_KEY must be at least 16 characters. Generate one with: openssl rand -base64 32',
    );
  }
  return createHash('sha256').update(passphrase, 'utf8').digest();
}

export function encryptSecret(plaintext: string, passphrase: string): string {
  const key = deriveKey(passphrase);
  const iv = randomBytes(IV_BYTES);

  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [VERSION, b64(iv), b64(tag), b64(ciphertext)].join(':');
}

export function decryptSecret(stored: string, passphrase: string): string {
  const parts = stored.split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new SecretBoxError('Stored secret is not in the expected format');
  }

  const [, ivPart, tagPart, cipherPart] = parts as [string, string, string, string];
  const key = deriveKey(passphrase);
  const tag = unb64(tagPart);

  if (tag.length !== TAG_BYTES) throw new SecretBoxError('Stored secret has a malformed tag');

  try {
    const decipher = createDecipheriv(ALGORITHM, key, unb64(ivPart));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(unb64(cipherPart)), decipher.final()]).toString('utf8');
  } catch {
    // Deliberately not forwarding the underlying error. It distinguishes a
    // wrong key from corrupt data, and that is a detail an attacker with
    // read access to the table would like to have.
    throw new SecretBoxError('Could not decrypt the stored secret — wrong ENCRYPTION_KEY?');
  }
}

/**
 * The last four characters, for telling two keys apart in a UI.
 *
 * Four, and only from the end. Vendor keys carry a recognisable prefix
 * (`sk-ant-`, `AIza`) that identifies the vendor but not the key, and
 * showing a leading fragment of a secret is how partial keys end up being
 * enough to guess the rest.
 */
export function lastFour(secret: string): string {
  const trimmed = secret.trim();
  return trimmed.length <= 4 ? '••••' : trimmed.slice(-4);
}

/** Constant-time compare, for anywhere a secret is checked rather than used. */
export function secretsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function b64(buffer: Buffer): string {
  return buffer.toString('base64url');
}

function unb64(value: string): Buffer {
  return Buffer.from(value, 'base64url');
}
