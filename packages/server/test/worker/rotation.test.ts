import { env } from 'cloudflare:workers';
import { evictDurableObject } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { call, command, connect, lockedEvent, settle, type As, type Socket } from './client';

const hub = () => env.HUB.getByName('hub');

/** Pairs a device named `name` to `station` and returns its device cookie. */
async function pair(admin: As, name: string, station = 1): Promise<string> {
  const code = (await command({ type: 'createPairingCode', station }, admin)).body.reply.code;
  return (await call('/api/pair', { code, name })).cookie!;
}

async function consoleView(admin: As) {
  const ctl = await connect(admin);
  const view = (await ctl.next('view', 0)).view;
  ctl.ws.close();
  return view;
}

/** The newest view a socket has received. */
async function latest(s: Socket) {
  await settle();
  return s.messages.filter((m) => m.type === 'view').at(-1).view;
}

const tablesOf = (view: any, name: string): number[] | undefined =>
  view.assignments.find((a: any) => a.name === name)?.tables;

async function startRound(admin: As) {
  for (const station of [1, 2]) await command({ type: 'overrideStation', station, state: 'ready' }, admin);
  expect((await command({ type: 'startRace' }, admin)).status).toBe(200);
}

async function finishRound(admin: As, round: number) {
  const view = await consoleView(admin);
  for (const t of view.teams) {
    await command({ type: 'setResult', round, teamId: t.id, set: { kind: 'time', rawMs: 200_000 + view.teams.indexOf(t) } }, admin);
  }
  expect((await command({ type: 'finishRace' }, admin)).status).toBe(200);
}

/** Ann and Bob, both paired to station 1 of a 4-team event (stations 1 and 2), each with a socket. */
async function twoReferees() {
  const admin = await lockedEvent();
  const cookies = { Ann: await pair(admin, 'Ann'), Bob: await pair(admin, 'Bob') };
  const sockets = { Ann: await connect({ cookie: cookies.Ann }), Bob: await connect({ cookie: cookies.Bob }) };
  return { admin, cookies, sockets };
}
const NAMES = ['Ann', 'Bob'] as const;

describe('referee rotation', () => {
  it('sends each referee the tables of their own assignment and refuses taps for the other\'s', async () => {
    const { admin, cookies, sockets } = await twoReferees();
    // Before the first round nothing is assigned: both show the station they paired to.
    for (const name of NAMES) expect((await latest(sockets[name])).station).toMatchObject({ number: 1, tables: [1, 2], assigned: true, moved: false });

    expect((await command({ type: 'openNextRound' }, admin)).status).toBe(200);
    const ctl = await consoleView(admin);
    expect(ctl.assignments.map((a: any) => a.tables)).toEqual([[1, 2], [3, 4]]);
    expect(ctl.roster.map((r: any) => [r.name, r.home]).sort()).toEqual([['Ann', 1], ['Bob', 1]]);
    const views: Record<string, any> = {};
    for (const name of NAMES) {
      views[name] = await latest(sockets[name]);
      expect(views[name].station.tables).toEqual(tablesOf(ctl, name));
      expect(views[name].station.assigned).toBe(true);
      expect(views[name].teams.map((t: any) => t.table)).toEqual(tablesOf(ctl, name));
    }
    // One of them was sent to station 2, away from the station they paired to.
    expect(NAMES.map((n) => views[n].station.number).sort()).toEqual([1, 2]);

    await startRound(admin);
    const startedAt = (await consoleView(admin)).round.startedAt;
    const tap = (who: 'Ann' | 'Bob', teamId: string) =>
      command({ type: 'tapFinish', teamId, atServerMs: startedAt + 1, clientTapId: `${who}-${teamId}` }, { cookie: cookies[who] });
    const other = await tap('Ann', views.Bob.teams[0].teamId);
    expect(other.status).toBe(400);
    expect(other.body.code).toBe('not_your_team');
    expect((await tap('Ann', views.Ann.teams[0].teamId)).status).toBe(200);
    expect((await tap('Bob', views.Bob.teams[0].teamId)).status).toBe(200);
    // Each referee sees their own tap, not the other's.
    expect((await latest(sockets.Ann)).teams.map((t: any) => t.taps.length)).toEqual([1, 0]);
  });

  it('gives a reconnecting device its assigned tables, not the station it paired to', async () => {
    const { admin, cookies, sockets } = await twoReferees();
    await command({ type: 'openNextRound' }, admin);
    const ctl = await consoleView(admin);
    const away = NAMES.find((n) => tablesOf(ctl, n)![0] === 3)!;
    sockets[away].ws.close();
    await settle();
    const again = await connect({ cookie: cookies[away] });
    expect((await again.next('view', 0)).view.station).toMatchObject({ number: 2, tables: [3, 4], assigned: true });
    // The same after the hub restarts.
    again.ws.close();
    sockets[away === 'Ann' ? 'Bob' : 'Ann'].ws.close();
    await settle();
    await evictDurableObject(hub());
    const afterRestart = await connect({ cookie: cookies[away] });
    expect((await afterRestart.next('view', 0)).view.station).toMatchObject({ number: 2, tables: [3, 4] });
    expect((await command({ type: 'stationReady', table: 3 }, { cookie: cookies[away] })).status).toBe(200);
    expect((await command({ type: 'stationReady', table: 1 }, { cookie: cookies[away] })).body.code).toBe('not_your_table');
  });

  it('tells a referee they moved when the next round gives them other tables', async () => {
    const { admin, sockets } = await twoReferees();
    await command({ type: 'openNextRound' }, admin);
    const first = await consoleView(admin);
    await startRound(admin);
    await finishRound(admin, 1);
    expect((await command({ type: 'openNextRound' }, admin)).status).toBe(200);
    const second = await consoleView(admin);
    const moved: boolean[] = [];
    for (const name of NAMES) {
      const view = await latest(sockets[name]);
      expect(view.round.current).toBe(2);
      expect(view.station.tables).toEqual(tablesOf(second, name));
      const changed = JSON.stringify(tablesOf(first, name)) !== JSON.stringify(tablesOf(second, name));
      expect(view.station.moved).toBe(changed);
      moved.push(view.station.moved);
    }
    // Staying put would give both the same teams again, so rotation exchanges them.
    expect(moved).toEqual([true, true]);
  });

  it('lets race control swap two referees before the start', async () => {
    const { admin, sockets } = await twoReferees();
    await command({ type: 'openNextRound' }, admin);
    const before = await consoleView(admin);
    const [a, b] = before.roster.map((r: any) => r.deviceId);
    expect((await command({ type: 'swapReferees', a, b }, admin)).status).toBe(200);
    const after = await consoleView(admin);
    for (const name of NAMES) {
      expect(tablesOf(after, name)).toEqual(tablesOf(before, name === 'Ann' ? 'Bob' : 'Ann'));
      expect((await latest(sockets[name])).station.tables).toEqual(tablesOf(after, name));
    }
    expect((await command({ type: 'swapReferees', a, b: 'nobody' }, admin)).body.code).toBe('not_found');
  });

  it('gives a referee paired during an open round the station if it has no referee, and frees it on revoke', async () => {
    const admin = await lockedEvent();
    const ann = await connect({ cookie: await pair(admin, 'Ann', 1) });
    await command({ type: 'openNextRound' }, admin);
    expect((await consoleView(admin)).assignments.map((a: any) => [a.name, a.tables])).toEqual([['Ann', [1, 2]]]);

    // Station 2 has no referee: Bob takes it.
    const bobCookie = await pair(admin, 'Bob', 2);
    const bob = await connect({ cookie: bobCookie });
    expect((await bob.next('view', 0)).view.station).toMatchObject({ number: 2, tables: [3, 4], assigned: true });
    expect((await consoleView(admin)).assignments.map((a: any) => [a.name, a.tables])).toEqual([['Ann', [1, 2]], ['Bob', [3, 4]]]);
    expect((await command({ type: 'stationReady', table: 3 }, { cookie: bobCookie })).status).toBe(200);

    // Station 1 has Ann: Cy waits for the next round.
    const cyCookie = await pair(admin, 'Cy', 1);
    const cy = await connect({ cookie: cyCookie });
    const cyView = (await cy.next('view', 0)).view;
    expect(cyView.station).toMatchObject({ number: 0, tables: [], assigned: false });
    expect(cyView.teams).toEqual([]);
    expect((await command({ type: 'stationReady' }, { cookie: cyCookie })).body.code).toBe('not_your_station');
    expect((await latest(ann)).station.tables).toEqual([1, 2]);

    const ctl = await consoleView(admin);
    expect(ctl.assignments).toHaveLength(2);
    expect(ctl.roster.map((r: any) => r.name).sort()).toEqual(['Ann', 'Bob', 'Cy']);
    const bobId = ctl.assignments.find((a: any) => a.name === 'Bob').deviceId;
    expect((await command({ type: 'revokeDevice', deviceId: bobId }, admin)).status).toBe(200);
    expect((await bob.closed).code).toBe(4401);
    const after = await consoleView(admin);
    expect(after.assignments.map((a: any) => a.name)).toEqual(['Ann']);
    expect(after.roster.map((r: any) => r.name).sort()).toEqual(['Ann', 'Cy']);

    // Both changes were saved, not only held in memory.
    ann.ws.close();
    cy.ws.close();
    await settle();
    await evictDurableObject(hub());
    expect((await consoleView(admin)).assignments.map((a: any) => a.name)).toEqual(['Ann']);
  });

  it('keeps every referee at the station they paired to when rotation is off', async () => {
    const admin = await lockedEvent();
    expect((await command({ type: 'setSettings', rotateReferees: false }, admin)).status).toBe(200);
    const cookies = [await pair(admin, 'Ann'), await pair(admin, 'Bob')];
    const sockets = [await connect({ cookie: cookies[0]! }), await connect({ cookie: cookies[1]! })];
    await command({ type: 'openNextRound' }, admin);
    expect((await consoleView(admin)).assignments).toEqual([]);
    for (const s of sockets) {
      const view = await latest(s);
      expect(view.station).toEqual({ number: 1, tables: [1, 2], ready: false, excluded: false, readyTables: [], assigned: true, moved: false });
      expect(view.teams.map((t: any) => t.table)).toEqual([1, 2]);
    }
    expect((await command({ type: 'stationReady', table: 1 }, { cookie: cookies[0]! })).status).toBe(200);
    expect((await command({ type: 'stationReady', table: 2 }, { cookie: cookies[1]! })).status).toBe(200);
    for (const s of sockets) expect((await latest(s)).station).toMatchObject({ ready: true, readyTables: [1, 2] });
    // A device paired during the round is at its station straight away, as before.
    const late = await connect({ cookie: await pair(admin, 'Cy', 2) });
    expect((await late.next('view', 0)).view.station).toMatchObject({ number: 2, tables: [3, 4], assigned: true });
    expect((await consoleView(admin)).assignments).toEqual([]);
  });
});
