import { env } from 'cloudflare:workers';
import { evictDurableObject, runInDurableObject } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { call, command, loginAdmin, lockedEvent } from './client';

describe('login', () => {
  it('sets a secure session cookie for the admin password', async () => {
    const r = await call('/api/login', { role: 'admin', password: 'test-admin' }, { ip: '10.1.0.1' });
    expect(r.status).toBe(200);
    expect(r.cookie).toMatch(/^r2f_session=/);
    const raw = await (async () => {
      const { exports } = await import('cloudflare:workers');
      const res = await exports.default.fetch('https://r2f.test/api/login', {
        method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '10.1.0.2' },
        body: JSON.stringify({ role: 'admin', password: 'test-admin' }),
      });
      return res.headers.get('set-cookie') ?? '';
    })();
    for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/']) expect(raw).toContain(flag);
  });

  it('rejects a wrong password', async () => {
    expect((await call('/api/login', { role: 'admin', password: 'nope' }, { ip: '10.1.0.3' })).status).toBe(401);
  });

  it('locks an IP out after five failures', async () => {
    for (let i = 0; i < 5; i++) await call('/api/login', { role: 'admin', password: 'nope' }, { ip: '10.1.0.4' });
    expect((await call('/api/login', { role: 'admin', password: 'test-admin' }, { ip: '10.1.0.4' })).status).toBe(429);
  });

  it('race control cannot log in until its password is set', async () => {
    expect((await call('/api/login', { role: 'control', password: 'anything' }, { ip: '10.1.0.5' })).status).toBe(401);
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
    await command({ type: 'setPassword', role: 'control', password: 'race-control-pw' }, { cookie: admin });
    const control = (await call('/api/login', { role: 'control', password: 'race-control-pw' }, { ip: '10.2.0.1' })).cookie!;
    expect(control).toMatch(/^r2f_session=/);

    const code = (await command({ type: 'createPairingCode', station: 1 }, { cookie: control })).body.reply.code;
    const paired = await call('/api/pair', { code });
    expect(paired.status).toBe(200);
    expect(paired.body.station).toBe(1);
    expect(paired.cookie).toMatch(/^r2f_device=/);
    expect((await call('/api/pair', { code })).status).toBe(400);

    await command({ type: 'openNextRound' }, { cookie: control });
    expect((await command({ type: 'stationReady' }, { cookie: paired.cookie! })).status).toBe(200);

    const deviceId = (await runInDurableObject(env.HUB.getByName('hub'), (_i, state) =>
      state.storage.sql.exec<{ id: string }>('SELECT id FROM devices ORDER BY created_at DESC LIMIT 1').one())).id;
    await command({ type: 'revokeDevice', deviceId }, { cookie: control });
    expect((await command({ type: 'stationReady' }, { cookie: paired.cookie! })).status).toBe(401);
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
