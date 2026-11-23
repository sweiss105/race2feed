import { env } from 'cloudflare:workers';
import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { command, connect, lockedEvent } from './client';
import type { LiveEvent } from '../../src/core/model';

const hub = () => env.HUB.getByName('hub');
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A 4-team event with a 1 s auto-finish and no undo window, round 1 running. Returns the admin cookie and the team ids. */
async function runningRound(): Promise<{ admin: string; teams: string[] }> {
  const admin = await lockedEvent();
  expect((await command({ type: 'setSettings', autoFinishMs: 1000, undoWindowMs: 0 }, { cookie: admin })).status).toBe(200);
  await command({ type: 'openNextRound' }, { cookie: admin });
  for (const station of [1, 2]) await command({ type: 'overrideStation', station, state: 'ready' }, { cookie: admin });
  expect((await command({ type: 'startRace' }, { cookie: admin })).status).toBe(200);
  const ctl = await connect({ cookie: admin });
  const teams = (await ctl.next('view', 0)).view.teams.map((t: { id: string }) => t.id);
  ctl.ws.close();
  expect(teams).toHaveLength(4);
  return { admin, teams };
}

const setTime = (admin: string, teamId: string) =>
  command({ type: 'setResult', round: 1, teamId, set: { kind: 'time', rawMs: 200_000 } }, { cookie: admin });

async function consoleView(admin: string) {
  const ctl = await connect({ cookie: admin });
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
