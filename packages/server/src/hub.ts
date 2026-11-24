import { DurableObject } from 'cloudflare:workers';
import type { Env } from './worker';
import { applyCommand } from './core/apply';
import { fail, newEvent, type Actor, type Command, type CommandResult, type LiveEvent } from './core/model';
import { derive } from './core/results';
import { backfillLineups } from './core/lineups';
import { eventCsv } from './core/export';
import { companionView, controlView, publicRoundUpdate, publicView, refereeView } from './core/views';
import { needsSnapshot } from './core/broadcast';
import { autoFinishDelay, nextAlarm } from './core/autofinish';
import { credentials, hasCredentials, type Credentials } from './http';
import { hashPassword, randomToken, sha256Hex, verifyPassword, type StoredPassword } from './auth/crypto';
import { LOCKOUT_WINDOW_MS, loginAllowed, shouldTouch } from './auth/ratelimit';

export type HubCommand =
  | { type: 'createEvent'; name: string; date: string; tableCount: number }
  | { type: 'activateEvent'; eventId: string }
  | { type: 'endEvent'; eventId: string }
  | { type: 'setPassword'; role: 'admin' | 'control'; password: string }
  | { type: 'createApiKey'; label: string }
  | { type: 'revokeApiKey'; id: string }
  | { type: 'createPairingCode'; station: number }
  | { type: 'revokeDevice'; deviceId: string };

export type { Credentials };

/** Hashed credentials only: raw tokens never sit in socket attachments. */
interface CredentialHashes { session?: string; device?: string; apiKey?: string }
interface Attachment { actor: Actor; cred: CredentialHashes }

async function hashCredentials(cred: Credentials): Promise<CredentialHashes> {
  return {
    ...(cred.session ? { session: await sha256Hex(cred.session) } : {}),
    ...(cred.device ? { device: await sha256Hex(cred.device) } : {}),
    ...(cred.apiKey ? { apiKey: await sha256Hex(cred.apiKey) } : {}),
  };
}

const PUBLIC: Actor = { role: 'public', label: 'public' };
const PUBLIC_INTERVAL_MS = 1000;
const AUTO_FINISH: Actor = { role: 'admin', label: 'auto-finish' };

const tagFor = (a: Actor) =>
  a.role === 'admin' || a.role === 'control' ? 'control' : a.role === 'referee' ? `referee:${a.station}` : a.role;

const SESSION_MS = 12 * 60 * 60 * 1000;
/** `{name} (station n)`; a device stored before names existed (label `Station n`) keeps `referee station n`. */
function refereeLabel(name: string | null, station: number): string {
  return !name || name === `Station ${station}` ? `referee station ${station}` : `${name} (station ${station})`;
}

const PAIRING_MS = 10 * 60 * 1000;
const PAIRING_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const HUB_COMMANDS: Record<HubCommand['type'], Actor['role'][]> = {
  createEvent: ['admin'],
  activateEvent: ['admin'],
  endEvent: ['admin'],
  setPassword: ['admin'],
  createApiKey: ['admin'],
  revokeApiKey: ['admin'],
  createPairingCode: ['admin', 'control'],
  revokeDevice: ['admin', 'control'],
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, name TEXT, created_at INTEGER, active INTEGER NOT NULL DEFAULT 0, doc TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT, at INTEGER, actor TEXT, action TEXT, detail TEXT);
CREATE TABLE IF NOT EXISTS credentials (role TEXT PRIMARY KEY, hash TEXT, salt TEXT, iterations INTEGER);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, role TEXT, expires_at INTEGER);
CREATE TABLE IF NOT EXISTS devices (id TEXT PRIMARY KEY, event_id TEXT, station INTEGER, token_hash TEXT UNIQUE, label TEXT, created_at INTEGER, revoked_at INTEGER, last_seen INTEGER);
CREATE TABLE IF NOT EXISTS pairing_codes (code TEXT PRIMARY KEY, event_id TEXT, station INTEGER, expires_at INTEGER);
CREATE TABLE IF NOT EXISTS api_keys (id TEXT PRIMARY KEY, key_hash TEXT UNIQUE, label TEXT, created_at INTEGER, revoked_at INTEGER);
CREATE TABLE IF NOT EXISTS login_failures (ip TEXT, at INTEGER);
`;

export class Hub extends DurableObject<Env> {
  private sql: SqlStorage;
  private active: LiveEvent | null = null;
  /** The most recently ended event: phones and the projector keep showing it while nothing is active. */
  private ended: LiveEvent | null = null;
  private lastPublicSent = 0;
  /** When the paced public round update is due, or null when none is waiting. In memory only, like lastPublicSent. */
  private publicDue: number | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => {
      this.sql.exec(SCHEMA);
      this.active = this.loadActive();
      this.ended = this.loadEnded();
    });
  }

  // ---------- storage ----------

  private loadActive(): LiveEvent | null {
    const row = this.sql.exec<{ doc: string }>('SELECT doc FROM events WHERE active = 1 LIMIT 1').toArray()[0];
    if (!row) return null;
    const doc = JSON.parse(row.doc) as LiveEvent;
    // Events stored before line-ups were saved get them now, so a later correction cannot rebuild a raced round.
    const event = this.safeBackfill(doc);
    if (event !== doc) this.sql.exec('UPDATE events SET doc = ? WHERE id = ?', JSON.stringify(event), event.id);
    return event;
  }

  private loadEnded(): LiveEvent | null {
    let latest: LiveEvent | null = null;
    for (const { doc } of this.sql.exec<{ doc: string }>('SELECT doc FROM events WHERE active = 0').toArray()) {
      const e = JSON.parse(doc) as LiveEvent;
      if (e.endedAt && (!latest || e.endedAt > (latest.endedAt ?? 0))) latest = e;
    }
    return latest;
  }

  /** What participants see: the active event, or else the last one that ended. */
  private get display(): LiveEvent | null {
    return this.active ?? this.ended;
  }

  private audit(eventId: string | null, actor: Actor, action: string, detail: unknown) {
    this.sql.exec('INSERT INTO audit (event_id, at, actor, action, detail) VALUES (?, ?, ?, ?, ?)',
      eventId, Date.now(), actor.label, action, JSON.stringify(detail ?? null));
  }

  // ---------- authentication ----------

  async login(role: 'admin' | 'control', password: string, ip: string):
    Promise<{ ok: true; token: string } | { ok: false; status: 401 | 429 }> {
    const now = Date.now();
    this.sql.exec('DELETE FROM login_failures WHERE at <= ?', now - LOCKOUT_WINDOW_MS);
    const failures = this.sql.exec<{ at: number }>('SELECT at FROM login_failures WHERE ip = ?', ip).toArray().map((r) => r.at);
    if (!loginAllowed(failures, now)) return { ok: false, status: 429 };

    const stored: StoredPassword | undefined = this.sql.exec<{ hash: string; salt: string; iterations: number }>('SELECT hash, salt, iterations FROM credentials WHERE role = ?', role).toArray()[0];
    let valid = false;
    if (stored) valid = await verifyPassword(password, stored);
    else if (role === 'admin' && this.env.ADMIN_PASSWORD) {
      valid = (await sha256Hex(password)) === (await sha256Hex(this.env.ADMIN_PASSWORD));
    }
    if (!valid) {
      this.sql.exec('INSERT INTO login_failures (ip, at) VALUES (?, ?)', ip, now);
      return { ok: false, status: 401 };
    }
    const token = randomToken();
    this.sql.exec('DELETE FROM sessions WHERE expires_at <= ?', now);
    this.sql.exec('INSERT INTO sessions (token_hash, role, expires_at) VALUES (?, ?, ?)', await sha256Hex(token), role, now + SESSION_MS);
    return { ok: true, token };
  }

  async logout(token: string): Promise<void> {
    const hash = await sha256Hex(token);
    this.sql.exec('DELETE FROM sessions WHERE token_hash = ?', hash);
    this.closeSockets((a) => a.cred.session === hash);
  }

  async authenticate(cred: Credentials): Promise<Actor | null> {
    return this.authenticateHashed(await hashCredentials(cred));
  }

  private authenticateHashed(cred: CredentialHashes): Actor | null {
    const now = Date.now();
    if (cred.session) {
      const row = this.sql.exec<{ role: Actor['role'] }>('SELECT role FROM sessions WHERE token_hash = ? AND expires_at > ?',
        cred.session, now).toArray()[0];
      if (row) return { role: row.role, label: row.role === 'admin' ? 'admin' : 'race control' };
    }
    if (cred.device && this.active) {
      const row = this.sql.exec<{ id: string; station: number; label: string | null; last_seen: number | null }>(
        'SELECT id, station, label, last_seen FROM devices WHERE token_hash = ? AND event_id = ? AND revoked_at IS NULL',
        cred.device, this.active.id).toArray()[0];
      if (row) {
        if (shouldTouch(row.last_seen, now)) this.sql.exec('UPDATE devices SET last_seen = ? WHERE id = ?', now, row.id);
        return { role: 'referee', label: refereeLabel(row.label, row.station), deviceId: row.id, station: row.station };
      }
    }
    if (cred.apiKey) {
      const row = this.sql.exec<{ label: string }>('SELECT label FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL',
        cred.apiKey).toArray()[0];
      if (row) return { role: 'companion', label: `companion (${row.label})` };
    }
    return null;
  }

  async pair(code: string, name: string): Promise<{ ok: true; deviceToken: string; station: number } | { ok: false }> {
    const now = Date.now();
    const key = code.trim().toUpperCase();
    const row = this.sql.exec<{ event_id: string; station: number; expires_at: number }>(
      'SELECT event_id, station, expires_at FROM pairing_codes WHERE code = ?', key).toArray()[0];
    this.sql.exec('DELETE FROM pairing_codes WHERE code = ? OR expires_at <= ?', key, now);
    if (!row || row.expires_at <= now || row.event_id !== this.active?.id) return { ok: false };
    const token = randomToken();
    const id = crypto.randomUUID();
    this.sql.exec('INSERT INTO devices (id, event_id, station, token_hash, label, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      id, row.event_id, row.station, await sha256Hex(token), name, now);
    this.audit(row.event_id, { role: 'referee', label: refereeLabel(name, row.station) }, 'pairDevice', { deviceId: id });
    try {
      await this.afterChange({ type: 'pairDevice' });
    } catch (err) {
      // The code is spent and the device saved: the tablet must still get its token.
      console.error('pairDevice broadcast failed', err);
    }
    return { ok: true, deviceToken: token, station: row.station };
  }

  // ---------- commands ----------

  async command(actor: Actor, cmd: Command | HubCommand): Promise<CommandResult | { ok: true; reply: unknown }> {
    if (Object.hasOwn(HUB_COMMANDS, cmd.type)) {
      const hubCmd = cmd as HubCommand;
      if (!HUB_COMMANDS[hubCmd.type].includes(actor.role)) return fail('forbidden', 'You are not allowed to do that.');
      return this.hubCommand(actor, hubCmd);
    }
    if (!this.active) return fail('no_active_event', 'Create or activate an event first.');
    const result = applyCommand(this.active, cmd as Command, { now: Date.now(), actor, newId: () => crypto.randomUUID() });
    if (!result.ok) return result;
    const event = result.event;
    this.ctx.storage.transactionSync(() => {
      this.sql.exec('UPDATE events SET doc = ? WHERE id = ?', JSON.stringify(event), event.id);
      this.audit(event.id, actor, result.audit.action, result.audit.detail);
    });
    const before = this.active;
    this.active = event;
    await this.afterChange(cmd as Command, before);
    return result;
  }

  private async hubCommand(actor: Actor, cmd: HubCommand): Promise<CommandResult | { ok: true; reply: unknown }> {
    const now = Date.now();
    const reply = (value: unknown, detail: unknown = cmd, eventId: string | null = this.active?.id ?? null) => {
      this.audit(eventId, actor, cmd.type, detail);
      return { ok: true as const, reply: value };
    };
    switch (cmd.type) {
      case 'createEvent': {
        if (!cmd.name?.trim()) return fail('invalid', 'Event name is required.');
        if (!Number.isInteger(cmd.tableCount) || cmd.tableCount < 1) return fail('invalid', 'Table count must be at least 1.');
        const event = newEvent(crypto.randomUUID(), cmd.name.trim(), cmd.date, cmd.tableCount);
        // Don't replace an ended event that phones are still showing; admin activates the new one when ready.
        const makeActive = this.active === null && this.ended === null;
        this.sql.exec('INSERT INTO events (id, name, created_at, active, doc) VALUES (?, ?, ?, ?, ?)',
          event.id, event.name, now, makeActive ? 1 : 0, JSON.stringify(event));
        if (makeActive) this.active = event;
        await this.afterChange(cmd);
        return reply({ eventId: event.id });
      }
      case 'activateEvent': {
        const exists = this.sql.exec('SELECT id FROM events WHERE id = ?', cmd.eventId).toArray().length;
        if (!exists) return fail('not_found', 'No such event.');
        this.ctx.storage.transactionSync(() => {
          this.sql.exec('UPDATE events SET active = CASE WHEN id = ? THEN 1 ELSE 0 END', cmd.eventId);
          const row = this.sql.exec<{ doc: string }>('SELECT doc FROM events WHERE id = ?', cmd.eventId).toArray()[0]!;
          const doc = JSON.parse(row.doc) as LiveEvent;
          if (doc.endedAt) {
            // Keep the champion up only if the event really was over when it ended.
            const over = doc.round.phase === 'finished' && doc.round.current > 0 && doc.round.current === (this.safeDerive(doc)?.rounds.length ?? -1);
            // A countdown that was running when the event ended starts again, so referees get the full window.
            const round = doc.round.phase === 'running' && typeof doc.round.autoFinishAt === 'number'
              ? { ...doc.round, autoFinishAt: now + autoFinishDelay(doc) } : doc.round;
            this.sql.exec('UPDATE events SET doc = ? WHERE id = ?', JSON.stringify({ ...doc, round, endedAt: null, championShown: over && doc.championShown }), cmd.eventId);
          }
        });
        this.active = this.loadActive();
        this.ended = this.loadEnded();
        // Tablets are paired per event: disconnect the old event's referees.
        this.closeSockets((a) => a.actor.role === 'referee');
        await this.afterChange(cmd);
        return reply({ eventId: cmd.eventId });
      }
      case 'endEvent': {
        const row = this.sql.exec<{ doc: string }>('SELECT doc FROM events WHERE id = ?', cmd.eventId).toArray()[0];
        if (!row) return fail('not_found', 'No such event.');
        const doc = JSON.parse(row.doc) as LiveEvent;
        if (doc.endedAt) return fail('already_ended', 'This event has already ended.');
        const event: LiveEvent = { ...doc, endedAt: now, championShown: true, projectorPin: null };
        this.ctx.storage.transactionSync(() => {
          this.sql.exec('UPDATE events SET doc = ?, active = 0 WHERE id = ?', JSON.stringify(event), event.id);
          this.sql.exec('UPDATE devices SET revoked_at = ? WHERE event_id = ? AND revoked_at IS NULL', now, event.id);
          this.sql.exec('DELETE FROM pairing_codes WHERE event_id = ?', event.id);
        });
        const wasActive = this.active?.id === event.id;
        if (wasActive) this.active = null;
        this.ended = event;
        if (wasActive) this.closeSockets((a) => a.actor.role === 'referee');
        await this.afterChange(cmd);
        return reply({ eventId: event.id }, { eventId: event.id }, event.id);
      }
      case 'setPassword': {
        if (cmd.role !== 'admin' && cmd.role !== 'control') return fail('invalid', 'Role must be admin or control.');
        if (typeof cmd.password !== 'string' || cmd.password.length < 8) return fail('invalid', 'Use at least 8 characters.');
        const stored = await hashPassword(cmd.password);
        this.sql.exec('INSERT OR REPLACE INTO credentials (role, hash, salt, iterations) VALUES (?, ?, ?, ?)',
          cmd.role, stored.hash, stored.salt, stored.iterations);
        this.sql.exec('DELETE FROM sessions WHERE role = ?', cmd.role);
        return reply(null, { role: cmd.role });
      }
      case 'createApiKey': {
        const id = crypto.randomUUID();
        const key = randomToken();
        this.sql.exec('INSERT INTO api_keys (id, key_hash, label, created_at) VALUES (?, ?, ?, ?)',
          id, await sha256Hex(key), cmd.label?.trim() || 'Companion', now);
        return reply({ id, key }, { id, label: cmd.label });
      }
      case 'revokeApiKey':
        this.sql.exec('UPDATE api_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL', now, cmd.id);
        return reply(null);
      case 'createPairingCode': {
        if (!this.active) return fail('no_active_event', 'Create or activate an event first.');
        if (!Number.isInteger(cmd.station) || cmd.station < 1) return fail('invalid', 'Station must be a positive number.');
        const bytes = crypto.getRandomValues(new Uint8Array(8));
        const code = [...bytes].map((b) => PAIRING_ALPHABET[b % PAIRING_ALPHABET.length]).join('');
        const expiresAt = now + PAIRING_MS;
        this.sql.exec('INSERT INTO pairing_codes (code, event_id, station, expires_at) VALUES (?, ?, ?, ?)',
          code, this.active.id, cmd.station, expiresAt);
        return reply({ code, expiresAt }, { station: cmd.station });
      }
      case 'revokeDevice':
        this.sql.exec('UPDATE devices SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL', now, cmd.deviceId);
        await this.afterChange(cmd);
        return reply(null);
    }
  }

  // ---------- live connections ----------

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
    let actor = PUBLIC;
    let cred: CredentialHashes = {};
    const role = new URL(request.url).searchParams.get('role');
    if (role !== 'public') {
      const all = credentials(request);
      // The referee page asks to be treated as a referee: only the device cookie counts.
      const raw: Credentials = role === 'referee' ? (all.device ? { device: all.device } : {}) : all;
      if (role === 'referee' && !hasCredentials(raw)) return new Response('Unauthorized', { status: 401 });
      if (hasCredentials(raw)) {
        cred = await hashCredentials(raw);
        const found = this.authenticateHashed(cred);
        if (!found) return new Response('Unauthorized', { status: 401 });
        actor = found;
      }
    }
    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server, [tagFor(actor)]);
    server.serializeAttachment({ actor, cred } satisfies Attachment);
    server.send(this.initialMessage(actor));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const att = ws.deserializeAttachment() as Attachment;
    let msg: { type?: string; t0?: unknown; id?: unknown; cmd?: unknown };
    try {
      msg = JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message));
    } catch {
      return;
    }
    let actor = att.actor;
    if (actor.role !== 'public') {
      const current = this.authenticateHashed(att.cred);
      if (!current) {
        ws.close(4401, 'unauthorized');
        return;
      }
      actor = current;
    }
    if (msg.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong', t0: msg.t0, t1: Date.now() }));
      return;
    }
    if (msg.type === 'cmd') {
      const cmd = msg.cmd as { type?: unknown } | undefined;
      const result = actor.role === 'public' || !cmd || typeof cmd.type !== 'string'
        ? fail('forbidden', 'You are not allowed to do that.')
        : await this.command(actor, cmd as Command);
      const { ok } = result;
      const extra = ok ? ('reply' in result && result.reply !== undefined ? { reply: result.reply } : {})
        : { code: (result as { code: string }).code, message: (result as { message: string }).message, detail: (result as { detail?: unknown }).detail };
      ws.send(JSON.stringify({ type: 'ack', id: msg.id, ok, ...extra }));
    }
  }

  async webSocketClose(): Promise<void> {}

  async alarm(): Promise<void> {
    const at = this.active?.round.autoFinishAt;
    const finishDue = typeof at === 'number' && at <= Date.now();
    if (finishDue) await this.autoFinish();
    // A paced update is waiting, or this alarm was for one whose time was lost when the hub went idle.
    if (this.publicDue !== null || !finishDue) this.sendPublicRound();
    await this.scheduleAlarm();
  }

  /** Finishes the running round when its auto-finish time arrives, exactly as the Finish button does. */
  private async autoFinish(): Promise<void> {
    const result = await this.command(AUTO_FINISH, { type: 'finishRace' });
    if (result.ok || !this.active || this.active.round.autoFinishAt == null) return;
    // Refused (e.g. a team has no result after all): drop the time so the alarm does not fire again.
    console.error('auto-finish refused', 'code' in result ? result.code : '');
    const event: LiveEvent = { ...this.active, round: { ...this.active.round, autoFinishAt: null } };
    this.sql.exec('UPDATE events SET doc = ? WHERE id = ?', JSON.stringify(event), event.id);
    this.active = event;
    await this.afterChange({ type: 'autoFinishCancelled' });
  }

  /** The hub's one alarm serves both the paced phone update and auto-finish, set to whichever is due first. */
  private async scheduleAlarm(): Promise<void> {
    const at = nextAlarm(this.publicDue, this.active?.round.autoFinishAt);
    if (at === null) await this.ctx.storage.deleteAlarm();
    else if ((await this.ctx.storage.getAlarm()) !== at) await this.ctx.storage.setAlarm(at);
  }

  /** backfillLineups() guarded so a bad stored setup cannot stop the hub loading. */
  private safeBackfill(e: LiveEvent): LiveEvent {
    try {
      return backfillLineups(e);
    } catch (err) {
      console.error('backfilling line-ups failed', err);
      return e;
    }
  }

  /** derive() guarded so a bad stored setup can never take every socket down. */
  private safeDerive(e: LiveEvent) {
    try {
      return derive(e);
    } catch (err) {
      console.error('derive failed', err);
      return null;
    }
  }

  private initialMessage(actor: Actor): string {
    const e = actor.role === 'public' ? this.display : this.active;
    const d = e ? this.safeDerive(e) : null;
    if (!e || !d) return JSON.stringify({ type: actor.role === 'public' ? 'snapshot' : 'view', view: null });
    switch (actor.role) {
      case 'public': return JSON.stringify({ type: 'snapshot', view: publicView(e, d) });
      case 'companion': return JSON.stringify({ type: 'view', view: companionView(e, d) });
      case 'referee': return JSON.stringify({ type: 'view', view: refereeView(e, d, actor.station ?? 0) });
      default: return JSON.stringify({ type: 'view', view: controlView(e, d, this.controlExtras()) });
    }
  }

  private controlExtras() {
    const id = this.active?.id ?? '';
    return {
      devices: this.sql.exec('SELECT id, station, label, created_at, revoked_at, last_seen FROM devices WHERE event_id = ? ORDER BY station', id).toArray(),
      audit: this.sql.exec('SELECT at, actor, action, detail FROM audit WHERE event_id = ? ORDER BY id DESC LIMIT 50', id).toArray(),
    };
  }

  private send(tag: string, message: string) {
    for (const ws of this.ctx.getWebSockets(tag)) {
      try { ws.send(message); } catch { /* socket already closing */ }
    }
  }

  private sendPublicRound() {
    const d = this.active ? this.safeDerive(this.active) : null;
    if (!this.active || !d) return;
    this.lastPublicSent = Date.now();
    this.publicDue = null;
    this.send('public', JSON.stringify({ type: 'round', update: publicRoundUpdate(this.active, d) }));
  }

  /** Pushes fresh views to every connected role after a change. */
  private async afterChange(cmd: Command | HubCommand | { type: string }, before: LiveEvent | null = this.active): Promise<void> {
    if (cmd.type === 'revokeDevice') {
      for (const ws of this.ctx.getWebSockets()) {
        if ((ws.deserializeAttachment() as Attachment).actor.deviceId === (cmd as { deviceId: string }).deviceId) ws.close(4401, 'device revoked');
      }
    }
    const e = this.active;
    const d = e ? this.safeDerive(e) : null;
    if (!e || !d) {
      if (!e) {
        this.send('control', JSON.stringify({ type: 'view', view: null }));
        this.send('companion', JSON.stringify({ type: 'view', view: null }));
        const shown = this.display;
        const sd = shown ? this.safeDerive(shown) : null;
        if (shown && sd) this.send('public', JSON.stringify({ type: 'snapshot', view: publicView(shown, sd) }));
      }
      await this.scheduleAlarm();
      return;
    }
    this.send('control', JSON.stringify({ type: 'view', view: controlView(e, d, this.controlExtras()) }));
    this.send('companion', JSON.stringify({ type: 'view', view: companionView(e, d) }));
    const stations = new Set<number>();
    for (const ws of this.ctx.getWebSockets()) {
      const { actor } = ws.deserializeAttachment() as Attachment;
      if (actor.role === 'referee' && actor.station !== undefined) stations.add(actor.station);
    }
    for (const s of stations) this.send(`referee:${s}`, JSON.stringify({ type: 'view', view: refereeView(e, d, s) }));

    if (needsSnapshot(cmd, before ?? e)) {
      this.lastPublicSent = Date.now();
      this.publicDue = null;
      this.send('public', JSON.stringify({ type: 'snapshot', view: publicView(e, d) }));
    } else if (Date.now() - this.lastPublicSent >= PUBLIC_INTERVAL_MS) {
      this.sendPublicRound();
    } else {
      this.publicDue ??= this.lastPublicSent + PUBLIC_INTERVAL_MS;
    }
    await this.scheduleAlarm();
  }

  private closeSockets(match: (a: Attachment) => boolean) {
    for (const ws of this.ctx.getWebSockets()) {
      if (match(ws.deserializeAttachment() as Attachment)) {
        try { ws.close(4401, 'signed out'); } catch { /* already closed */ }
      }
    }
  }

  async whoAmI(cred: Credentials): Promise<{ role: Actor['role']; label: string; station?: number } | null> {
    const actor = await this.authenticate(cred);
    return actor ? { role: actor.role, label: actor.label, ...(actor.station !== undefined ? { station: actor.station } : {}) } : null;
  }

  async listEvents(): Promise<{ id: string; name: string; date: string; active: boolean; ended: boolean }[]> {
    return this.sql.exec<{ doc: string; active: number }>('SELECT doc, active FROM events ORDER BY created_at DESC').toArray()
      .map((r) => {
        const e = JSON.parse(r.doc) as LiveEvent;
        return { id: e.id, name: e.name, date: e.date, active: r.active === 1, ended: Boolean(e.endedAt) };
      });
  }

  async listApiKeys(): Promise<{ id: string; label: string; created_at: number; revoked_at: number | null }[]> {
    return this.sql.exec<{ id: string; label: string; created_at: number; revoked_at: number | null }>(
      'SELECT id, label, created_at, revoked_at FROM api_keys ORDER BY created_at DESC').toArray();
  }

  // ---------- export ----------

  async exportEvent(eventId: string, format: 'json' | 'csv'): Promise<string | null> {
    const row = this.sql.exec<{ doc: string }>('SELECT doc FROM events WHERE id = ?', eventId).toArray()[0];
    if (!row) return null;
    const event = JSON.parse(row.doc) as LiveEvent;
    if (format === 'json') {
      const audit = this.sql.exec('SELECT at, actor, action, detail FROM audit WHERE event_id = ? ORDER BY id', eventId).toArray();
      return JSON.stringify({ event, audit });
    }
    return eventCsv(event);
  }
}
