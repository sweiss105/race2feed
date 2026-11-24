import type { Env } from '../worker';
import { verifyAccessJwt } from './access';

/** The production hostname, where only Cloudflare Access can sign the console in. */
export const PRODUCTION_HOST = 'r2f.weiss-audio.com';

export type ConsoleUser = { label: string; exp: number | null } | { error: 'access_not_configured' | 'unauthorized' };

/**
 * Who is using the console on `/api/control/*`: the email in the Access token (with its expiry, in
 * milliseconds), or `DEV_CONSOLE_USER` (no expiry) for local development and tests, never on the
 * production hostname. Missing Access settings refuse everything.
 */
export async function consoleUser(request: Request, env: Env, deps: { now: number; fetchKeys(): Promise<JsonWebKey[]> }): Promise<ConsoleUser> {
  const host = new URL(request.url).hostname.replace(/\.$/, '');
  if (env.DEV_CONSOLE_USER && host !== PRODUCTION_HOST) return { label: env.DEV_CONSOLE_USER, exp: null };
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return { error: 'access_not_configured' };
  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token) return { error: 'unauthorized' };
  const verified = await verifyAccessJwt(token, { teamDomain: env.ACCESS_TEAM_DOMAIN, aud: env.ACCESS_AUD, now: deps.now, fetchKeys: deps.fetchKeys });
  return verified ? { label: verified.email, exp: verified.exp } : { error: 'unauthorized' };
}

export interface ConsoleIdentity { label: string; exp: number | null }

/** The value of the header the Worker uses to tell the hub who a console socket belongs to. URI-encoded, as a header value may only hold Latin-1. */
export function encodeConsoleIdentity(who: ConsoleIdentity): string {
  return encodeURIComponent(JSON.stringify({ label: who.label, exp: who.exp }));
}

/** The identity in that header, or null when it is missing or does not decode to a `{ label, exp }`. */
export function decodeConsoleIdentity(value: string | null): ConsoleIdentity | null {
  if (!value) return null;
  try {
    const v = JSON.parse(decodeURIComponent(value)) as { label?: unknown; exp?: unknown } | null;
    if (!v || typeof v !== 'object') return null;
    if (typeof v.label !== 'string' || v.label === '' || !(v.exp === null || typeof v.exp === 'number')) return null;
    return { label: v.label, exp: v.exp };
  } catch {
    return null;
  }
}
