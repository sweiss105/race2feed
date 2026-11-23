import { env } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { call, command, connect, controlAndReferee, loginAdmin, lockedEvent } from './client';

const hub = () => env.HUB.getByName('hub');

describe('/api/me', () => {
  it('describes the signed-in role', async () => {
    const admin = await lockedEvent();
    expect((await call('/api/me', undefined, { cookie: admin })).body).toMatchObject({ role: 'admin' });
    const { device } = await controlAndReferee(admin);
    expect((await call('/api/me', undefined, { cookie: device })).body).toMatchObject({ role: 'referee', station: 1 });
    expect((await call('/api/me')).status).toBe(401);
  });
});

describe('admin lists', () => {
  it('lists events with the active flag', async () => {
    const admin = await loginAdmin();
    const a = (await command({ type: 'createEvent', name: 'List A', date: '2026-12-01', tableCount: 4 }, { cookie: admin })).body.reply.eventId;
    await command({ type: 'activateEvent', eventId: a }, { cookie: admin });
    const events = (await call('/api/events', undefined, { cookie: admin })).body as { id: string; active: boolean; name: string }[];
    expect(events.find((e) => e.id === a)).toMatchObject({ name: 'List A', active: true });
    expect(events.filter((e) => e.active).length).toBe(1);
    expect((await call('/api/events')).status).toBe(401);
  });

  it('lists API keys without their values', async () => {
    const admin = await loginAdmin();
    const { id, key } = (await command({ type: 'createApiKey', label: 'Deck' }, { cookie: admin })).body.reply;
    const keys = (await call('/api/apikeys', undefined, { cookie: admin })).body as Record<string, unknown>[];
    expect(keys.find((k) => k.id === id)).toMatchObject({ label: 'Deck', revoked_at: null });
    expect(JSON.stringify(keys)).not.toContain(key);
  });
});

describe('closing live connections', () => {
  it('closes a session socket on logout', async () => {
    const admin = await loginAdmin();
    await lockedEvent();
    const ctl = await connect({ cookie: admin });
    await ctl.next('view', 0);
    await call('/api/logout', {}, { cookie: admin });
    expect((await ctl.closed).code).toBe(4401);
  });

  it('closes referee sockets when another event is activated', async () => {
    const admin = await lockedEvent();
    const { device } = await controlAndReferee(admin);
    const ref = await connect({ cookie: device });
    await ref.next('view', 0);
    const other = (await command({ type: 'createEvent', name: 'Other', date: '2026-12-02', tableCount: 4 }, { cookie: admin })).body.reply.eventId;
    await command({ type: 'activateEvent', eventId: other }, { cookie: admin });
    expect((await ref.closed).code).toBe(4401);
  });

  it('keeps no raw credentials in socket attachments', async () => {
    const admin = await lockedEvent();
    const token = admin.split('=')[1]!;
    const ctl = await connect({ cookie: admin });
    await ctl.next('view', 0);
    const attachments = await runInDurableObject(hub(), (_i, state) =>
      state.getWebSockets().map((ws) => JSON.stringify(ws.deserializeAttachment())));
    expect(attachments.length).toBeGreaterThan(0);
    for (const a of attachments) expect(a).not.toContain(token);
  });

  it('tells connected screens about a newly created first event', async () => {
    // A fresh hub name is not available, so check that creating any event pushes a control view.
    const admin = await loginAdmin();
    const ctl = await connect({ cookie: admin });
    await ctl.next('view', 0);
    const since = ctl.messages.length;
    await command({ type: 'createEvent', name: 'Pushed', date: '2026-12-03', tableCount: 4 }, { cookie: admin });
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
    const admin = await loginAdmin();
    const activated = await command({ type: 'activateEvent', eventId: 'legacy-no-lineups' }, { cookie: admin });
    expect(activated.status).toBe(200);
    const res = await call('/api/export?event=legacy-no-lineups&format=json', undefined, { cookie: admin });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.event.lineups)).toEqual(['1', '2']);
  });
});
