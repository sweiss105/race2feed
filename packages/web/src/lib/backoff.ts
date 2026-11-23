export const MIN_DELAY_MS = 1000;
export const MAX_BASE_DELAY_MS = 30_000;

/** Exponential backoff with ±50 % jitter; capped before jitter, never under 1 s. */
export function nextDelay(attempt: number, random: () => number): number {
  const base = Math.min(MAX_BASE_DELAY_MS, MIN_DELAY_MS * 2 ** attempt);
  return Math.max(MIN_DELAY_MS, Math.round(base * (0.5 + random())));
}
