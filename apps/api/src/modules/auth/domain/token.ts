/**
 * Auth domain. No framework imports, no Prisma, no HTTP (docs/architecture.md).
 */

export interface AccessTokenClaims {
  sub: string;
  email: string;
}

export interface RefreshTokenRecord {
  id: string;
  userId: string;
  tokenHash: string;
  familyId: string;
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
}

export type RefreshOutcome =
  | { kind: 'VALID'; record: RefreshTokenRecord }
  | { kind: 'UNKNOWN' }
  | { kind: 'EXPIRED' }
  | { kind: 'REVOKED' }
  /** The token was already used: someone is replaying a stolen token. */
  | { kind: 'REUSE_DETECTED'; familyId: string };

/**
 * Refresh tokens are single-use and rotate within a family.
 *
 * Presenting an already-used token means either an attacker has a stolen copy or
 * a legitimate client replayed one. We cannot tell which, so we revoke the whole
 * family: the cost is one forced re-login, and the alternative is leaving a live
 * session in an attacker's hands.
 */
export function classifyRefreshToken(record: RefreshTokenRecord | null, now: Date): RefreshOutcome {
  if (!record) return { kind: 'UNKNOWN' };
  if (record.usedAt !== null) return { kind: 'REUSE_DETECTED', familyId: record.familyId };
  if (record.revokedAt !== null) return { kind: 'REVOKED' };
  if (record.expiresAt.getTime() <= now.getTime()) return { kind: 'EXPIRED' };
  return { kind: 'VALID', record };
}

/** Parses the `15m` / `30d` duration strings used in configuration. */
export function parseDuration(value: string): number {
  const match = /^(\d+)([smhd])$/.exec(value);
  if (!match) throw new Error(`Invalid duration: ${value}`);

  const amount = Number(match[1]);
  const unit = match[2];
  const multipliers: Record<string, number> = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };

  const multiplier = multipliers[unit as string];
  if (multiplier === undefined) throw new Error(`Invalid duration unit: ${unit}`);

  return amount * multiplier;
}
