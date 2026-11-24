import { env } from 'cloudflare:workers';
import { evictDurableObject, runInDurableObject } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { call, command, connect, loginAdmin, lockedEvent, resetConsolePassword } from './client';
import { sha256Hex } from '../../src/auth/crypto';

async function consoleView(admin: string) {
  const ctl = await connect({ cookie: admin });
  const view = (await ctl.next('view', 0)).view;
  ctl.ws.close();
  return view;
}

describe('login', () => {
  it('sets a secure session cookie for the admin password', async () => {
    const r = await call('/api/login', { password: 'test-admin' }, { ip: '10.1.0.1' });
    expect(r.status).toBe(200);
    expect(r.cookie).toMatch(/^r2f_session=/);
    const raw = await (async () => {
      const { exports } = await import('cloudflare:workers');
      const res = await exports.default.fetch('https://r2f.test/api/login', {
        method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '10.1.0.2' },
        body: JSON.stringify({ password: 'test-admin' }),
      });
      return res.headers.get('set-cookie') ?? '';
    })();
    for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/']) expect(raw).toContain(flag);
  });

  it('rejects a wrong password', async () => {
    expect((await call('/api/login', { password: 'nope' }, { ip: '10.1.0.3' })).status).toBe(401);
  });

  it('locks an IP out after five failures', async () => {
    for (let i = 0; i < 5; i++) await call('/api/login', { password: 'nope' }, { ip: '10.1.0.4' });
    expect((await call('/api/login', { password: 'test-admin' }, { ip: '10.1.0.4' })).status).toBe(429);
  });

  it('signs in with the password alone', async () => {
    expect((await call('/api/login', {}, { ip: '10.1.0.5' })).status).toBe(400);
    const r = await call('/api/login', { password: 'test-admin' }, { ip: '10.1.0.6' });
    expect(r.body).toEqual({ ok: true, role: 'admin' });
    expect((await call('/api/me', undefined, { cookie: r.cookie! })).body).toMatchObject({ role: 'admin', label: 'race control' });
  });

  it('drops the separate race control password and sessions when the hub restarts', async () => {
    const stub = env.HUB.getByName('hub');
    const token = 'old-control-session';
    await runInDurableObject(stub, async (_i, state) => {
      state.storage.sql.exec("INSERT INTO credentials (role, hash, salt, iterations) VALUES ('control', 'h', 's', 1)");
      state.storage.sql.exec("INSERT INTO sessions (token_hash, role, expires_at) VALUES (?, 'control', ?)", await sha256Hex(token), Date.now() + 60_000);
    });
    await evictDurableObject(stub);
    const left = await runInDurableObject(stub, (_i, state) => ({
      credentials: state.storage.sql.exec("SELECT 1 FROM credentials WHERE role = 'control'").toArray().length,
      sessions: state.storage.sql.exec("SELECT 1 FROM sessions WHERE role = 'control'").toArray().length,
    }));
    expect(left).toEqual({ credentials: 0, sessions: 0 });
    expect((await call('/api/me', undefined, { cookie: `r2f_session=${token}` })).status).toBe(401);
  });

  it('a new console password replaces the old one and ends existing sessions', async () => {
    const admin = await loginAdmin();
    expect((await command({ type: 'setPassword', password: 'short' }, { cookie: admin })).body.code).toBe('invalid');
    expect((await command({ type: 'setPassword', password: 'brand-new-pw' }, { cookie: admin })).status).toBe(200);
    expect((await call('/api/me', undefined, { cookie: admin })).status).toBe(401);
    expect((await call('/api/login', { password: 'test-admin' }, { ip: '10.1.0.7' })).status).toBe(401);
    expect((await call('/api/login', { password: 'brand-new-pw' }, { ip: '10.1.0.8' })).status).toBe(200);
    await resetConsolePassword();
  });
});

describe('commands', () => {
  it('need credentials', async () => {
    expect((await command({ type: 'suggestSetup' })).status).toBe(401);
  });

  it('persist with an audit row and survive eviction', async () => {
    const admin = await loginAdmin();
    const created = await command({ type: 'createEvent', name: 'Persist', date: '2026-12-01', tableCount: 4 }, { cookie: admin });
    expect(created.status).toBe(200);
    const eventId = created.body.reply.eventId;
    await command({ type: 'activateEvent', eventId }, { cookie: admin });
    expect((await command({ type: 'importTeams', csv: 'team,category\nA,X\nB,X' }, { cookie: admin })).status).toBe(200);

    const stub = env.HUB.getByName('hub');
    const actions = await runInDurableObject(stub, (_i, state) =>
      state.storage.sql.exec<{ action: string }>('SELECT action FROM audit WHERE event_id = ?', eventId).toArray().map((r) => r.action));
    expect(actions).toContain('importTeams');

    await evictDurableObject(stub);
    const exported = await call(`/api/export?event=${eventId}&format=json`, undefined, { cookie: admin });
    expect(exported.status).toBe(200);
    expect(exported.body.event.setup.teams.map((t: { name: string }) => t.name)).toEqual(['A', 'B']);
  });

  it('return 400 with the reason when refused', async () => {
    const admin = await lockedEvent();
    const r = await command({ type: 'startRace' }, { cookie: admin });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('round_not_open');
  });
});

describe('referee pairing', () => {
  it('pairs a tablet once, accepts its commands, and stops after revoke', async () => {
    const admin = await lockedEvent();
    const code = (await command({ type: 'createPairingCode', station: 1 }, { cookie: admin })).body.reply.code;
    const paired = await call('/api/pair', { code, name: 'Ref' });
    expect(paired.status).toBe(200);
    expect(paired.body.station).toBe(1);
    expect(paired.cookie).toMatch(/^r2f_device=/);
    expect((await call('/api/pair', { code, name: 'Ref' })).status).toBe(400);

    await command({ type: 'openNextRound' }, { cookie: admin });
    expect((await command({ type: 'stationReady' }, { cookie: paired.cookie! })).status).toBe(200);

    const deviceId = (await runInDurableObject(env.HUB.getByName('hub'), (_i, state) =>
      state.storage.sql.exec<{ id: string }>('SELECT id FROM devices ORDER BY created_at DESC LIMIT 1').one())).id;
    await command({ type: 'revokeDevice', deviceId }, { cookie: admin });
    expect((await command({ type: 'stationReady' }, { cookie: paired.cookie! })).status).toBe(401);
  });
});

describe('referee name at pairing', () => {
  it('refuses a missing or overlong name without spending the code, then audits the trimmed name', async () => {
    const admin = await lockedEvent();
    const code = (await command({ type: 'createPairingCode', station: 1 }, { cookie: admin })).body.reply.code;
    for (const body of [{ code }, { code, name: '   ' }, { code, name: 'x'.repeat(41) }, { code, name: 7 }]) {
      const r = await call('/api/pair', body);
      expect(r.status).toBe(400);
      expect(r.body).toEqual({ error: 'name_required' });
      expect(r.cookie).toBeNull();
    }
    const paired = await call('/api/pair', { code, name: ' Dana ' });
    expect(paired.status).toBe(200);
    expect(paired.body.station).toBe(1);

    await command({ type: 'openNextRound' }, { cookie: admin });
    expect((await command({ type: 'stationReady' }, { cookie: paired.cookie! })).status).toBe(200);
    const view = await consoleView(admin);
    expect(view.audit[0]).toMatchObject({ actor: 'Dana (station 1)', action: 'stationReady' });
    expect(view.audit.find((a: any) => a.action === 'pairDevice')).toMatchObject({ actor: 'Dana (station 1)' });
    expect(view.devices.find((d: any) => d.station === 1).label).toBe('Dana');
  });

  it('refuses control and format characters without spending the code, and collapses spaces', async () => {
    const admin = await lockedEvent();
    const code = (await command({ type: 'createPairingCode', station: 1 }, { cookie: admin })).body.reply.code;
    for (const name of ['Da\u0000na', 'Dana\u202E', 'Da\u200Bna']) {
      const r = await call('/api/pair', { code, name });
      expect(r.status).toBe(400);
      expect(r.body).toEqual({ error: 'name_required' });
    }
    const paired = await call('/api/pair', { code, name: '  Dana   Lee ' });
    expect(paired.status).toBe(200);
    await command({ type: 'openNextRound' }, { cookie: admin });
    await command({ type: 'stationReady' }, { cookie: paired.cookie! });
    const view = await consoleView(admin);
    expect(view.audit[0]).toMatchObject({ actor: 'Dana Lee (station 1)', action: 'stationReady' });
    expect(view.devices.find((d: any) => d.station === 1).label).toBe('Dana Lee');
  });

  it('keeps the plain label for a device stored before names existed', async () => {
    const admin = await lockedEvent();
    const code = (await command({ type: 'createPairingCode', station: 1 }, { cookie: admin })).body.reply.code;
    const paired = await call('/api/pair', { code, name: 'Dana' });
    await runInDurableObject(env.HUB.getByName('hub'), (_i, state) => { state.storage.sql.exec("UPDATE devices SET label = 'Station 1'"); });
    await command({ type: 'openNextRound' }, { cookie: admin });
    await command({ type: 'stationReady' }, { cookie: paired.cookie! });
    const view = await consoleView(admin);
    expect(view.audit[0]).toMatchObject({ actor: 'referee station 1', action: 'stationReady' });
  });
});

describe('companion API key', () => {
  it('authorizes companion commands', async () => {
    const admin = await lockedEvent();
    const key = (await command({ type: 'createApiKey', label: 'Stream Deck' }, { cookie: admin })).body.reply.key;
    const r = await command({ type: 'startRace' }, { bearer: key });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('round_not_open');
    expect((await command({ type: 'startRace' }, { bearer: 'wrong' })).status).toBe(401);
  });
});
