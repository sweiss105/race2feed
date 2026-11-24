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
