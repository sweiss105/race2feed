import { env } from 'cloudflare:workers';
import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { command, connect, consoleGet, lockedEvent, type As } from './client';
import type { LiveEvent } from '../../src/core/model';

const hub = () => env.HUB.getByName('hub');
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A 4-team event with a 1 s auto-finish and no undo window, round 1 running. Returns the admin cookie and the team ids. */
async function runningRound(): Promise<{ admin: As; teams: string[] }> {
  const admin = await lockedEvent();
  expect((await command({ type: 'setSettings', autoFinishMs: 1000, undoWindowMs: 0 }, admin)).status).toBe(200);
  await command({ type: 'openNextRound' }, admin);
  for (const station of [1, 2]) await command({ type: 'overrideStation', station, state: 'ready' }, admin);
  expect((await command({ type: 'startRace' }, admin)).status).toBe(200);
  const ctl = await connect(admin);
  const teams = (await ctl.next('view', 0)).view.teams.map((t: { id: string }) => t.id);
  ctl.ws.close();
  expect(teams).toHaveLength(4);
  return { admin, teams };
}

const setTime = (admin: As, teamId: string) =>
  command({ type: 'setResult', round: 1, teamId, set: { kind: 'time', rawMs: 200_000 } }, admin);

async function consoleView(admin: As) {
  const ctl = await connect(admin);
  const view = (await ctl.next('view', 0)).view;
  ctl.ws.close();
  return view;
}

describe('auto-finish', () => {
  it('finishes the race on the hub alarm once every team has a result', async () => {
    const { admin, teams } = await runningRound();
    for (const teamId of teams) expect((await setTime(admin, teamId)).status).toBe(200);
    expect(typeof (await consoleView(admin)).round.autoFinishAt).toBe('number');

    await wait(1100);
    await runDurableObjectAlarm(hub());

    const view = await consoleView(admin);
    expect(view.round.phase).toBe('finished');
    expect(view.round.autoFinishAt).toBeNull();
    expect(view.audit[0]).toMatchObject({ actor: 'auto-finish', action: 'finishRace' });
  });

  it('still finishes on time after the hub goes idle mid-countdown', async () => {
    const { admin, teams } = await runningRound();
    for (const teamId of teams) await setTime(admin, teamId);
    await evictDurableObject(hub());

    await wait(1100);
    await runDurableObjectAlarm(hub());

    const view = await consoleView(admin);
    expect(view.round.phase).toBe('finished');
    expect(view.audit[0]).toMatchObject({ actor: 'auto-finish', action: 'finishRace' });
  });

  it('leaves the race running while a team has no result', async () => {
    const { admin, teams } = await runningRound();
    for (const teamId of teams.slice(0, 3)) expect((await setTime(admin, teamId)).status).toBe(200);

    await wait(1100);
    await runDurableObjectAlarm(hub());

    const view = await consoleView(admin);
    expect(view.round.phase).toBe('running');
    expect(view.round.autoFinishAt ?? null).toBeNull();
  });

  it('gives referees the full window again when an event is reopened mid-countdown', async () => {
    const { admin, teams } = await runningRound();
    for (const teamId of teams) await setTime(admin, teamId);
    const eventId = ((await consoleGet(admin, '/events')).body as { id: string; active: boolean }[]).find((e) => e.active)!.id;
    expect((await command({ type: 'endEvent', eventId }, admin)).status).toBe(200);
    await wait(1100);
    const reopenedAt = Date.now();
    expect((await command({ type: 'activateEvent', eventId }, admin)).status).toBe(200);

    const stored = await runInDurableObject(hub(), (_i, state) => JSON.parse(
      state.storage.sql.exec<{ doc: string }>('SELECT doc FROM events WHERE id = ?', eventId).toArray()[0]!.doc) as LiveEvent);
    expect(Math.abs(stored.round.autoFinishAt! - (reopenedAt + 1000))).toBeLessThan(2000);
    expect(stored.round.autoFinishAt!).toBeGreaterThan(reopenedAt);

    await runDurableObjectAlarm(hub());
    expect((await consoleView(admin)).round.phase).toBe('running');
  });

  it('drops a due time that finishRace refuses instead of firing again', async () => {
    const { admin, teams } = await runningRound();
    for (const teamId of teams.slice(0, 3)) await setTime(admin, teamId);
    // A stale time left on the round while a team is still out (cannot happen through commands).
    await runInDurableObject(hub(), async (instance, state) => {
      const live = instance as unknown as { active: LiveEvent };
      live.active = { ...live.active, round: { ...live.active.round, autoFinishAt: Date.now() - 1 } };
      await state.storage.setAlarm(Date.now());
    });

    expect(await runDurableObjectAlarm(hub())).toBe(true);

    const view = await consoleView(admin);
    expect(view.round.phase).toBe('running');
    expect(view.round.autoFinishAt).toBeNull();
    expect(await runDurableObjectAlarm(hub())).toBe(false);
  });
});
