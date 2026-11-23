import { DurableObject } from 'cloudflare:workers';
import { officialMs } from '@race2feed/engine';
import type { Env } from './worker';
import { applyCommand } from './core/apply';
import { fail, newEvent, type Actor, type Command, type CommandResult, type LiveEvent } from './core/model';
import { buildProgress, derive } from './core/results';
import { hashPassword, randomToken, sha256Hex, verifyPassword, type StoredPassword } from './auth/crypto';
import { LOCKOUT_WINDOW_MS, loginAllowed } from './auth/ratelimit';

export type HubCommand =
  | { type: 'createEvent'; name: string; date: string; tableCount: number }
  | { type: 'activateEvent'; eventId: string }
  | { type: 'setPassword'; role: 'admin' | 'control'; password: string }
  | { type: 'createApiKey'; label: string }
  | { type: 'revokeApiKey'; id: string }
  | { type: 'createPairingCode'; station: number }
  | { type: 'revokeDevice'; deviceId: string };

export interface Credentials { session?: string; device?: string; apiKey?: string }

const SESSION_MS = 12 * 60 * 60 * 1000;
const PAIRING_MS = 10 * 60 * 1000;
const PAIRING_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const HUB_COMMANDS: Record<HubCommand['type'], Actor['role'][]> = {
  createEvent: ['admin'],
  activateEvent: ['admin'],
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

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => {
      this.sql.exec(SCHEMA);
      this.active = this.loadActive();
    });
  }

  // ---------- storage ----------

  private loadActive(): LiveEvent | null {
    const row = this.sql.exec<{ doc: string }>('SELECT doc FROM events WHERE active = 1 LIMIT 1').toArray()[0];
    return row ? (JSON.parse(row.doc) as LiveEvent) : null;
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
    this.sql.exec('DELETE FROM sessions WHERE token_hash = ?', await sha256Hex(token));
  }

  async authenticate(cred: Credentials): Promise<Actor | null> {
    const now = Date.now();
    if (cred.session) {
      const row = this.sql.exec<{ role: Actor['role'] }>('SELECT role FROM sessions WHERE token_hash = ? AND expires_at > ?',
        await sha256Hex(cred.session), now).toArray()[0];
      if (row) return { role: row.role, label: row.role === 'admin' ? 'admin' : 'race control' };
    }
    if (cred.device && this.active) {
      const row = this.sql.exec<{ id: string; station: number }>(
        'SELECT id, station FROM devices WHERE token_hash = ? AND event_id = ? AND revoked_at IS NULL',
        await sha256Hex(cred.device), this.active.id).toArray()[0];
      if (row) {
        this.sql.exec('UPDATE devices SET last_seen = ? WHERE id = ?', now, row.id);
        return { role: 'referee', label: `referee station ${row.station}`, deviceId: row.id, station: row.station };
      }
    }
    if (cred.apiKey) {
      const row = this.sql.exec<{ label: string }>('SELECT label FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL',
        await sha256Hex(cred.apiKey)).toArray()[0];
      if (row) return { role: 'companion', label: `companion (${row.label})` };
    }
    return null;
  }

  async pair(code: string): Promise<{ ok: true; deviceToken: string; station: number } | { ok: false }> {
    const now = Date.now();
    const key = code.trim().toUpperCase();
    const row = this.sql.exec<{ event_id: string; station: number; expires_at: number }>(
      'SELECT event_id, station, expires_at FROM pairing_codes WHERE code = ?', key).toArray()[0];
    this.sql.exec('DELETE FROM pairing_codes WHERE code = ? OR expires_at <= ?', key, now);
    if (!row || row.expires_at <= now || row.event_id !== this.active?.id) return { ok: false };
    const token = randomToken();
    const id = crypto.randomUUID();
    this.sql.exec('INSERT INTO devices (id, event_id, station, token_hash, label, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      id, row.event_id, row.station, await sha256Hex(token), `Station ${row.station}`, now);
    this.audit(row.event_id, { role: 'referee', label: `referee station ${row.station}` }, 'pairDevice', { deviceId: id });
    return { ok: true, deviceToken: token, station: row.station };
  }

  // ---------- commands ----------

  async command(actor: Actor, cmd: Command | HubCommand): Promise<CommandResult | { ok: true; reply: unknown }> {
    if (cmd.type in HUB_COMMANDS) {
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
    this.active = event;
    this.afterChange(cmd as Command);
    return result;
  }

  /** Hook for live updates (WebSockets). */
  protected afterChange(_cmd: Command | HubCommand): void {}

  private async hubCommand(actor: Actor, cmd: HubCommand): Promise<CommandResult | { ok: true; reply: unknown }> {
    const now = Date.now();
    const reply = (value: unknown, detail: unknown = cmd) => {
      this.audit(this.active?.id ?? null, actor, cmd.type, detail);
      return { ok: true as const, reply: value };
    };
    switch (cmd.type) {
      case 'createEvent': {
        if (!cmd.name?.trim()) return fail('invalid', 'Event name is required.');
        if (!Number.isInteger(cmd.tableCount) || cmd.tableCount < 1) return fail('invalid', 'Table count must be at least 1.');
        const event = newEvent(crypto.randomUUID(), cmd.name.trim(), cmd.date, cmd.tableCount);
        const makeActive = this.active === null;
        this.sql.exec('INSERT INTO events (id, name, created_at, active, doc) VALUES (?, ?, ?, ?, ?)',
          event.id, event.name, now, makeActive ? 1 : 0, JSON.stringify(event));
        if (makeActive) this.active = event;
        return reply({ eventId: event.id });
      }
      case 'activateEvent': {
        const exists = this.sql.exec('SELECT id FROM events WHERE id = ?', cmd.eventId).toArray().length;
        if (!exists) return fail('not_found', 'No such event.');
        this.ctx.storage.transactionSync(() => {
          this.sql.exec('UPDATE events SET active = CASE WHEN id = ? THEN 1 ELSE 0 END', cmd.eventId);
        });
        this.active = this.loadActive();
        this.afterChange(cmd);
        return reply({ eventId: cmd.eventId });
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
        this.afterChange(cmd);
        return reply(null);
    }
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
    const d = derive(event);
    const progress = buildProgress(event);
    const team = new Map(event.setup.teams.map((t) => [t.id, t]));
    const category = new Map(event.setup.categories.map((c) => [c.id, c.name]));
    const cell = (v: unknown) => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = ['round,team,category,table,status,raw_ms,penalties_ms,official_ms,place'];
    for (const r of d.rounds) {
      for (const race of r.races) {
        for (const { teamId, table } of race.entrants) {
          const res = progress.results[r.spec.round]?.[teamId];
          const t = team.get(teamId);
          const place = res ? race.ranking.order.indexOf(teamId) + 1 : null;
          lines.push([r.spec.round, t?.name, category.get(t?.categoryId ?? ''), table, res?.status ?? 'pending',
            res?.rawMs, res?.penaltiesMs, res ? officialMs(res) : null, place].map(cell).join(','));
        }
      }
    }
    return lines.join('\n');
  }
}
