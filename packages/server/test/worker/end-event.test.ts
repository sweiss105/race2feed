import { describe, it, expect } from 'vitest';
import { call, command, connect, pairReferee, lockedEvent } from './client';

describe('ending an event', () => {
  it('disconnects tablets, keeps results on phones, and can be reopened', async () => {
    const admin = await lockedEvent();
    const { device } = await pairReferee(admin);
    const ref = await connect({ cookie: device });
    const phone = await connect({ role: 'public' });
    await ref.next('view', 0);
    await phone.next('snapshot', 0);

    const events = (await call('/api/events', undefined, { cookie: admin })).body as { id: string; active: boolean }[];
    const eventId = events.find((e) => e.active)!.id;
    const since = phone.messages.length;
    const ended = await command({ type: 'endEvent', eventId }, { cookie: admin });
    expect(ended.status).toBe(200);

    expect((await ref.closed).code).toBe(4401);
    const snap = await phone.next('snapshot', since);
    expect(snap.view).toMatchObject({ ended: true, projector: 'champion' });

    const late = await connect({ role: 'public' });
    expect((await late.next('snapshot', 0)).view.event.id).toBe(eventId);

    const list = (await call('/api/events', undefined, { cookie: admin })).body as { id: string; active: boolean; ended: boolean }[];
    expect(list.find((e) => e.id === eventId)).toMatchObject({ active: false, ended: true });
    expect((await command({ type: 'openNextRound' }, { cookie: admin })).body.code).toBe('no_active_event');

    await command({ type: 'activateEvent', eventId }, { cookie: admin });
    const reopened = (await call('/api/events', undefined, { cookie: admin })).body as { id: string; active: boolean; ended: boolean }[];
    expect(reopened.find((e) => e.id === eventId)).toMatchObject({ active: true, ended: false });
  });

  it('creating the next event after ending one leaves the champion on phones', async () => {
    const admin = await lockedEvent();
    const events = (await call('/api/events', undefined, { cookie: admin })).body as { id: string; active: boolean }[];
    const eventId = events.find((e) => e.active)!.id;
    await command({ type: 'endEvent', eventId }, { cookie: admin });
    const created = await command({ type: 'createEvent', name: 'Next year', date: '2027-11-20', tableCount: 4 }, { cookie: admin });
    expect(created.status).toBe(200);
    const list = (await call('/api/events', undefined, { cookie: admin })).body as { id: string; name: string; active: boolean }[];
    expect(list.find((e) => e.name === 'Next year')!.active).toBe(false);
    const phone = await connect({ role: 'public' });
    expect((await phone.next('snapshot', 0)).view.event.id).toBe(eventId);
  });

  it('reopening an event that ended early takes the champion screen down', async () => {
    const admin = await lockedEvent();
    const events = (await call('/api/events', undefined, { cookie: admin })).body as { id: string; active: boolean }[];
    const eventId = events.find((e) => e.active)!.id;
    await command({ type: 'endEvent', eventId }, { cookie: admin });
    await command({ type: 'activateEvent', eventId }, { cookie: admin });
    const phone = await connect({ role: 'public' });
    expect((await phone.next('snapshot', 0)).view).toMatchObject({ championShown: false, ended: false });
  });
});
