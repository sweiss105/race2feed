import { Hub } from './hub';
import { CONSOLE_HEADER, credentials, DEVICE_COOKIE, SESSION_COOKIE, sessionToken } from './http';
import { accessKeyFetcher } from './auth/access';
import { consoleUser } from './auth/console';
import type { Actor } from './core/model';

export { Hub };

export interface Env {
  HUB: DurableObjectNamespace<Hub>;
  ASSETS: Fetcher;
  /** Cloudflare Access team domain and application audience tag; without both the console is refused. */
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  /** Secret. When unset, every `/api/emergency/*` route is 404. */
  EMERGENCY_PASSWORD?: string;
  /** Local development and tests only: console requests are signed in as this name, except on the production hostname. */
  DEV_CONSOLE_USER?: string;
}


export const json = (body: unknown, status = 200, headers: HeadersInit = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const setCookie = (name: string, value: string, maxAgeSeconds: number) =>
  `${name}=${value}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAgeSeconds}`;

async function body(request: Request): Promise<Record<string, unknown>> {
  try {
    const parsed = await request.json();
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

type HubStub = DurableObjectStub<Hub>;

/**
 * A request another site's page made in the browser: an `Origin` that is not this site's, or
 * `Sec-Fetch-Site: cross-site`. The console's credentials are cookies (Access's and the emergency
 * session), so console routes refuse these. No `Origin` (curl, a same-origin navigation) passes.
 */
function crossSite(request: Request, url: URL): boolean {
  const origin = request.headers.get('origin');
  return (origin !== null && origin !== url.origin) || request.headers.get('sec-fetch-site') === 'cross-site';
}

async function runCommand(hub: HubStub, actor: Actor, request: Request): Promise<Response> {
  const { cmd } = await body(request);
  if (!cmd || typeof cmd !== 'object' || typeof (cmd as { type?: unknown }).type !== 'string') {
    return json({ ok: false, code: 'invalid', message: 'Missing command.' }, 400);
  }
  // RPC return types are erased for unions with `unknown` members; the shape is CommandResult.
  const result = (await hub.command(actor, cmd as Parameters<Hub['command']>[1])) as { ok: boolean };
  return json(result, result.ok ? 200 : 400);
}

/**
 * The console's routes, the same under `/api/control` (Cloudflare Access) and `/api/emergency`
 * (emergency password). `route` is the path after that prefix; the caller has signed `actor` in.
 */
async function consoleRoute(route: string, request: Request, url: URL, hub: HubStub, actor: Actor, exp: number | null): Promise<Response> {
  const get = request.method === 'GET';
  if (route === '/ws') {
    const headers = new Headers(request.headers);
    headers.set(CONSOLE_HEADER, JSON.stringify({ label: actor.label, exp }));
    return hub.fetch(new Request(request, { headers }));
  }
  if (route === '/me' && get) return json({ role: actor.role, label: actor.label });
  if (route === '/command' && request.method === 'POST') return runCommand(hub, actor, request);
  if (route === '/events' && get) return json(await hub.listEvents());
  if (route === '/apikeys' && get) return json(await hub.listApiKeys());
  if (route === '/export' && get) {
    const format = url.searchParams.get('format') === 'csv' ? 'csv' : 'json';
    const out = await hub.exportEvent(url.searchParams.get('event') ?? '', format);
    if (out === null) return json({ error: 'not_found' }, 404);
    return new Response(out, {
      headers: {
        'content-type': format === 'csv' ? 'text/csv' : 'application/json',
        'content-disposition': `attachment; filename="race-to-feed.${format}"`,
      },
    });
  }
  return json({ error: 'not_found' }, 404);
}

export default {
  async fetch(incoming, env): Promise<Response> {
    // Only this Worker may say who a console socket belongs to: never pass on a caller's own header.
    const headers = new Headers(incoming.headers);
    headers.delete(CONSOLE_HEADER);
    const request = new Request(incoming, { headers });

    const url = new URL(request.url);
    const path = url.pathname;
    if (!path.startsWith('/api/')) return env.ASSETS.fetch(request);
    const hub = env.HUB.getByName('hub');
    const post = request.method === 'POST';

    if (path === '/api/health') return json({ ok: true });

    if ((path.startsWith('/api/control/') || path.startsWith('/api/emergency/')) && crossSite(request, url)) {
      return json({ error: 'cross_site' }, 403);
    }

    if (path.startsWith('/api/control/')) {
      const now = Date.now();
      const user = await consoleUser(request, env, { now, fetchKeys: accessKeyFetcher(env.ACCESS_TEAM_DOMAIN ?? '', now) });
      if ('error' in user) return json({ error: user.error }, user.error === 'access_not_configured' ? 503 : 401);
      return consoleRoute(path.slice('/api/control'.length), request, url, hub, { role: 'admin', label: user.label }, user.exp);
    }

    if (path.startsWith('/api/emergency/')) {
      if (!env.EMERGENCY_PASSWORD) return json({ error: 'not_found' }, 404);
      const route = path.slice('/api/emergency'.length);
      if (route === '/login' && post) {
        const { password } = await body(request);
        if (typeof password !== 'string') return json({ error: 'invalid' }, 400);
        const ip = request.headers.get('cf-connecting-ip') ?? 'local';
        const r = await hub.login(password, ip);
        if (!r.ok) return json({ error: r.status === 429 ? 'too_many_attempts' : 'invalid_login' }, r.status);
        return json({ ok: true, role: 'admin' }, 200, { 'set-cookie': setCookie(SESSION_COOKIE, r.token, 12 * 60 * 60) });
      }
      const session = sessionToken(request);
      if (route === '/logout' && post) {
        if (session) await hub.logout(session);
        return json({ ok: true }, 200, { 'set-cookie': setCookie(SESSION_COOKIE, '', 0) });
      }
      const actor = session ? await hub.authenticate({ session }) : null;
      if (actor?.role !== 'admin') return json({ error: 'unauthorized' }, 401);
      return consoleRoute(route, request, url, hub, actor, null);
    }

    if (path === '/api/ws') return hub.fetch(request);

    if (path === '/api/pair' && post) {
      const { code, name } = await body(request);
      if (typeof code !== 'string') return json({ error: 'invalid' }, 400);
      // Checked before the code is looked up, so a missing name never spends the code.
      // The name is shown to staff: one-space runs, no control or format characters.
      const refName = typeof name === 'string' ? name.replace(/\s+/gu, ' ').trim() : '';
      if (refName.length === 0 || refName.length > 40 || /[\p{Cc}\p{Cf}]/u.test(refName)) return json({ error: 'name_required' }, 400);
      const r = await hub.pair(code, refName);
      if (!r.ok) return json({ error: 'invalid_code' }, 400);
      return json({ ok: true, station: r.station }, 200, { 'set-cookie': setCookie(DEVICE_COOKIE, r.deviceToken, 30 * 24 * 60 * 60) });
    }

    // Referee tablets (device cookie) and Companion (Bearer key) only; a session cookie signs no one in here.
    if (path === '/api/command' && post) {
      const actor = await hub.authenticate(credentials(request));
      if (!actor) return json({ error: 'unauthorized' }, 401);
      return runCommand(hub, actor, request);
    }

    if (path === '/api/me' && request.method === 'GET') {
      const cred = credentials(request);
      // `?as=referee`: the referee page answers from the device pairing only.
      const me = await hub.whoAmI(url.searchParams.get('as') === 'referee' ? (cred.device ? { device: cred.device } : {}) : cred);
      return me ? json(me) : json({ error: 'unauthorized' }, 401);
    }

    return json({ error: 'not_found' }, 404);
  },
} satisfies ExportedHandler<Env>;
