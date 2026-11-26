import { Hub } from './hub';
import { clientIp, CONSOLE_HEADER, credentials, DEVICE_COOKIE, SESSION_COOKIE, sessionToken } from './http';
import { accessKeyFetcher } from './auth/access';
import { consoleUser, encodeConsoleIdentity } from './auth/console';
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

/** Largest request body from a phone, a referee device or Companion: a pairing, a sign-in or one command. */
const SMALL_BODY = 4 * 1024;
/** Largest console body: a pasted team list is the biggest thing race control sends. */
const CONSOLE_BODY = 1024 * 1024;

/**
 * The JSON object in the request body, `{}` when it is not one, or null when it is longer than
 * `limit` bytes. Nothing past the limit is read.
 */
async function body(request: Request, limit: number): Promise<Record<string, unknown> | null> {
  if (Number(request.headers.get('content-length') ?? 0) > limit) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (request.body) {
    const reader = request.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  }
  try {
    const bytes = new Uint8Array(size);
    let at = 0;
    for (const c of chunks) { bytes.set(c, at); at += c.byteLength; }
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const tooLarge = () => json({ ok: false, code: 'too_large', message: 'That request is too large.' }, 413);

/** A pairing code as the console shows it: 8 characters of the hub's alphabet (no I, O, 0 or 1). */
const PAIRING_CODE = /^[A-HJ-NP-Z2-9]{8}$/;

type HubStub = DurableObjectStub<Hub>;

/**
 * A request a page on another origin made in the browser: an `Origin` that is not this site's, or a
 * `Sec-Fetch-Site` of `cross-site` or `same-site`. The console's and the referee devices' credentials
 * are cookies, and SameSite cookies still travel from a sibling site (another weiss-audio.com host),
 * so every API route refuses these. No `Origin` (curl, Companion, a same-origin GET) passes.
 */
function crossOrigin(request: Request, url: URL): boolean {
  const origin = request.headers.get('origin');
  const site = request.headers.get('sec-fetch-site');
  return (origin !== null && origin !== url.origin) || site === 'cross-site' || site === 'same-site';
}

type AnyCommand = Parameters<Hub['command']>[1];

/** The `cmd` in a command request's body, or the response that refuses the request. */
async function commandIn(request: Request, limit: number): Promise<{ cmd: AnyCommand } | { refused: Response }> {
  const parsed = await body(request, limit);
  if (!parsed) return { refused: tooLarge() };
  const { cmd } = parsed;
  if (!cmd || typeof cmd !== 'object' || typeof (cmd as { type?: unknown }).type !== 'string') {
    return { refused: json({ ok: false, code: 'invalid', message: 'Missing command.' }, 400) };
  }
  return { cmd: cmd as AnyCommand };
}

/** The hub's answer to a command (`CommandAck`: never the event itself) as a response. */
const ackResponse = (ack: { ok: boolean; code?: string }): Response =>
  json(ack, ack.ok ? 200 : ack.code === 'rate_limited' ? 429 : 400);

async function runCommand(hub: HubStub, actor: Actor, request: Request): Promise<Response> {
  const read = await commandIn(request, CONSOLE_BODY);
  if ('refused' in read) return read.refused;
  // RPC return types are erased for unions with `unknown` members; the shape is CommandAck.
  return ackResponse((await hub.command(actor, read.cmd)) as { ok: boolean });
}

/**
 * The console's routes, the same under `/api/control` (Cloudflare Access) and `/api/emergency`
 * (emergency password). `route` is the path after that prefix; the caller has signed `actor` in.
 */
async function consoleRoute(route: string, request: Request, url: URL, hub: HubStub, actor: Actor, exp: number | null): Promise<Response> {
  const get = request.method === 'GET';
  if (route === '/ws') {
    const headers = new Headers(request.headers);
    headers.set(CONSOLE_HEADER, encodeConsoleIdentity({ label: actor.label, exp }));
    return hub.fetch(new Request(request, { headers }));
  }
  if (route === '/me' && get) return json({ role: actor.role, label: actor.label });
  if (route === '/command' && request.method === 'POST') return runCommand(hub, actor, request);
  if (route === '/events' && get) return json(await hub.listEvents());
  if (route === '/apikeys' && get) return json(await hub.listApiKeys());
  if (route === '/export' && get) {
    const asked = url.searchParams.get('format');
    const format = asked === 'csv' || asked === 'fairness' ? asked : 'json';
    const out = await hub.exportEvent(url.searchParams.get('event') ?? '', format);
    if (out === null) return json({ error: 'not_found' }, 404);
    return new Response(out, {
      headers: {
        'content-type': format === 'json' ? 'application/json' : 'text/csv',
        'content-disposition': `attachment; filename="${format === 'fairness' ? 'race-to-feed-fairness.csv' : `race-to-feed.${format}`}"`,
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

    if (crossOrigin(request, url)) return json({ error: 'cross_site' }, 403);

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
        const sent = await body(request, SMALL_BODY);
        if (!sent) return tooLarge();
        const { password } = sent;
        if (typeof password !== 'string') return json({ error: 'invalid' }, 400);
        const r = await hub.login(password, clientIp(request));
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
      const sent = await body(request, SMALL_BODY);
      if (!sent) return tooLarge();
      const { code, name } = sent;
      if (typeof code !== 'string') return json({ error: 'invalid' }, 400);
      // A code that cannot be one never reaches the hub.
      const pairingCode = code.trim().toUpperCase();
      if (!PAIRING_CODE.test(pairingCode)) return json({ error: 'invalid_code' }, 400);
      // Checked before the code is looked up, so a missing name never spends the code.
      // The name is shown to staff: one-space runs, no control or format characters.
      const refName = typeof name === 'string' ? name.replace(/\s+/gu, ' ').trim() : '';
      if (refName.length === 0 || refName.length > 40 || /[\p{Cc}\p{Cf}]/u.test(refName)) return json({ error: 'name_required' }, 400);
      const r = await hub.pair(pairingCode, refName, clientIp(request));
      if (!r.ok) return r.tooMany ? json({ error: 'too_many_attempts' }, 429) : json({ error: 'invalid_code' }, 400);
      return json({ ok: true, station: r.station }, 200, { 'set-cookie': setCookie(DEVICE_COOKIE, r.deviceToken, 30 * 24 * 60 * 60) });
    }

    // Referee devices (device cookie) and Companion (Bearer key) only; a session cookie signs no one in here.
    // The hub checks the credential and runs the command in one step, so a device or key revoked
    // while the request was on its way changes nothing.
    if (path === '/api/command' && post) {
      const cred = credentials(request);
      if (!cred.device && !cred.apiKey) return json({ error: 'unauthorized' }, 401);
      const read = await commandIn(request, SMALL_BODY);
      if ('refused' in read) return read.refused;
      const ack = (await hub.commandWith(cred, read.cmd)) as { ok: boolean } | null;
      return ack ? ackResponse(ack) : json({ error: 'unauthorized' }, 401);
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
