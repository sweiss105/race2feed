import { Hub } from './hub';
import { credentials, DEVICE_COOKIE, SESSION_COOKIE } from './http';

export { Hub };

export interface Env {
  HUB: DurableObjectNamespace<Hub>;
  ASSETS: Fetcher;
  ADMIN_PASSWORD: string;
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

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    if (!path.startsWith('/api/')) return env.ASSETS.fetch(request);
    const hub = env.HUB.getByName('hub');
    const post = request.method === 'POST';

    if (path === '/api/health') return json({ ok: true });

    if (path === '/api/ws') return hub.fetch(request);

    if (path === '/api/login' && post) {
      const { password } = await body(request);
      if (typeof password !== 'string') return json({ error: 'invalid' }, 400);
      const ip = request.headers.get('cf-connecting-ip') ?? 'local';
      const r = await hub.login(password, ip);
      if (!r.ok) return json({ error: r.status === 429 ? 'too_many_attempts' : 'invalid_login' }, r.status);
      return json({ ok: true, role: 'admin' }, 200, { 'set-cookie': setCookie(SESSION_COOKIE, r.token, 12 * 60 * 60) });
    }

    if (path === '/api/logout' && post) {
      const { session } = credentials(request);
      if (session) await hub.logout(session);
      return json({ ok: true }, 200, { 'set-cookie': setCookie(SESSION_COOKIE, '', 0) });
    }

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

    if (path === '/api/command' && post) {
      const actor = await hub.authenticate(credentials(request));
      if (!actor) return json({ error: 'unauthorized' }, 401);
      const { cmd } = await body(request);
      if (!cmd || typeof cmd !== 'object' || typeof (cmd as { type?: unknown }).type !== 'string') {
        return json({ ok: false, code: 'invalid', message: 'Missing command.' }, 400);
      }
      // RPC return types are erased for unions with `unknown` members; the shape is CommandResult.
      const result = (await hub.command(actor, cmd as Parameters<Hub['command']>[1])) as { ok: boolean };
      return json(result, result.ok ? 200 : 400);
    }

    if (path === '/api/me' && request.method === 'GET') {
      const cred = credentials(request);
      // `?as=referee`: the referee page answers from the device pairing only.
      const me = await hub.whoAmI(url.searchParams.get('as') === 'referee' ? (cred.device ? { device: cred.device } : {}) : cred);
      return me ? json(me) : json({ error: 'unauthorized' }, 401);
    }

    if ((path === '/api/events' || path === '/api/apikeys') && request.method === 'GET') {
      const actor = await hub.authenticate(credentials(request));
      if (actor?.role !== 'admin') return json({ error: 'unauthorized' }, 401);
      return json(path === '/api/events' ? await hub.listEvents() : await hub.listApiKeys());
    }

    if (path === '/api/export' && request.method === 'GET') {
      const actor = await hub.authenticate(credentials(request));
      if (actor?.role !== 'admin') return json({ error: 'unauthorized' }, 401);
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
  },
} satisfies ExportedHandler<Env>;
