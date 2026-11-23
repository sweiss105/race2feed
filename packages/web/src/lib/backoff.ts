export const MIN_DELAY_MS = 1000;
export const MAX_BASE_DELAY_MS = 30_000;

/**
 * Exponential backoff with jitter spread above a 1 s floor: a delay in
 * [1 s, 1 s + base), base doubling to 30 s. Spreading (rather than clamping) keeps
 * thousands of phones that dropped at the same instant from reconnecting together.
 */
export function nextDelay(attempt: number, random: () => number): number {
  const base = Math.min(MAX_BASE_DELAY_MS, MIN_DELAY_MS * 2 ** attempt);
  return Math.round(MIN_DELAY_MS + random() * base);
}
