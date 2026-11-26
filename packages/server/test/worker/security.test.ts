import { env } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { call, command, connect, CONSOLE, emergencySignIn, lockedEvent, pairReferee, settle, upgrade, wsCommand, type As } from './client';
import { sha256Hex } from '../../src/auth/crypto';

const hub = () => env.HUB.getByName('hub');
const sql = <T extends Record<string, SqlStorageValue>>(query: string, ...args: unknown[]) =>
  runInDurableObject(hub(), (_i, state) => state.storage.sql.exec<T>(query, ...args).toArray());
const count = async (table: string) => (await sql<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`))[0]!.n;

/** Round 1 running with a referee paired to station 1. Returns the referee's first team and the start time. */
async function runningRace(admin: As) {
  const { device } = await pairReferee(admin);
  await command({ type: 'openNextRound' }, admin);
  for (const station of [1, 2]) await command({ type: 'overrideStation', station, state: 'ready' }, admin);
  expect((await command({ type: 'startRace' }, admin)).status).toBe(200);
  const ref = await connect({ cookie: device, query: 'role=referee' });
  const view = (await ref.next('view', 0)).view;
  ref.ws.close();
  return { device, teamId: view.teams[0].teamId as string, startedAt: view.round.startedAt as number };
}

async function apiKey(admin: As): Promise<string> {
  return (await command({ type: 'createApiKey', label: 'Booth' }, admin)).body.reply.key;
}

describe('what a command answers', () => {
  it('tells a referee device and Companion only that the command worked', async () => {
    const admin = await lockedEvent();
    const key = await apiKey(admin);
    const { device, teamId, startedAt } = await runningRace(admin);
    const tap = await command({ type: 'tapFinish', teamId, atServerMs: startedAt + 500, clientTapId: 't1' }, { cookie: device });
    expect(tap).toMatchObject({ status: 200, body: { ok: true } });
    expect(Object.keys(tap.body)).toEqual(['ok']);
    const pin = await command({ type: 'pinProjector', screen: null }, { bearer: key });
    expect(pin.status).toBe(200);
    expect(Object.keys(pin.body)).toEqual(['ok']);
  });

  it('tells the console only the reply, and a refusal only its code and message', async () => {
    const admin = await lockedEvent();
    const ok = await command({ type: 'openNextRound' }, admin);
    expect(Object.keys(ok.body)).toEqual(['ok']);
    const refused = await command({ type: 'startRace' }, admin);
    expect(refused.status).toBe(400);
    expect(refused.body).toMatchObject({ ok: false, code: expect.any(String), message: expect.any(String) });
    expect(Object.keys(refused.body).filter((k) => !['ok', 'code', 'message', 'detail'].includes(k))).toEqual([]);
  });
});

describe('a credential is checked in the same step as its command', () => {
  it('a revoked device or key changes nothing, even when the hub is asked directly', async () => {
    const admin = await lockedEvent();
    const key = await apiKey(admin);
    const { device } = await pairReferee(admin);
    await command({ type: 'openNextRound' }, admin);
    const deviceId = (await sql<{ id: string }>('SELECT id FROM devices ORDER BY created_at DESC LIMIT 1'))[0]!.id;
    const keyId = (await sql<{ id: string }>('SELECT id FROM api_keys ORDER BY created_at DESC LIMIT 1'))[0]!.id;
    await command({ type: 'revokeDevice', deviceId }, admin);
    await command({ type: 'revokeApiKey', id: keyId }, admin);
    const audits = await count('audit');
    const token = device.split('=')[1]!;
    expect(await hub().commandWith({ device: token }, { type: 'stationReady' })).toBeNull();
    expect(await hub().commandWith({ apiKey: key }, { type: 'pinProjector', screen: null })).toBeNull();
    expect((await command({ type: 'stationReady' }, { cookie: device })).status).toBe(401);
    expect((await command({ type: 'pinProjector', screen: null }, { bearer: key })).status).toBe(401);
    expect(await count('audit')).toBe(audits);
  });

  it('never signs a session cookie in on the device and Companion route', async () => {
    const emergency = await emergencySignIn('10.3.0.1');
    await lockedEvent(4, emergency);
    expect((await command({ type: 'openNextRound' }, { cookie: emergency.cookie })).status).toBe(401);
    expect(await hub().commandWith({ session: emergency.cookie.split('=')[1]! }, { type: 'openNextRound' })).toBeNull();
  });
});

describe('requests from another origin', () => {
  const SIBLING = { origin: 'https://evil.weiss-audio.com' };

  it('refuses a sibling site on the referee socket, commands and /api/me, whatever cookie comes with it', async () => {
    const admin = await lockedEvent();
    const { device } = await pairReferee(admin);
    expect((await upgrade({ cookie: device, query: 'role=referee', headers: SIBLING })).status).toBe(403);
    expect((await upgrade({ cookie: device, headers: SIBLING })).status).toBe(403);
    expect(await command({ type: 'stationReady' }, { cookie: device, headers: { ...SIBLING, 'content-type': 'text/plain' } }))
      .toMatchObject({ status: 403, body: { error: 'cross_site' } });
    expect((await call('/api/me?as=referee', undefined, { cookie: device, headers: SIBLING })).status).toBe(403);
    expect((await call('/api/pair', { code: 'ABCDEFGH', name: 'Ref' }, { headers: SIBLING })).status).toBe(403);
  });

  it('refuses Sec-Fetch-Site: same-site and cross-site without an Origin', async () => {
    const admin = await lockedEvent();
    const { device } = await pairReferee(admin);
    for (const site of ['same-site', 'cross-site']) {
      expect((await call('/api/me?as=referee', undefined, { cookie: device, headers: { 'sec-fetch-site': site } })).status).toBe(403);
      expect((await upgrade({ cookie: device, query: 'role=referee', headers: { 'sec-fetch-site': site } })).status).toBe(403);
    }
  });

  it('accepts the site itself, and Companion with no Origin', async () => {
    const admin = await lockedEvent();
    const key = await apiKey(admin);
    const { device } = await pairReferee(admin);
    await command({ type: 'openNextRound' }, admin);
    const own = { origin: 'https://r2f.test', 'sec-fetch-site': 'same-origin' };
    expect((await command({ type: 'stationReady' }, { cookie: device, headers: own })).status).toBe(200);
    expect((await call('/api/me?as=referee', undefined, { cookie: device, headers: { 'sec-fetch-site': 'same-origin' } })).status).toBe(200);
    const ref = await upgrade({ cookie: device, query: 'role=referee', headers: own });
    expect(ref.status).toBe(101);
    ref.webSocket!.accept();
    ref.webSocket!.close();
    expect((await command({ type: 'pinProjector', screen: null }, { bearer: key })).status).toBe(200);
  });
});

describe('switching events ends pairing for good', () => {
  async function twoEvents() {
    const admin = await lockedEvent();
    const events = (await call('/api/control/events')).body as { id: string; active: boolean }[];
    const a = events.find((e) => e.active)!.id;
    const b = (await command({ type: 'createEvent', name: 'Other', date: '2026-12-02', tableCount: 2 }, admin)).body.reply.eventId as string;
    return { admin, a, b };
  }

  it("a device and an unused code from before the switch stay refused when their event is active again", async () => {
    const { admin, a, b } = await twoEvents();
    const { device } = await pairReferee(admin);
    const code = (await command({ type: 'createPairingCode', station: 2 }, admin)).body.reply.code;
    expect((await call('/api/me?as=referee', undefined, { cookie: device })).status).toBe(200);

    await command({ type: 'activateEvent', eventId: b }, admin);
    expect((await call('/api/me?as=referee', undefined, { cookie: device })).status).toBe(401);
    await command({ type: 'activateEvent', eventId: a }, admin);

    expect((await call('/api/me?as=referee', undefined, { cookie: device })).status).toBe(401);
    expect((await command({ type: 'stationReady' }, { cookie: device })).status).toBe(401);
    expect((await upgrade({ cookie: device, query: 'role=referee' })).status).toBe(401);
    expect((await call('/api/pair', { code, name: 'Late' })).status).toBe(400);
    expect(await count('pairing_codes')).toBe(0);
  });

  it('activating the event that is already active keeps its devices, codes and sockets', async () => {
    const { admin, a } = await twoEvents();
    const { device } = await pairReferee(admin);
    const code = (await command({ type: 'createPairingCode', station: 2 }, admin)).body.reply.code;
    const ref = await connect({ cookie: device, query: 'role=referee' });
    await ref.next('view', 0);
    expect((await command({ type: 'activateEvent', eventId: a }, admin)).status).toBe(200);
    await settle();
    expect(ref.ws.readyState).toBe(WebSocket.OPEN);
    expect((await call('/api/me?as=referee', undefined, { cookie: device })).status).toBe(200);
    expect((await call('/api/pair', { code, name: 'Second' })).status).toBe(200);
    ref.ws.close();
  });
});

describe('an emergency socket ends with its session', () => {
  it('gets no more views once the session has expired, even if it never speaks', async () => {
    const emergency = await emergencySignIn('10.3.0.2');
    const admin = await lockedEvent(4, emergency);
    const hash = await sha256Hex(emergency.cookie.split('=')[1]!);
    // The session has half a second left when the socket connects.
    await sql('UPDATE sessions SET expires_at = ? WHERE token_hash = ?', Date.now() + 500, hash);
    const stale = await connect(admin);
    await stale.next('view', 0);
    await new Promise((r) => setTimeout(r, 600));
    const seen = stale.messages.length;
    expect((await command({ type: 'openNextRound' }, CONSOLE)).status).toBe(200);
    expect((await stale.closed).code).toBe(4401);
    expect(stale.messages.length).toBe(seen);
  });

  it('still closes at once on sign-out', async () => {
    const emergency = await emergencySignIn('10.3.0.3');
    const admin = await lockedEvent(4, emergency);
    const ctl = await connect(admin);
    await ctl.next('view', 0);
    await call('/api/emergency/logout', {}, emergency);
    expect((await ctl.closed).code).toBe(4401);
  });
});

describe('a resent tap', () => {
  it('is answered as done and writes, records and sends nothing', async () => {
    const admin = await lockedEvent();
    const { device, teamId, startedAt } = await runningRace(admin);
    const tap = { type: 'tapFinish', teamId, atServerMs: startedAt + 500, clientTapId: 'once' };
    expect((await command(tap, { cookie: device })).status).toBe(200);
    const audits = await count('audit');
    const doc = (await sql<{ doc: string }>('SELECT doc FROM events WHERE active = 1'))[0]!.doc;
    const ctl = await connect(admin);
    await ctl.next('view', 0);
    const seen = ctl.messages.length;
    for (let i = 0; i < 5; i++) expect(await command(tap, { cookie: device })).toMatchObject({ status: 200, body: { ok: true } });
    await settle();
    expect(await count('audit')).toBe(audits);
    expect((await sql<{ doc: string }>('SELECT doc FROM events WHERE active = 1'))[0]!.doc).toBe(doc);
    expect(ctl.messages.length).toBe(seen);
    ctl.ws.close();
  });

  it('keeps only the known fields of a referee command in the log', async () => {
    const admin = await lockedEvent();
    const { device, teamId, startedAt } = await runningRace(admin);
    await command({ type: 'tapFinish', teamId, atServerMs: startedAt + 500, clientTapId: 'only-known', junk: 'j'.repeat(2000) }, { cookie: device });
    const detail = (await sql<{ detail: string }>("SELECT detail FROM audit WHERE action = 'tapFinish' ORDER BY id DESC LIMIT 1"))[0]!.detail;
    expect(JSON.parse(detail)).toEqual({ type: 'tapFinish', teamId, atServerMs: startedAt + 500, clientTapId: 'only-known' });
  });
});

describe('budgets', () => {
  it('slows a device that sends commands without pause, and leaves the console alone', async () => {
    const admin = await lockedEvent();
    const { device } = await pairReferee(admin);
    const statuses: number[] = [];
    for (let i = 0; i < 80; i++) statuses.push((await command({ type: 'undoTap', tapId: 'none' }, { cookie: device })).status);
    expect(statuses.slice(0, 60).every((s) => s === 400)).toBe(true);
    expect(statuses).toContain(429);
    for (let i = 0; i < 80; i++) expect((await command({ type: 'pinProjector', screen: null }, admin)).status).toBe(200);
  });

  it('closes a socket that sends a message too large for its role', async () => {
    const pub = await connect({ role: 'public' });
    await pub.next('snapshot', 0);
    pub.send({ type: 'ping', t0: 'x'.repeat(5000) });
    expect((await pub.closed).code).toBe(1009);
  });

  it('closes a phone that sends messages without pause; a normal ping is answered', async () => {
    const pub = await connect({ role: 'public' });
    await pub.next('snapshot', 0);
    pub.send({ type: 'ping', t0: 1 });
    expect((await pub.next('pong', 0)).t0).toBe(1);
    for (let i = 0; i < 200; i++) pub.send({ type: 'ping', t0: i });
    expect((await pub.closed).code).toBe(1008);
  });

  it('lets the console send a long team list over its socket', async () => {
    const admin = await lockedEvent();
    await command({ type: 'unlockSetup' }, admin);
    const ctl = await connect(admin);
    await ctl.next('view', 0);
    const csv = ['team,category', ...Array.from({ length: 400 }, (_, i) => `Team number ${i},Category ${i % 4}`)].join('\n');
    expect(csv.length).toBeGreaterThan(4096);
    const ack = await wsCommand(ctl, { type: 'importTeams', csv });
    expect(ack.code).not.toBe('too_large');
    expect(ctl.ws.readyState).toBe(WebSocket.OPEN);
    ctl.ws.close();
  });
});

describe('pairing attempts', () => {
  it('refuses a body that is too large and a code that cannot be one, before the hub is asked', async () => {
    const admin = await lockedEvent();
    await command({ type: 'createPairingCode', station: 1 }, admin);
    const codes = await count('pairing_codes');
    expect((await call('/api/pair', { code: 'ABCDEFGH', name: 'Ref', pad: 'x'.repeat(5000) })).status).toBe(413);
    for (const code of ['', 'short', 'ABCDEFGHJ', 'ABCD-FGH', 'ABCDEFG0', 'x'.repeat(3000)]) {
      expect(await call('/api/pair', { code, name: 'Ref' }, { ip: '10.4.0.1' })).toMatchObject({ status: 400, body: { error: 'invalid_code' } });
    }
    // None of those counted against the address, and none spent the code.
    expect(await count('pairing_codes')).toBe(codes);
    expect((await command({ type: 'stationReady' }, { cookie: 'r2f_device=x', headers: { 'content-length': '999999' } })).status).toBe(413);
  });

  it('makes an address wait after ten wrong codes; other addresses still pair', async () => {
    const admin = await lockedEvent();
    const code = (await command({ type: 'createPairingCode', station: 1 }, admin)).body.reply.code as string;
    const wrong = code === 'ZZZZZZZZ' ? 'YYYYYYYY' : 'ZZZZZZZZ';
    for (let i = 0; i < 10; i++) expect((await call('/api/pair', { code: wrong, name: 'Ref' }, { ip: '10.4.0.2' })).status).toBe(400);
    expect(await call('/api/pair', { code: wrong, name: 'Ref' }, { ip: '10.4.0.2' })).toMatchObject({ status: 429, body: { error: 'too_many_attempts' } });
    expect((await call('/api/pair', { code, name: 'Ref' }, { ip: '10.4.0.2' })).status).toBe(429);
    expect((await call('/api/pair', { code, name: 'Ref' }, { ip: '10.4.0.9' })).status).toBe(200);
  });
});

describe('a finish that arrives late', () => {
  it('is held: no result until race control confirms it, and the referee is told it waits', async () => {
    const admin = await lockedEvent();
    const { device, teamId, startedAt } = await runningRace(admin);
    // The race started moments ago; pretend it started a minute ago so a tap can be 45 s old.
    await runInDurableObject(hub(), async (instance, state) => {
      const row = state.storage.sql.exec<{ id: string; doc: string }>('SELECT id, doc FROM events WHERE active = 1').one();
      const doc = JSON.parse(row.doc);
      doc.round.startedAt = startedAt - 60_000;
      state.storage.sql.exec('UPDATE events SET doc = ? WHERE id = ?', JSON.stringify(doc), row.id);
      (instance as unknown as { active: unknown }).active = doc;
    });
    const tap = { type: 'tapFinish', teamId, atServerMs: Date.now() - 45_000, clientTapId: 'offline-1' };
    expect(await command(tap, { cookie: device })).toMatchObject({ status: 200, body: { ok: true } });

    const ctl = await connect(admin);
    const view = (await ctl.next('view', 0)).view;
    expect(view.heldFinishes).toMatchObject([{ teamId, status: 'pending', referee: 'Ref' }]);
    expect(view.heldFinishes[0].lateMs).toBeGreaterThanOrEqual(45_000);
    expect(view.outstanding.map((o: any) => o.teamId)).toContain(teamId);

    const ref = await connect({ cookie: device, query: 'role=referee' });
    const mine = (await ref.next('view', 0)).view.teams.find((t: any) => t.teamId === teamId);
    expect(mine).toMatchObject({ result: null, finishHeld: true });
    expect(await command({ ...tap, atServerMs: Date.now(), clientTapId: 'again' }, { cookie: device }))
      .toMatchObject({ status: 400, body: { code: 'finish_held' } });
    expect((await command({ type: 'decideLateFinish', tapId: view.heldFinishes[0].tapId, decision: 'confirm' }, { cookie: device })).status).toBe(400);

    const since = ref.messages.length;
    const ack = await wsCommand(ctl, { type: 'decideLateFinish', tapId: view.heldFinishes[0].tapId, decision: 'confirm' });
    expect(ack.ok).toBe(true);
    const after = (await ref.next('view', since)).view.teams.find((t: any) => t.teamId === teamId);
    expect(after.finishHeld).toBe(false);
    expect(after.result).toMatchObject({ status: 'finished' });
    ctl.ws.close();
    ref.ws.close();
  });
});
