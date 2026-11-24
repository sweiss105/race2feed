import { env } from 'cloudflare:workers';
import { evictDurableObject, runInDurableObject } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { call, command, connect, consoleGet, CONSOLE, DEV_USER, EMERGENCY_PASSWORD, emergencySignIn, lockedEvent, upgrade, type As } from './client';
import { hashPassword, sha256Hex } from '../../src/auth/crypto';

/** The newest audit row, read from storage: no socket left closing before the eviction tests below. */
async function lastAudit() {
  return runInDurableObject(env.HUB.getByName('hub'), (_i, state) =>
    state.storage.sql.exec<{ actor: string; action: string }>('SELECT actor, action FROM audit ORDER BY id DESC LIMIT 1').one());
}

async function consoleView(admin: As) {
  const ctl = await connect(admin);
  const view = (await ctl.next('view', 0)).view;
  ctl.ws.close();
  return view;
}

describe('console sign-in', () => {
  it('signs the console in as the dev console user', async () => {
    expect(await call('/api/control/me')).toMatchObject({ status: 200, body: { role: 'admin', label: DEV_USER } });
  });

  it('audits a console command with the signed-in name', async () => {
    const admin = await lockedEvent();
    expect((await command({ type: 'openNextRound' }, admin)).status).toBe(200);
    expect(await lastAudit()).toMatchObject({ actor: DEV_USER, action: 'openNextRound' });
  });

  it('never uses the dev console user on the production hostname', async () => {
    for (const path of ['/api/control/me', '/api/control/events', '/api/control/export?event=x&format=json']) {
      expect(await call(`https://r2f.weiss-audio.com${path}`), path).toMatchObject({ status: 401, body: { error: 'unauthorized' } });
    }
    expect((await call('https://r2f.weiss-audio.com/api/control/command', { cmd: { type: 'createEvent', name: 'X', date: '2026-12-01', tableCount: 2 } })).status).toBe(401);
    expect((await call('https://r2f.weiss-audio.com/api/control/me', undefined, { headers: { 'cf-access-jwt-assertion': 'not.a.token' } })).status).toBe(401);
    const forged = { 'x-r2f-console': JSON.stringify({ label: 'evil', exp: null }) };
    expect((await upgrade({ url: 'https://r2f.weiss-audio.com', api: '/api/control', headers: forged })).status).toBe(401);
  });

  it('has no password sign-in outside the emergency route', async () => {
    expect((await call('/api/login', { password: EMERGENCY_PASSWORD }, { ip: '10.1.0.9' })).status).toBe(404);
    expect((await call('/api/logout', {})).status).toBe(404);
    const emergency = await emergencySignIn('10.1.0.10');
    for (const path of ['/api/events', '/api/apikeys', '/api/export?event=x&format=json']) {
      expect((await call(path, undefined, emergency)).status, path).toBe(404);
    }
  });
});

describe('emergency sign-in', () => {
  it('is refused without the session cookie', async () => {
    for (const path of ['/api/emergency/me', '/api/emergency/events', '/api/emergency/apikeys', '/api/emergency/export?event=x&format=json']) {
      expect(await call(path), path).toMatchObject({ status: 401, body: { error: 'unauthorized' } });
    }
    expect((await call('/api/emergency/command', { cmd: { type: 'suggestSetup' } })).status).toBe(401);
    expect((await call('/api/emergency/me', undefined, { cookie: 'r2f_session=bogus' })).status).toBe(401);
  });

  it('sets a secure 12-hour session cookie for the emergency password', async () => {
    const { exports } = await import('cloudflare:workers');
    const res = await exports.default.fetch('https://r2f.test/api/emergency/login', {
      method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '10.1.0.2' },
      body: JSON.stringify({ password: EMERGENCY_PASSWORD }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, role: 'admin' });
    const raw = res.headers.get('set-cookie') ?? '';
    expect(raw).toMatch(/^r2f_session=/);
    for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/', `Max-Age=${12 * 60 * 60}`]) expect(raw).toContain(flag);
  });

  it('needs a password', async () => {
    expect((await call('/api/emergency/login', {}, { ip: '10.1.0.5' })).status).toBe(400);
  });

  it('rejects a wrong password and locks an address out on the sixth wrong attempt', async () => {
    for (let i = 0; i < 5; i++) {
      expect(await call('/api/emergency/login', { password: 'nope' }, { ip: '10.1.0.4' })).toMatchObject({ status: 401, cookie: null });
    }
    expect(await call('/api/emergency/login', { password: 'nope' }, { ip: '10.1.0.4' })).toMatchObject({ status: 429, cookie: null });
    expect((await call('/api/emergency/login', { password: EMERGENCY_PASSWORD }, { ip: '10.1.0.4' })).status).toBe(429);
    expect((await call('/api/emergency/login', { password: EMERGENCY_PASSWORD }, { ip: '10.1.0.3' })).status).toBe(200);
  });

  it('opens the console as "emergency sign-in" on the emergency routes only', async () => {
    const emergency = await emergencySignIn('10.1.0.6');
    expect((await call('/api/emergency/me', undefined, emergency)).body).toEqual({ role: 'admin', label: 'emergency sign-in' });
    await lockedEvent(4, emergency);
    expect((await command({ type: 'openNextRound' }, emergency)).status).toBe(200);
    expect(await lastAudit()).toMatchObject({ actor: 'emergency sign-in', action: 'openNextRound' });
    expect((await consoleGet(emergency, '/events')).status).toBe(200);
    expect((await consoleGet(emergency, '/apikeys')).status).toBe(200);

    expect((await command({ type: 'suggestSetup' }, { cookie: emergency.cookie })).status).toBe(401);
    expect((await call('/api/me', undefined, { cookie: emergency.cookie })).status).toBe(401);
  });

  it('signs out', async () => {
    const emergency = await emergencySignIn('10.1.0.7');
    const out = await call('/api/emergency/logout', {}, emergency);
    expect(out.status).toBe(200);
    expect(out.cookie).toBe('r2f_session=');
    expect((await call('/api/emergency/me', undefined, emergency)).status).toBe(401);
  });

  it('ignores a console password stored by an earlier version, and no command sets one', async () => {
    const stored = await hashPassword('stored-console-pw');
    await runInDurableObject(env.HUB.getByName('hub'), (_i, state) => {
      state.storage.sql.exec("INSERT OR REPLACE INTO credentials (role, hash, salt, iterations) VALUES ('admin', ?, ?, ?)", stored.hash, stored.salt, stored.iterations);
    });
    expect((await call('/api/emergency/login', { password: 'stored-console-pw' }, { ip: '10.1.0.8' })).status).toBe(401);
    expect((await call('/api/emergency/login', { password: EMERGENCY_PASSWORD }, { ip: '10.1.0.8' })).status).toBe(200);
    await lockedEvent();
    expect(await command({ type: 'setPassword', password: 'brand-new-pw' }, CONSOLE)).toMatchObject({ status: 400, body: { code: 'unknown_command' } });
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
    expect((await call('/api/emergency/me', undefined, { cookie: `r2f_session=${token}` })).status).toBe(401);
  });
});

describe('commands', () => {
  it('need credentials', async () => {
    expect((await command({ type: 'suggestSetup' })).status).toBe(401);
  });

  it('persist with an audit row and survive eviction', async () => {
    const admin = CONSOLE;
    const created = await command({ type: 'createEvent', name: 'Persist', date: '2026-12-01', tableCount: 4 }, admin);
    expect(created.status).toBe(200);
    const eventId = created.body.reply.eventId;
    await command({ type: 'activateEvent', eventId }, admin);
    expect((await command({ type: 'importTeams', csv: 'team,category\nA,X\nB,X' }, admin)).status).toBe(200);

    const stub = env.HUB.getByName('hub');
    const actions = await runInDurableObject(stub, (_i, state) =>
      state.storage.sql.exec<{ action: string }>('SELECT action FROM audit WHERE event_id = ?', eventId).toArray().map((r) => r.action));
    expect(actions).toContain('importTeams');

    await evictDurableObject(stub);
    const exported = await consoleGet(admin, `/export?event=${eventId}&format=json`);
    expect(exported.status).toBe(200);
    expect(exported.body.event.setup.teams.map((t: { name: string }) => t.name)).toEqual(['A', 'B']);
  });

  it('return 400 with the reason when refused', async () => {
    const admin = await lockedEvent();
    const r = await command({ type: 'startRace' }, admin);
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('round_not_open');
  });
});

describe('referee pairing', () => {
  it('pairs a tablet once, accepts its commands, and stops after revoke', async () => {
    const admin = await lockedEvent();
    const code = (await command({ type: 'createPairingCode', station: 1 }, admin)).body.reply.code;
    const paired = await call('/api/pair', { code, name: 'Ref' });
    expect(paired.status).toBe(200);
    expect(paired.body.station).toBe(1);
    expect(paired.cookie).toMatch(/^r2f_device=/);
    expect((await call('/api/pair', { code, name: 'Ref' })).status).toBe(400);

    await command({ type: 'openNextRound' }, admin);
    expect((await command({ type: 'stationReady' }, { cookie: paired.cookie! })).status).toBe(200);

    const deviceId = (await runInDurableObject(env.HUB.getByName('hub'), (_i, state) =>
      state.storage.sql.exec<{ id: string }>('SELECT id FROM devices ORDER BY created_at DESC LIMIT 1').one())).id;
    await command({ type: 'revokeDevice', deviceId }, admin);
    expect((await command({ type: 'stationReady' }, { cookie: paired.cookie! })).status).toBe(401);
  });
});

describe('referee name at pairing', () => {
  it('refuses a missing or overlong name without spending the code, then audits the trimmed name', async () => {
    const admin = await lockedEvent();
    const code = (await command({ type: 'createPairingCode', station: 1 }, admin)).body.reply.code;
    for (const body of [{ code }, { code, name: '   ' }, { code, name: 'x'.repeat(41) }, { code, name: 7 }]) {
      const r = await call('/api/pair', body);
      expect(r.status).toBe(400);
      expect(r.body).toEqual({ error: 'name_required' });
      expect(r.cookie).toBeNull();
    }
    const paired = await call('/api/pair', { code, name: ' Dana ' });
    expect(paired.status).toBe(200);
    expect(paired.body.station).toBe(1);

    await command({ type: 'openNextRound' }, admin);
    expect((await command({ type: 'stationReady' }, { cookie: paired.cookie! })).status).toBe(200);
    const view = await consoleView(admin);
    expect(view.audit[0]).toMatchObject({ actor: 'Dana (station 1)', action: 'stationReady' });
    expect(view.audit.find((a: any) => a.action === 'pairDevice')).toMatchObject({ actor: 'Dana (station 1)' });
    expect(view.devices.find((d: any) => d.station === 1).label).toBe('Dana');
  });

  it('refuses control and format characters without spending the code, and collapses spaces', async () => {
    const admin = await lockedEvent();
    const code = (await command({ type: 'createPairingCode', station: 1 }, admin)).body.reply.code;
    for (const name of ['Da\u0000na', 'Dana\u202E', 'Da\u200Bna']) {
      const r = await call('/api/pair', { code, name });
      expect(r.status).toBe(400);
      expect(r.body).toEqual({ error: 'name_required' });
    }
    const paired = await call('/api/pair', { code, name: '  Dana   Lee ' });
    expect(paired.status).toBe(200);
    await command({ type: 'openNextRound' }, admin);
    await command({ type: 'stationReady' }, { cookie: paired.cookie! });
    const view = await consoleView(admin);
    expect(view.audit[0]).toMatchObject({ actor: 'Dana Lee (station 1)', action: 'stationReady' });
    expect(view.devices.find((d: any) => d.station === 1).label).toBe('Dana Lee');
  });

  it('keeps the plain label for a device stored before names existed', async () => {
    const admin = await lockedEvent();
    const code = (await command({ type: 'createPairingCode', station: 1 }, admin)).body.reply.code;
    const paired = await call('/api/pair', { code, name: 'Dana' });
    await runInDurableObject(env.HUB.getByName('hub'), (_i, state) => { state.storage.sql.exec("UPDATE devices SET label = 'Station 1'"); });
    await command({ type: 'openNextRound' }, admin);
    await command({ type: 'stationReady' }, { cookie: paired.cookie! });
    const view = await consoleView(admin);
    expect(view.audit[0]).toMatchObject({ actor: 'referee station 1', action: 'stationReady' });
  });
});

describe('hub commands by role', () => {
  it('are refused for referees and Companion, and need credentials', async () => {
    const admin = await lockedEvent();
    const code = (await command({ type: 'createPairingCode', station: 1 }, admin)).body.reply.code;
    const device = (await call('/api/pair', { code, name: 'Ref' })).cookie!;
    const key = (await command({ type: 'createApiKey', label: 'Deck' }, admin)).body.reply.key;
    const cmds = [{ type: 'endEvent', eventId: 'x' }, { type: 'createPairingCode', station: 1 },
      { type: 'revokeDevice', deviceId: 'x' }, { type: 'createApiKey', label: 'x' }];
    for (const cmd of cmds) {
      expect((await command(cmd, { cookie: device })).body.code, `referee ${cmd.type}`).toBe('forbidden');
      expect((await command(cmd, { bearer: key })).body.code, `companion ${cmd.type}`).toBe('forbidden');
      expect((await command(cmd)).status, `anonymous ${cmd.type}`).toBe(401);
    }
  });
});

describe('companion API key', () => {
  it('authorizes companion commands', async () => {
    const admin = await lockedEvent();
    const key = (await command({ type: 'createApiKey', label: 'Stream Deck' }, admin)).body.reply.key;
    const r = await command({ type: 'startRace' }, { bearer: key });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('round_not_open');
    expect((await command({ type: 'startRace' }, { bearer: 'wrong' })).status).toBe(401);
  });
});

describe('cross-site console requests', () => {
  const FOREIGN = { origin: 'https://evil.example' };
  const OWN = { origin: 'https://r2f.test' };
  const cmd = { cmd: { type: 'pinProjector', screen: null } };

  it('refuses a foreign Origin on console commands, sockets and the emergency login', async () => {
    await lockedEvent();
    expect(await call('/api/control/command', cmd, { headers: FOREIGN })).toMatchObject({ status: 403, body: { error: 'cross_site' } });
    expect((await call('/api/control/me', undefined, { headers: FOREIGN })).status).toBe(403);
    expect((await upgrade({ api: '/api/control', headers: FOREIGN })).status).toBe(403);
    expect(await call('/api/emergency/login', { password: EMERGENCY_PASSWORD }, { ip: '10.2.0.1', headers: FOREIGN }))
      .toMatchObject({ status: 403, body: { error: 'cross_site' }, cookie: null });
    const emergency = await emergencySignIn('10.2.0.2');
    expect((await command({ type: 'suggestSetup' }, { ...emergency, headers: FOREIGN })).status).toBe(403);
    expect((await upgrade({ ...emergency, headers: FOREIGN })).status).toBe(403);
  });

  it('refuses Sec-Fetch-Site: cross-site even without an Origin', async () => {
    const xs = { 'sec-fetch-site': 'cross-site' };
    expect((await call('/api/control/command', cmd, { headers: xs })).status).toBe(403);
    expect((await upgrade({ api: '/api/control', headers: xs })).status).toBe(403);
    expect((await call('/api/emergency/login', { password: EMERGENCY_PASSWORD }, { ip: '10.2.0.3', headers: xs })).status).toBe(403);
  });

  it('accepts the same requests from the site itself or with no Origin', async () => {
    await lockedEvent();
    for (const headers of [OWN, { ...OWN, 'sec-fetch-site': 'same-origin' }, {}]) {
      expect((await call('/api/control/command', cmd, { headers })).status).toBe(200);
      const res = await upgrade({ api: '/api/control', headers });
      expect(res.status).toBe(101);
      res.webSocket!.accept();
      res.webSocket!.close();
    }
    expect((await call('/api/emergency/login', { password: EMERGENCY_PASSWORD }, { ip: '10.2.0.4', headers: OWN })).status).toBe(200);
    expect((await call('/api/emergency/login', { password: EMERGENCY_PASSWORD }, { ip: '10.2.0.5' })).status).toBe(200);
  });

  it('leaves tablet, Companion and public routes alone', async () => {
    const pub = await connect({ role: 'public', headers: FOREIGN });
    expect((await pub.next('snapshot', 0)).type).toBe('snapshot');
    pub.ws.close();
  });
});

describe('emergency sign-in turned off', () => {
  it('answers 404 on every emergency route when EMERGENCY_PASSWORD is unset', async () => {
    const { default: worker } = await import('../../src/worker');
    const off = { ...env, EMERGENCY_PASSWORD: undefined } as typeof env;
    const fetchOff = (path: string, init: RequestInit = {}) => worker.fetch(new Request(`https://r2f.test${path}`, init) as never, off);
    expect((await fetchOff('/api/emergency/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: EMERGENCY_PASSWORD }) })).status).toBe(404);
    expect((await fetchOff('/api/emergency/me')).status).toBe(404);
    expect((await fetchOff('/api/emergency/ws', { headers: { upgrade: 'websocket' } })).status).toBe(404);
    const emergency = await emergencySignIn('10.2.0.6');
    expect((await fetchOff('/api/emergency/me', { headers: { cookie: emergency.cookie } })).status).toBe(404);
  });
});

// Opens a socket: kept after the eviction tests above, which wait on sockets still closing.
describe('the internal console header', () => {
  it('does not trust an x-r2f-console header from the internet', async () => {
    await lockedEvent();
    const forged = { 'x-r2f-console': JSON.stringify({ label: 'evil', exp: null }) };
    const pub = await connect({ headers: forged });
    expect((await pub.next('snapshot', 0)).view).not.toBeNull();
    expect(pub.messages.some((m) => m.type === 'view')).toBe(false);
    pub.send({ type: 'cmd', id: 'x', cmd: { type: 'openNextRound' } });
    expect(await pub.next('ack')).toMatchObject({ ok: false, code: 'forbidden' });
    pub.ws.close();
    expect((await upgrade({ query: 'role=referee', headers: forged })).status).toBe(401);
    expect((await upgrade({ api: '/api/emergency', headers: forged })).status).toBe(401);
    expect((await call('/api/command', { cmd: { type: 'openNextRound' } }, { headers: forged })).status).toBe(401);
    expect((await call('/api/me', undefined, { headers: forged })).status).toBe(401);
  });
});
