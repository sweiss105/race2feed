import { env } from 'cloudflare:workers';
import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { call, command, connect, controlAndReferee, lockedEvent, settle, wsCommand } from './client';

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
    const { control } = await controlAndReferee(admin);
    const ctl = await connect({ cookie: control });
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
    const { device } = await controlAndReferee(admin);
    const ref = await connect({ cookie: device });
    const view = await ref.next('view', 0);
    const teamId = view.view?.teams?.[0]?.teamId ?? 'x';
    const ack = await wsCommand(ref, { type: 'tapFinish', teamId, atServerMs: 0, clientTapId: 'c1' });
    expect(ack).toMatchObject({ ok: false, code: 'round_not_running' });
  });

  it('coalesces public round updates to one per second', async () => {
    const admin = await lockedEvent(6);
    const { control } = await controlAndReferee(admin);
    const ctl = await connect({ cookie: control });
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
    const { control } = await controlAndReferee(admin);
    const ctl = await connect({ cookie: control });
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

  it('rejects commands named after built-in properties', async () => {
    const admin = await lockedEvent();
    const r = await command({ type: 'constructor' }, { cookie: admin });
    expect(r.status).toBe(400);
  });

  it('keeps the race and socket roles across eviction', async () => {
    const admin = await lockedEvent();
    const { control, device } = await controlAndReferee(admin);
    const ctl = await connect({ cookie: control });
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
    const { control, device } = await controlAndReferee(admin);
    const ref = await connect({ cookie: device });
    await ref.next('view', 0);
    const deviceId = (await runInDurableObject(hub(), (_i, state) =>
      state.storage.sql.exec<{ id: string }>('SELECT id FROM devices ORDER BY created_at DESC LIMIT 1').one())).id;
    await command({ type: 'revokeDevice', deviceId }, { cookie: control });
    const closed = await ref.closed; // closed as soon as the device is revoked
    expect(closed.code).toBe(4401);
  });

  it('closes a socket whose session ended, on its next message', async () => {
    const admin = await lockedEvent();
    const { control } = await controlAndReferee(admin);
    const ctl = await connect({ cookie: control });
    await ctl.next('view', 0);
    // Changing the race control password ends existing race control sessions.
    await command({ type: 'setPassword', role: 'control', password: 'another-password' }, { cookie: admin });
    ctl.send({ type: 'ping', t0: 1 });
    expect((await ctl.closed).code).toBe(4401);
  });

  it('rejects socket credentials that are no longer valid', async () => {
    const { exports } = await import('cloudflare:workers');
    const res = await exports.default.fetch('https://r2f.test/api/ws', { headers: { upgrade: 'websocket', cookie: 'r2f_session=bogus' } });
    expect(res.status).toBe(401);
  });
  it('a browser with both a session and a pairing is a referee on the referee socket', async () => {
    const admin = await lockedEvent();
    const code = (await command({ type: 'createPairingCode', station: 1 }, { cookie: admin })).body.reply.code;
    const device = (await call('/api/pair', { code })).cookie!;
    const both = `${admin}; ${device}`;
    expect((await call('/api/me?as=referee', undefined, { cookie: both })).body).toMatchObject({ role: 'referee', station: 1 });
    expect((await call('/api/me?as=referee', undefined, { cookie: admin })).status).toBe(401);
    const s = await connect({ cookie: both, query: 'role=referee' });
    expect((await s.next('view')).view.station.number).toBe(1);
  });
});
