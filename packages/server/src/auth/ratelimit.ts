export const LOCKOUT_WINDOW_MS = 300_000;
export const MAX_FAILURES = 5;

/** False once an IP has 5 failed logins within the last 5 minutes. */
export function loginAllowed(failureTimes: number[], now: number): boolean {
  return failureTimes.filter((t) => t > now - LOCKOUT_WINDOW_MS && t <= now).length < MAX_FAILURES;
}
