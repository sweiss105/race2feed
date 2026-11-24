import { env } from 'cloudflare:workers';
import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { call, command, connect, CONSOLE, emergencySignIn, pairReferee, lockedEvent, settle, upgrade, wsCommand } from './client';
import { sha256Hex } from '../../src/auth/crypto';
import { encodeConsoleIdentity } from '../../src/auth/console';

const hub = () => env.HUB.getByName('hub');

describe('live connections', () => {
  it('a public socket gets a snapshot on connect', async () => {
    await lockedEvent();
    const pub = await connect({ role: 'public' });
    const snap = await pub.next('snapshot', 0);
    expect(snap.view.round.phase).toBe('idle');
    expect(snap.view.teams.length).toBe(4);
  });

  it('answers clock-sync pings', async () => {
    await lockedEvent();
    const pub = await connect({ role: 'public' });
    pub.send({ type: 'ping', t0: 123 });
    const pong = await pub.next('pong');
    expect(pong.t0).toBe(123);
    expect(typeof pong.t1).toBe('number');
  });

  it('commands over a socket are acked and broadcast', async () => {
    const admin = await lockedEvent();
    const ctl = await connect(admin);
    const pub = await connect({ role: 'public' });
    await ctl.next('view', 0);
    await pub.next('snapshot', 0);
    const ctlSince = ctl.messages.length;
    const pubSince = pub.messages.length;
    const ack = await wsCommand(ctl, { type: 'openNextRound' });
    expect(ack.ok).toBe(true);
    expect((await ctl.next('view', ctlSince)).view.round.phase).toBe('open');
    expect((await pub.next('snapshot', pubSince)).view.round.phase).toBe('open');
  });

  it('refuses a referee tap when no race is running', async () => {
    const admin = await lockedEvent();
    const { device } = await pairReferee(admin);
    const ref = await connect({ cookie: device });
    const view = await ref.next('view', 0);
    const teamId = view.view?.teams?.[0]?.teamId ?? 'x';
    const ack = await wsCommand(ref, { type: 'tapFinish', teamId, atServerMs: 0, clientTapId: 'c1' });
    expect(ack).toMatchObject({ ok: false, code: 'round_not_running' });
  });

  it('coalesces public round updates to one per second', async () => {
    const admin = await lockedEvent(6);
    const ctl = await connect(admin);
    const pub = await connect({ role: 'public' });
    await wsCommand(ctl, { type: 'openNextRound' });
    for (const station of [1, 2, 3]) await wsCommand(ctl, { type: 'overrideStation', station, state: 'ready' });
    await wsCommand(ctl, { type: 'startRace' });
    await runDurableObjectAlarm(hub());
    await settle();

    const teams = (await ctl.next('view', 0)).view.teams.map((t: { id: string }) => t.id);
    const since = pub.messages.length;
    for (const teamId of teams.slice(0, 5)) {
      const ack = await wsCommand(ctl, { type: 'setResult', round: 1, teamId, set: { kind: 'time', rawMs: 200_000 } });
      expect(ack.ok).toBe(true);
    }
    await settle();
    expect(pub.messages.slice(since).filter((m) => m.type === 'round').length).toBeLessThanOrEqual(1);

    const beforeAlarm = pub.messages.length;
    expect(await runDurableObjectAlarm(hub())).toBe(true);
    const trailing = await pub.next('round', beforeAlarm);
    const finished = trailing.update.races.flatMap((r: any) => r.entrants).filter((x: any) => x.status === 'finished');
    expect(finished.length).toBe(5);
  });

  it('sends phones a fresh snapshot for corrections made while reviewing a finished round', async () => {
    const admin = await lockedEvent();
    const ctl = await connect(admin);
    const pub = await connect({ role: 'public' });
    await wsCommand(ctl, { type: 'openNextRound' });
    for (const station of [1, 2]) await wsCommand(ctl, { type: 'overrideStation', station, state: 'ready' });
    await wsCommand(ctl, { type: 'startRace' });
    const teams = (await ctl.next('view', 0)).view.teams.map((t: { id: string }) => t.id);
    for (const teamId of teams) await wsCommand(ctl, { type: 'setResult', round: 1, teamId, set: { kind: 'time', rawMs: 200_000 } });
    await wsCommand(ctl, { type: 'finishRace' });
    await settle();
    const since = pub.messages.length;
    await wsCommand(ctl, { type: 'setResult', round: 1, teamId: teams[0], set: { kind: 'time', rawMs: 150_000 } });
    const snap = await pub.next('snapshot', since);
    expect(snap.view.seedTotalsMs[teams[0]]).toBe(150_000);
  });

  it('tells race control when a tablet pairs', async () => {
    const admin = await lockedEvent();
    const control = await connect(admin);
    await control.next('view');
    const code = (await command({ type: 'createPairingCode', station: 2 }, admin)).body.reply.code;
    const since = control.messages.length;
    await call('/api/pair', { code, name: 'Ref' });
    const v = (await control.next('view', since)).view;
    expect(v.devices.filter((d: any) => d.station === 2 && d.revoked_at === null)).toHaveLength(1);
  });

  it('rejects commands named after built-in properties', async () => {
    const admin = await lockedEvent();
    const r = await command({ type: 'constructor' }, admin);
    expect(r.status).toBe(400);
  });

  it('keeps the race and socket roles across eviction', async () => {
    const admin = await lockedEvent();
    const { device } = await pairReferee(admin);
    const ctl = await connect(admin);
    const ref = await connect({ cookie: device });
    await wsCommand(ctl, { type: 'openNextRound' });
    expect((await wsCommand(ref, { type: 'stationReady' })).ok).toBe(true);
    await wsCommand(ctl, { type: 'overrideStation', station: 2, state: 'ready' });
    await wsCommand(ctl, { type: 'startRace' });
    const before = await ctl.next('view', 0).then(() => ctl.messages.filter((m) => m.type === 'view').at(-1).view);
    const startedAt = before.round.startedAt;
    expect(typeof startedAt).toBe('number');

    await evictDurableObject(hub());

    const refView = ref.messages.filter((m) => m.type === 'view').at(-1).view;
    const teamId = refView.teams[0].teamId;
    const ack = await wsCommand(ref, { type: 'tapFinish', teamId, atServerMs: startedAt + 1000, clientTapId: 'after-evict' });
    expect(ack.ok).toBe(true);
    const since = ctl.messages.length;
    await wsCommand(ctl, { type: 'pinProjector', screen: null });
    const after = (await ctl.next('view', since)).view;
    expect(after.round.startedAt).toBe(startedAt);
  });

  it('closes a revoked tablet with code 4401', async () => {
    const admin = await lockedEvent();
    const { device } = await pairReferee(admin);
    const ref = await connect({ cookie: device });
    await ref.next('view', 0);
    const deviceId = (await runInDurableObject(hub(), (_i, state) =>
      state.storage.sql.exec<{ id: string }>('SELECT id FROM devices ORDER BY created_at DESC LIMIT 1').one())).id;
    await command({ type: 'revokeDevice', deviceId }, admin);
    const closed = await ref.closed; // closed as soon as the device is revoked
    expect(closed.code).toBe(4401);
  });

  it('closes an emergency socket whose session ended, on its next message', async () => {
    const admin = await lockedEvent(4, await emergencySignIn());
    const ctl = await connect(admin);
    await ctl.next('view', 0);
    // The session expires (or is removed) while the socket stays open.
    const hash = await sha256Hex(admin.cookie!.split('=')[1]!);
    await runInDurableObject(hub(), (_i, state) => { state.storage.sql.exec('DELETE FROM sessions WHERE token_hash = ?', hash); });
    ctl.send({ type: 'ping', t0: 1 });
    expect((await ctl.closed).code).toBe(4401);
  });

  it('closes a console socket whose Access sign-in expired, on its next message', async () => {
    await lockedEvent();
    const socketFor = async (exp: number) => {
      // The hub is reached only through the Worker, which sets this header after checking Access.
      const res = await hub().fetch('https://r2f.test/api/control/ws', {
        headers: { upgrade: 'websocket', 'x-r2f-console': encodeConsoleIdentity({ label: 'a@b.c', exp }) },
      });
      const ws = res.webSocket!;
      ws.accept();
      const messages: any[] = [];
      ws.addEventListener('message', (e) => { messages.push(JSON.parse(e.data as string)); });
      const closed = new Promise<CloseEvent>((r) => ws.addEventListener('close', r));
      return { ws, messages, closed };
    };
    const live = await socketFor(Date.now() + 60_000);
    live.ws.send(JSON.stringify({ type: 'ping', t0: 1 }));
    await settle();
    expect(live.messages.map((m) => m.type)).toEqual(['view', 'pong']);
    expect(live.messages[0].view).not.toBeNull();

    const expiring = await socketFor(Date.now() + 200);
    await new Promise((r) => setTimeout(r, 300));
    expiring.ws.send(JSON.stringify({ type: 'cmd', id: 'x', cmd: { type: 'openNextRound' } }));
    expect((await expiring.closed).code).toBe(4401);
    expect(expiring.messages.filter((m) => m.type === 'ack')).toEqual([]);
    live.ws.close();
  });

  it('closes a silent console socket whose Access sign-in expired, instead of sending it the next view', async () => {
    await lockedEvent();
    const res = await hub().fetch('https://r2f.test/api/control/ws', {
      headers: { upgrade: 'websocket', 'x-r2f-console': encodeConsoleIdentity({ label: 'a@b.c', exp: Date.now() + 200 }) },
    });
    const ws = res.webSocket!;
    ws.accept();
    const messages: any[] = [];
    ws.addEventListener('message', (e) => { messages.push(JSON.parse(e.data as string)); });
    const closed = new Promise<CloseEvent>((r) => ws.addEventListener('close', r));
    await settle();
    expect(messages.map((m) => m.type)).toEqual(['view']);
    await new Promise((r) => setTimeout(r, 300));
    expect((await command({ type: 'openNextRound' }, CONSOLE)).status).toBe(200);
    expect((await closed).code).toBe(4401);
    expect(messages.map((m) => m.type)).toEqual(['view']);
  });

  it('rejects socket credentials that are no longer valid', async () => {
    expect((await upgrade({ api: '/api/emergency', cookie: 'r2f_session=bogus' })).status).toBe(401);
    expect((await upgrade({ api: '/api/emergency' })).status).toBe(401);
  });

  it('does not sign a session cookie in on /api/ws', async () => {
    const admin = await lockedEvent(4, await emergencySignIn());
    const s = await connect({ cookie: admin.cookie });
    expect((await s.next('snapshot', 0)).view).not.toBeNull();
    expect(s.messages.some((m) => m.type === 'view')).toBe(false);
  });

  it('a browser with both a session and a pairing is a referee on the referee socket', async () => {
    const admin = await lockedEvent(4, await emergencySignIn());
    const code = (await command({ type: 'createPairingCode', station: 1 }, admin)).body.reply.code;
    const device = (await call('/api/pair', { code, name: 'Ref' })).cookie!;
    const both = `${admin.cookie}; ${device}`;
    expect((await call('/api/me?as=referee', undefined, { cookie: both })).body).toMatchObject({ role: 'referee', station: 1 });
    expect((await call('/api/me?as=referee', undefined, admin)).status).toBe(401);
    const s = await connect({ cookie: both, query: 'role=referee' });
    expect((await s.next('view')).view.station.number).toBe(1);
  });

  it('refuses the referee socket without a device cookie, even for an admin session or an API key', async () => {
    const admin = await lockedEvent(4, await emergencySignIn());
    const key = (await command({ type: 'createApiKey', label: 'Deck' }, admin)).body.reply.key;
    expect((await upgrade({ query: 'role=referee', cookie: admin.cookie })).status).toBe(401);
    expect((await upgrade({ query: 'role=referee', bearer: key })).status).toBe(401);
  });

  it('pairing a tablet sends no snapshot to a public screen', async () => {
    const admin = await lockedEvent();
    const pub = await connect({ role: 'public' });
    await pub.next('snapshot', 0);
    const code = (await command({ type: 'createPairingCode', station: 1 }, admin)).body.reply.code;
    const since = pub.messages.length;
    await call('/api/pair', { code, name: 'Ref' });
    await settle();
    expect(pub.messages.slice(since).filter((m) => m.type === 'snapshot')).toEqual([]);
  });
});
