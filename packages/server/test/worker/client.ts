import { exports } from 'cloudflare:workers';

export const BASE = 'https://r2f.test';

export interface Reply { status: number; body: any; cookie: string | null }

/** Extracts `name=value` from a Set-Cookie header. */
export function cookieFrom(res: Response): string | null {
  const raw = res.headers.get('set-cookie');
  return raw ? raw.split(';')[0]! : null;
}

export async function call(path: string, body?: unknown, opts: { cookie?: string; bearer?: string; ip?: string } = {}): Promise<Reply> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`;
  if (opts.ip) headers['cf-connecting-ip'] = opts.ip;
  const res = await exports.default.fetch(`${BASE}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let parsed: unknown = text;
  try { parsed = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body: parsed, cookie: cookieFrom(res) };
}

export async function loginAdmin(ip = '10.0.0.1'): Promise<string> {
  const r = await call('/api/login', { role: 'admin', password: 'test-admin' }, { ip });
  if (!r.cookie) throw new Error(`admin login failed: ${r.status}`);
  return r.cookie;
}

export const command = (cmd: unknown, opts: { cookie?: string; bearer?: string } = {}) => call('/api/command', { cmd }, opts);

/** Creates and activates an event with 4 teams on 4 tables, setup locked. Returns the admin cookie. */
export async function lockedEvent(): Promise<string> {
  const admin = await loginAdmin();
  const created = await command({ type: 'createEvent', name: 'Test', date: '2026-12-01', tableCount: 4 }, { cookie: admin });
  await command({ type: 'activateEvent', eventId: created.body.reply.eventId }, { cookie: admin });
  await command({ type: 'importTeams', csv: 'team,category\nA,X\nB,X\nC,X\nD,X' }, { cookie: admin });
  await command({ type: 'setGrandChampionship', enabled: false }, { cookie: admin });
  await command({ type: 'suggestSetup' }, { cookie: admin });
  const locked = await command({ type: 'lockSetup' }, { cookie: admin });
  if (locked.status !== 200) throw new Error(JSON.stringify(locked.body));
  return admin;
}
