export const LOCKOUT_WINDOW_MS = 300_000;
export const MAX_FAILURES = 5;

/** False once an IP has 5 failed logins within the last 5 minutes. */
export function loginAllowed(failureTimes: number[], now: number): boolean {
  return failureTimes.filter((t) => t > now - LOCKOUT_WINDOW_MS && t <= now).length < MAX_FAILURES;
}

/**
 * Token buckets by key: each key may spend `burst` at once and earns `perSecond` back. Kept in memory;
 * idle keys are forgotten once the map grows.
 */
export class Budget {
  private buckets = new Map<string, { tokens: number; at: number }>();

  constructor(private burst: number, private perSecond: number, private maxKeys = 10_000) {}

  private level(key: string, now: number): number {
    const b = this.buckets.get(key);
    return b ? Math.min(this.burst, b.tokens + (Math.max(0, now - b.at) / 1000) * this.perSecond) : this.burst;
  }

  /** Whether `key` has anything left, without spending it. */
  has(key: string, now: number): boolean {
    return this.level(key, now) >= 1;
  }

  /** Spends one from `key`'s bucket; false (and nothing spent) when it is empty. */
  take(key: string, now: number): boolean {
    const tokens = this.level(key, now);
    if (tokens < 1) return false;
    if (!this.buckets.has(key) && this.buckets.size >= this.maxKeys) {
      for (const [k] of this.buckets) if (this.level(k, now) >= this.burst) this.buckets.delete(k);
      // Still full of keys in use: forget the oldest rather than grow without end.
      if (this.buckets.size >= this.maxKeys) this.buckets.delete(this.buckets.keys().next().value!);
    }
    this.buckets.set(key, { tokens: tokens - 1, at: now });
    return true;
  }
}

/** Referee "last seen" is written at most once a minute, to keep storage writes low. */
export function shouldTouch(lastSeen: number | null, now: number): boolean {
  return lastSeen === null || now - lastSeen >= 60_000;
}
