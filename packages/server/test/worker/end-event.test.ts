import { describe, it, expect } from 'vitest';
import { call, command, connect, controlAndReferee, lockedEvent } from './client';

describe('ending an event', () => {
  it('disconnects tablets, keeps results on phones, and can be reopened', async () => {
    const admin = await lockedEvent();
    const { device } = await controlAndReferee(admin);
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

  it('is admin only', async () => {
    const admin = await lockedEvent();
    const { control } = await controlAndReferee(admin);
    expect((await command({ type: 'endEvent', eventId: 'x' }, { cookie: control })).body.code).toBe('forbidden');
  });
});
