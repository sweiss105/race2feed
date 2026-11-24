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

/** Creates and activates an event with `teams` teams (A, B, C, …) on as many tables, setup locked. Returns the admin cookie. */
export async function lockedEvent(teams = 4): Promise<string> {
  const admin = await loginAdmin();
  const created = await command({ type: 'createEvent', name: 'Test', date: '2026-12-01', tableCount: teams }, { cookie: admin });
  await command({ type: 'activateEvent', eventId: created.body.reply.eventId }, { cookie: admin });
  const names = Array.from({ length: teams }, (_, i) => String.fromCharCode(65 + i));
  await command({ type: 'importTeams', csv: ['team,category', ...names.map((n) => `${n},X`)].join('\n') }, { cookie: admin });
  await command({ type: 'setGrandChampionship', enabled: false }, { cookie: admin });
  await command({ type: 'suggestSetup' }, { cookie: admin });
  const locked = await command({ type: 'lockSetup' }, { cookie: admin });
  if (locked.status !== 200) throw new Error(JSON.stringify(locked.body));
  return admin;
}

export interface Socket {
  ws: WebSocket;
  messages: any[];
  /** Resolves with the next message (after `since`) of the given type. */
  next(type: string, since?: number): Promise<any>;
  send(msg: unknown): void;
  closed: Promise<CloseEvent>;
}

export async function connect(opts: { cookie?: string; bearer?: string; role?: 'public'; query?: string } = {}): Promise<Socket> {
  const headers: Record<string, string> = { upgrade: 'websocket' };
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`;
  const res = await exports.default.fetch(`${BASE}/api/ws${opts.query ? `?${opts.query}` : opts.role ? `?role=${opts.role}` : ''}`, { headers });
  const ws = res.webSocket;
  if (!ws) throw new Error(`no websocket: ${res.status}`);
  ws.accept();
  const messages: any[] = [];
  const waiters: (() => void)[] = [];
  ws.addEventListener('message', (e) => {
    messages.push(JSON.parse(e.data as string));
    waiters.splice(0).forEach((w) => w());
  });
  const closed = new Promise<CloseEvent>((resolve) => ws.addEventListener('close', resolve));
  const next = (type: string, since = messages.length) =>
    new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${type}`)), 3000);
      const check = () => {
        const found = messages.slice(since).find((m) => m.type === type);
        if (found) { clearTimeout(timer); resolve(found); } else waiters.push(check);
      };
      check();
    });
  return { ws, messages, next, send: (msg) => ws.send(JSON.stringify(msg)), closed };
}

/** Sends a command over a socket and resolves with its ack. */
export async function wsCommand(s: Socket, cmd: unknown): Promise<any> {
  const id = crypto.randomUUID();
  const since = s.messages.length;
  s.send({ type: 'cmd', id, cmd });
  for (;;) {
    const ack = await s.next('ack', since);
    if (ack.id === id) return ack;
  }
}

export const settle = () => new Promise((r) => setTimeout(r, 50));

/** Sets the race control password, logs in, pairs a tablet for `station`. */
export async function controlAndReferee(admin: string, station = 1): Promise<{ control: string; device: string }> {
  await command({ type: 'setPassword', role: 'control', password: 'race-control-pw' }, { cookie: admin });
  const control = (await call('/api/login', { role: 'control', password: 'race-control-pw' }, { ip: '10.9.0.1' })).cookie!;
  const code = (await command({ type: 'createPairingCode', station }, { cookie: control })).body.reply.code;
  const device = (await call('/api/pair', { code, name: 'Ref' })).cookie!;
  return { control, device };
}
