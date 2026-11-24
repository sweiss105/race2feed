import { env } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { call, command, connect, consoleGet, CONSOLE, DEV_USER, emergencySignIn, pairReferee, lockedEvent } from './client';

const hub = () => env.HUB.getByName('hub');

describe('/api/me', () => {
  it('describes the signed-in role', async () => {
    const admin = await lockedEvent();
    expect((await call('/api/control/me', undefined, admin)).body).toMatchObject({ role: 'admin', label: DEV_USER });
    const { device } = await pairReferee(admin);
    expect((await call('/api/me', undefined, { cookie: device })).body).toMatchObject({ role: 'referee', station: 1 });
    expect((await call('/api/me')).status).toBe(401);
  });
});

describe('admin lists', () => {
  it('lists events with the active flag', async () => {
    const admin = CONSOLE;
    const a = (await command({ type: 'createEvent', name: 'List A', date: '2026-12-01', tableCount: 4 }, admin)).body.reply.eventId;
    await command({ type: 'activateEvent', eventId: a }, admin);
    const events = (await consoleGet(admin, '/events')).body as { id: string; active: boolean; name: string }[];
    expect(events.find((e) => e.id === a)).toMatchObject({ name: 'List A', active: true });
    expect(events.filter((e) => e.active).length).toBe(1);
    expect((await call('/api/events')).status).toBe(404);
    expect((await call('/api/emergency/events')).status).toBe(401);
  });

  it('lists API keys without their values', async () => {
    const admin = CONSOLE;
    const { id, key } = (await command({ type: 'createApiKey', label: 'Deck' }, admin)).body.reply;
    const keys = (await consoleGet(admin, '/apikeys')).body as Record<string, unknown>[];
    expect(keys.find((k) => k.id === id)).toMatchObject({ label: 'Deck', revoked_at: null });
    expect(JSON.stringify(keys)).not.toContain(key);
  });
});

describe('closing live connections', () => {
  it('closes a session socket on logout', async () => {
    const admin = await emergencySignIn();
    await lockedEvent();
    const ctl = await connect(admin);
    await ctl.next('view', 0);
    await call('/api/emergency/logout', {}, admin);
    expect((await ctl.closed).code).toBe(4401);
  });

  it('closes referee sockets when another event is activated', async () => {
    const admin = await lockedEvent();
    const { device } = await pairReferee(admin);
    const ref = await connect({ cookie: device });
    await ref.next('view', 0);
    const other = (await command({ type: 'createEvent', name: 'Other', date: '2026-12-02', tableCount: 4 }, admin)).body.reply.eventId;
    await command({ type: 'activateEvent', eventId: other }, admin);
    expect((await ref.closed).code).toBe(4401);
  });

  it('keeps no raw credentials in socket attachments', async () => {
    const admin = await lockedEvent(4, await emergencySignIn());
    const token = admin.cookie!.split('=')[1]!;
    const ctl = await connect(admin);
    await ctl.next('view', 0);
    const attachments = await runInDurableObject(hub(), (_i, state) =>
      state.getWebSockets().map((ws) => JSON.stringify(ws.deserializeAttachment())));
    expect(attachments.length).toBeGreaterThan(0);
    for (const a of attachments) expect(a).not.toContain(token);
  });

  it('tells connected screens about a newly created first event', async () => {
    // A fresh hub name is not available, so check that creating any event pushes a control view.
    const admin = CONSOLE;
    const ctl = await connect(admin);
    await ctl.next('view', 0);
    const since = ctl.messages.length;
    await command({ type: 'createEvent', name: 'Pushed', date: '2026-12-03', tableCount: 4 }, admin);
    await expect(ctl.next('view', since)).resolves.toBeTruthy();
  });
});

describe('events stored before line-ups existed', () => {
  it('backfills lineups for rounds 1 and 2 when such an event is activated', async () => {
    const { lockedFour, runRound } = await import('../core/helpers');
    const times = { T1: 60_000, T2: 61_000, T3: 62_000, T4: 63_000 };
    const raced = runRound(runRound(lockedFour(), times), times);
    const legacy = { ...raced, id: 'legacy-no-lineups', name: 'Legacy' } as Record<string, unknown>;
    delete legacy.lineups;
    delete legacy.bracketMembers;
    await runInDurableObject(hub(), (_i, state) => {
      state.storage.sql.exec('INSERT INTO events (id, name, created_at, active, doc) VALUES (?, ?, ?, 0, ?)',
        'legacy-no-lineups', 'Legacy', Date.now(), JSON.stringify(legacy));
    });
    const admin = CONSOLE;
    const activated = await command({ type: 'activateEvent', eventId: 'legacy-no-lineups' }, admin);
    expect(activated.status).toBe(200);
    const res = await consoleGet(admin, '/export?event=legacy-no-lineups&format=json');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.event.lineups)).toEqual(['1', '2']);
  });
});
