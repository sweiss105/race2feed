import { exports } from 'cloudflare:workers';

export const BASE = 'https://r2f.test';

export interface Reply { status: number; body: any; cookie: string | null }

/**
 * Who a request comes from. `api` is where console requests go (`/api/control` or `/api/emergency`);
 * without it, commands and sockets use `/api/command` and `/api/ws` (tablets, Companion, phones).
 */
export interface As { cookie?: string; bearer?: string; ip?: string; api?: string; headers?: Record<string, string> }

/** The console, signed in as the dev console user (`DEV_CONSOLE_USER` in the test bindings). */
export const CONSOLE: As = { api: '/api/control' };
export const DEV_USER = 'tester@example.com';
export const EMERGENCY_PASSWORD = 'test-emergency';

/** Extracts `name=value` from a Set-Cookie header. */
export function cookieFrom(res: Response): string | null {
  const raw = res.headers.get('set-cookie');
  return raw ? raw.split(';')[0]! : null;
}

export async function call(path: string, body?: unknown, opts: As = {}): Promise<Reply> {
  const headers: Record<string, string> = { 'content-type': 'application/json', ...opts.headers };
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`;
  if (opts.ip) headers['cf-connecting-ip'] = opts.ip;
  const res = await exports.default.fetch(path.startsWith('http') ? path : `${BASE}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let parsed: unknown = text;
  try { parsed = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body: parsed, cookie: cookieFrom(res) };
}

/** Signs in with the emergency password and returns the console for `/api/emergency`, with its session cookie. */
export async function emergencySignIn(ip = '10.9.0.1'): Promise<As & { cookie: string }> {
  const r = await call('/api/emergency/login', { password: EMERGENCY_PASSWORD }, { ip });
  if (!r.cookie) throw new Error(`emergency sign-in failed: ${r.status}`);
  return { api: '/api/emergency', cookie: r.cookie };
}

export const command = (cmd: unknown, opts: As = {}) => call(`${opts.api ?? '/api'}/command`, { cmd }, opts);

/** A console list or export (`/events`, `/apikeys`, `/export?…`) for the given console. */
export const consoleGet = (as: As, path: string) => call(`${as.api}${path}`, undefined, as);

/** Creates and activates an event with `teams` teams (A, B, C, …) on as many tables, setup locked. Returns the console. */
export async function lockedEvent(teams = 4, admin: As = CONSOLE): Promise<As> {
  const created = await command({ type: 'createEvent', name: 'Test', date: '2026-12-01', tableCount: teams }, admin);
  await command({ type: 'activateEvent', eventId: created.body.reply.eventId }, admin);
  const names = Array.from({ length: teams }, (_, i) => String.fromCharCode(65 + i));
  await command({ type: 'importTeams', csv: ['team,category', ...names.map((n) => `${n},X`)].join('\n') }, admin);
  await command({ type: 'setGrandChampionship', enabled: false }, admin);
  await command({ type: 'suggestSetup' }, admin);
  const locked = await command({ type: 'lockSetup' }, admin);
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

/** The raw upgrade response for a socket at `{api}/ws`. */
export function upgrade(opts: As & { role?: 'public'; query?: string; url?: string } = {}): Promise<Response> {
  const headers: Record<string, string> = { upgrade: 'websocket', ...opts.headers };
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`;
  const query = opts.query ? `?${opts.query}` : opts.role ? `?role=${opts.role}` : '';
  return exports.default.fetch(`${opts.url ?? BASE}${opts.api ?? '/api'}/ws${query}`, { headers });
}

export async function connect(opts: As & { role?: 'public'; query?: string } = {}): Promise<Socket> {
  const res = await upgrade(opts);
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

/** Pairs a tablet for `station` and returns its device cookie. */
export async function pairReferee(admin: As, station = 1): Promise<{ device: string }> {
  const code = (await command({ type: 'createPairingCode', station }, admin)).body.reply.code;
  const device = (await call('/api/pair', { code, name: 'Ref' })).cookie!;
  return { device };
}
