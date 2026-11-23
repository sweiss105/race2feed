export const LOCKOUT_WINDOW_MS = 300_000;
export const MAX_FAILURES = 5;

/** False once an IP has 5 failed logins within the last 5 minutes. */
export function loginAllowed(failureTimes: number[], now: number): boolean {
  return failureTimes.filter((t) => t > now - LOCKOUT_WINDOW_MS && t <= now).length < MAX_FAILURES;
}

/** Referee "last seen" is written at most once a minute, to keep storage writes low. */
export function shouldTouch(lastSeen: number | null, now: number): boolean {
  return lastSeen === null || now - lastSeen >= 60_000;
}
