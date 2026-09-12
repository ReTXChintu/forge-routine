/** Clamp to [min,max]. */
export function clamp(value: number, min = 0, max = 1): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** Clamp to the [0,1] unit range used by every score in the system. */
export function unit(value: number): number {
  return clamp(value, 0, 1);
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/**
 * Map a value onto [0,1] where `best` scores 1 and `worst` scores 0.
 * Handles the inverted case (worst > best) so "lower is better" metrics like
 * time-to-first-code use the same helper.
 */
export function normalise(value: number, best: number, worst: number): number {
  if (best === worst) return 1;
  return unit((value - worst) / (best - worst));
}

/**
 * Recency weight with a half-life in days: an attempt from `halfLifeDays` ago
 * counts half as much as one from today. Keeps the Independent Coding Score
 * tracking current ability rather than accumulated history.
 */
export function recencyWeight(ageDays: number, halfLifeDays = 30): number {
  if (ageDays <= 0) return 1;
  return Math.pow(0.5, ageDays / halfLifeDays);
}

export function weightedMean(
  entries: readonly { value: number; weight: number }[],
): number {
  const totalWeight = entries.reduce((sum, e) => sum + e.weight, 0);
  if (totalWeight === 0) return 0;
  return entries.reduce((sum, e) => sum + e.value * e.weight, 0) / totalWeight;
}

/** Round to `places` decimals without floating-point drift in the last digit. */
export function round(value: number, places = 4): number {
  const factor = Math.pow(10, places);
  return Math.round(value * factor) / factor;
}

/** Render a unit score as an integer percentage for display. */
export function toPercent(value: number | null): number | null {
  return value === null ? null : Math.round(unit(value) * 100);
}
