import { env } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { CONSOLE, command, connect, consoleGet, lockedEvent, pairReferee } from './client';

type Listed = { id: string; name: string; active: boolean; ended: boolean };
const list = async () => (await consoleGet(CONSOLE, '/events')).body as Listed[];
const tick = () => new Promise((r) => setTimeout(r, 5));

async function createEvent(name: string): Promise<string> {
  const r = await command({ type: 'createEvent', name, date: '2026-12-01', tableCount: 2 }, CONSOLE);
  return r.body.reply.eventId;
}

/** Storage is shared by the tests in this file: end and delete every event left by earlier ones. */
async function deleteAll() {
  for (const e of await list()) {
    if (e.active) await command({ type: 'endEvent', eventId: e.id }, CONSOLE);
    const r = await command({ type: 'deleteEvent', eventId: e.id, confirmName: e.name }, CONSOLE);
    if (r.status !== 200) throw new Error(JSON.stringify(r.body));
  }
}

function rowsFor(eventId: string) {
  return runInDurableObject(env.HUB.getByName('hub'), (_i, state) => {
    const count = (table: string) =>
      state.storage.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE event_id = ?`, eventId).one().n;
    return {
      audit: count('audit'),
      devices: count('devices'),
      pairing: count('pairing_codes'),
      events: state.storage.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM events WHERE id = ?', eventId).one().n,
      trace: state.storage.sql.exec<{ actor: string; detail: string }>(
        "SELECT actor, detail FROM audit WHERE event_id IS NULL AND action = 'deleteEvent'").toArray(),
    };
  });
}

describe('deleting an event', () => {
  it('refuses the active event', async () => {
    await lockedEvent();
    const active = (await list()).find((e) => e.active)!;
    const r = await command({ type: 'deleteEvent', eventId: active.id, confirmName: active.name }, CONSOLE);
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ code: 'event_active', message: 'End this event or make another one active before deleting it.' });
    expect((await list()).some((e) => e.id === active.id)).toBe(true);
  });

  it('refuses an unknown event', async () => {
    const r = await command({ type: 'deleteEvent', eventId: 'nope', confirmName: 'nope' }, CONSOLE);
    expect(r.body).toMatchObject({ code: 'not_found', message: 'No such event.' });
  });

  it('refuses a name that does not match and deletes nothing', async () => {
    await lockedEvent();
    const eventId = (await list()).find((e) => e.active)!.id;
    await command({ type: 'endEvent', eventId }, CONSOLE);
    const before = await rowsFor(eventId);
    for (const confirmName of ['test', 'Tes', 'Test 2', '']) {
      const r = await command({ type: 'deleteEvent', eventId, confirmName }, CONSOLE);
      expect(r.body, confirmName).toMatchObject({ code: 'name_mismatch', message: "Type the event's name exactly to delete it." });
    }
    expect(await rowsFor(eventId)).toEqual(before);
    expect((await consoleGet(CONSOLE, `/export?event=${eventId}&format=json`)).status).toBe(200);
  });

  it('removes an ended event, its log, devices and pairing codes, and leaves a trace', async () => {
    const admin = await lockedEvent();
    await pairReferee(admin);
    const eventId = (await list()).find((e) => e.active)!.id;
    await command({ type: 'endEvent', eventId }, admin);
    // A stale code left behind by an older version.
    await runInDurableObject(env.HUB.getByName('hub'), (_i, state) => {
      state.storage.sql.exec("INSERT INTO pairing_codes (code, event_id, station, expires_at) VALUES ('STALE', ?, 1, 0)", eventId);
    });
    const before = await rowsFor(eventId);
    expect(before).toMatchObject({ events: 1, devices: 1, pairing: 1 });
    expect(before.audit).toBeGreaterThan(0);

    const r = await command({ type: 'deleteEvent', eventId, confirmName: '  Test ' }, admin);
    expect(r.status).toBe(200);
    expect((await list()).some((e) => e.id === eventId)).toBe(false);
    expect((await consoleGet(admin, `/export?event=${eventId}&format=json`)).status).toBe(404);
    expect((await consoleGet(admin, `/export?event=${eventId}&format=csv`)).status).toBe(404);
    const after = await rowsFor(eventId);
    expect(after).toMatchObject({ events: 0, audit: 0, devices: 0, pairing: 0 });
    expect(after.trace).toHaveLength(1);
    expect(JSON.parse(after.trace[0]!.detail)).toEqual({ eventId, name: 'Test' });
  });

  it('deletes an event that was never used', async () => {
    await lockedEvent();
    const spare = await createEvent('Spare');
    const r = await command({ type: 'deleteEvent', eventId: spare, confirmName: 'Spare' }, CONSOLE);
    expect(r.status).toBe(200);
    expect((await list()).some((e) => e.id === spare)).toBe(false);
  });

  it('moves public screens to the next most recent ended event, then to no event', async () => {
    await deleteAll();
    const older = await createEvent('Older');
    await tick();
    const newer = await createEvent('Newer');
    await command({ type: 'endEvent', eventId: older }, CONSOLE);
    await tick();
    await command({ type: 'endEvent', eventId: newer }, CONSOLE);
    const phone = await connect({ role: 'public' });
    expect((await phone.next('snapshot', 0)).view.event.id).toBe(newer);

    let since = phone.messages.length;
    expect((await command({ type: 'deleteEvent', eventId: newer, confirmName: 'Newer' }, CONSOLE)).status).toBe(200);
    expect((await phone.next('snapshot', since)).view.event.id).toBe(older);
    const late = await connect({ role: 'public' });
    expect((await late.next('snapshot', 0)).view.event.id).toBe(older);

    since = phone.messages.length;
    expect((await command({ type: 'deleteEvent', eventId: older, confirmName: 'Older' }, CONSOLE)).status).toBe(200);
    expect((await phone.next('snapshot', since)).view).toBeNull();
  });
});
