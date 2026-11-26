import { describe, expect, it } from 'vitest';
import { stationOfTable, tablesOfStation } from '@race2feed/engine';
import { newEvent, type Ctx, type LiveEvent, type RosterEntry } from '../../src/core/model';
import { handleSetup } from '../../src/core/setup';
import { handleLifecycle } from '../../src/core/lifecycle';
import { derive, teamsInRound } from '../../src/core/results';
import { assignmentOf, assignRound, refereeTeams, rotationOn, tablesFor } from '../../src/core/rotation';
import { admin, blank, csvFor, ctx, lockedFour, ok, referee, refereeDev, roster } from './helpers';
import { previousEvent } from './fixture';

const rotating = (e: LiveEvent): LiveEvent => ({ ...e, settings: { ...e.settings, rotateReferees: true } });
const withRoster = (r: RosterEntry[], now = 2_000_000): Ctx => ({ ...ctx(admin, now), roster: r });
const open = (e: LiveEvent, r: RosterEntry[]) => ok(handleLifecycle(e, { type: 'openNextRound' }, withRoster(r)));

/** Readies every station, starts, gives every team a distinct time and finishes the open round. */
function race(e: LiveEvent): LiveEvent {
  const now = 2_000_000 + e.round.current * 1000;
  for (const s of Object.keys(e.stations)) {
    e = ok(handleLifecycle(e, { type: 'overrideStation', station: Number(s), state: 'ready' }, ctx(admin, now)));
  }
  e = ok(handleLifecycle(e, { type: 'startRace' }, ctx(admin, now)));
  const order = new Map(e.setup.teams.map((t, i) => [t.id, i]));
  const overrides = teamsInRound(derive(e), e.round.current).map((t) => ({
    round: e.round.current, teamId: t.teamId, at: now, set: { kind: 'time' as const, rawMs: 60_000 + order.get(t.teamId)! * 137 + e.round.current },
  }));
  e = { ...e, overrides: [...e.overrides, ...overrides] };
  return ok(handleLifecycle(e, { type: 'finishRace' }, ctx(admin, now + 1)));
}

/** Plays every round of the event, opening each with `r`. */
function playAll(e: LiveEvent, r: RosterEntry[]): LiveEvent {
  const rounds = derive(e).rounds.length;
  while (e.round.current < rounds) e = race(open(e, r));
  return e;
}

/** Plays rounds until `round` is the open one. */
function openRound(e: LiveEvent, round: number, r: RosterEntry[]): LiveEvent {
  while (e.round.current < round - 1) e = race(open(e, r));
  return open(e, r);
}

const busyStations = (e: LiveEvent, round: number) =>
  [...new Set(teamsInRound(derive(e), round).map((t) => stationOfTable(t.table, e.setup.tablesPerStation ?? 2)))].sort((a, b) => a - b);

describe('the rotate referees setting', () => {
  it('is on for new events', () => {
    const e = newEvent('ev1', 'Test', '2026-12-01', 26);
    expect(e.settings.rotateReferees).toBe(true);
    expect(rotationOn(e)).toBe(true);
  });

  it('can be changed with setup locked', () => {
    const e = rotating(lockedFour());
    const off = ok(handleSetup(e, { type: 'setSettings', rotateReferees: false }, ctx(admin)));
    expect(off.settings.rotateReferees).toBe(false);
    expect(rotationOn(off)).toBe(false);
    expect(ok(handleSetup(off, { type: 'setSettings', rotateReferees: true }, ctx(admin))).settings.rotateReferees).toBe(true);
  });

  it('leaves the setting alone when other settings change', () => {
    const e = ok(handleSetup(rotating(lockedFour()), { type: 'setSettings', undoWindowMs: 5000 }, ctx(admin)));
    expect(e.settings.rotateReferees).toBe(true);
  });

  it('refuses a value that is not true or false', () => {
    const r = handleSetup(lockedFour(), { type: 'setSettings', rotateReferees: 'yes' as unknown as boolean }, ctx(admin));
    expect(r).toMatchObject({ ok: false, code: 'invalid' });
  });
});

describe('opening a round', () => {
  it('saves one referee per busy station', () => {
    const e = open(rotating(previousEvent()), roster(13));
    const saved = e.assignments![1]!;
    const busy = busyStations(e, 1);
    expect(busy.length).toBeGreaterThan(4);
    expect(saved.map((a) => a.station).sort((a, b) => a - b)).toEqual(busy);
    expect(new Set(saved.map((a) => a.deviceId)).size).toBe(saved.length);
    const occupied = new Set(teamsInRound(derive(e), 1).map((t) => t.table));
    for (const a of saved) {
      expect(a.tables).toEqual(tablesOfStation(a.station, e.setup.tableCount, 2).filter((t) => occupied.has(t)));
      expect(a.name).toBe(roster(13).find((r) => r.deviceId === a.deviceId)!.name);
      expect(assignmentOf(e, 1, a.deviceId)).toEqual(a);
      expect(tablesFor(e, refereeDev(a.deviceId, 13), 1)).toEqual(a.tables);
    }
  });

  it('saves nothing when rotation is off', () => {
    const e = open(lockedFour(), roster(2));
    expect(e.assignments).toBeUndefined();
    expect(tablesFor(e, referee(2), 1)).toEqual(tablesOfStation(2, 4, 2));
    expect(assignmentOf(e, 1, 'dev2')).toBeUndefined();
    expect(tablesFor(e, admin, 1)).toEqual([]);
  });

  it('keeps home stations in an event stored before rotation', () => {
    const stored = lockedFour();
    delete stored.settings.rotateReferees;
    delete stored.assignments;
    expect(rotationOn(stored)).toBe(false);
    const e = playAll(stored, roster(2));
    expect(e.assignments).toBeUndefined();
    expect(tablesFor(e, referee(2), 1)).toEqual([3, 4]);
    expect(tablesFor(e, referee(1), e.round.current)).toEqual([1, 2]);
    expect(refereeTeams(e, derive(e))).toEqual({});
  });

  it('never rewrites the assignments of earlier rounds', () => {
    let e = race(open(rotating(lockedFour()), roster(2)));
    const first = e.assignments![1];
    e = open(e, roster(3).reverse());
    expect(e.assignments![1]).toEqual(first);
    expect(e.assignments![2]).toHaveLength(2);
  });

  it('gives no tables to a paired referee without an assignment that round', () => {
    const e = open(rotating(lockedFour()), roster(3));
    const idle = roster(3).find((r) => !e.assignments![1]!.some((a) => a.deviceId === r.deviceId))!;
    expect(assignmentOf(e, 1, idle.deviceId)).toBeUndefined();
    expect(tablesFor(e, refereeDev(idle.deviceId, idle.home), 1)).toEqual([]);
    // A round with no saved assignments falls back to the home station.
    expect(tablesFor(e, refereeDev(idle.deviceId, 2), 2)).toEqual([3, 4]);
  });
});

describe('who gets which station', () => {
  it('keeps a referee away from the teams they just had, and from any team a third time', () => {
    const e = playAll(rotating(previousEvent()), roster(13));
    const d = derive(e);
    const had = refereeTeams(e, d);
    expect(Object.keys(had)).toHaveLength(d.rounds.length);
    const times = new Map<string, number>();
    for (let round = 1; round <= d.rounds.length; round++) {
      for (const [deviceId, teams] of Object.entries(had[round]!)) {
        const before = new Set(had[round - 1]?.[deviceId] ?? []);
        expect(teams.filter((t) => before.has(t)), `round ${round} ${deviceId}`).toEqual([]);
        for (const t of teams) times.set(`${deviceId} ${t}`, (times.get(`${deviceId} ${t}`) ?? 0) + 1);
      }
    }
    expect(Math.max(...times.values())).toBeLessThan(3);
  });

  it('moves nobody in round 1 when every referee can stay at home', () => {
    const e = open(rotating(lockedFour()), roster(2));
    expect(e.assignments![1]).toEqual([
      { deviceId: 'dev1', name: 'Ref 1', station: 1, tables: [1, 2] },
      { deviceId: 'dev2', name: 'Ref 2', station: 2, tables: [3, 4] },
    ]);
  });

  it('covers the lowest stations when there are fewer referees than stations', () => {
    const e = open(rotating(previousEvent()), roster(2));
    const busy = busyStations(e, 1);
    expect(busy.length).toBeGreaterThanOrEqual(4);
    expect(e.round.phase).toBe('open');
    expect(e.assignments![1]!.map((a) => a.station)).toEqual(busy.slice(0, 2));
    expect(new Set(e.assignments![1]!.map((a) => a.deviceId))).toEqual(new Set(['dev1', 'dev2']));
  });

  it('opens the round with no referees at all', () => {
    const e = open(rotating(previousEvent()), roster(0));
    expect(e.round.phase).toBe('open');
    expect(e.assignments![1]).toEqual([]);
    const noRoster = ok(handleLifecycle(rotating(previousEvent()), { type: 'openNextRound' }, ctx(admin)));
    expect(noRoster.assignments![1]).toEqual([]);
    expect(playAll(rotating(lockedFour()), roster(0)).round.phase).toBe('finished');
  });

  it('is deterministic, whatever the order of the roster', () => {
    const e = openRound(rotating(previousEvent()), 3, roster(13));
    const d = derive(e);
    const shuffled = [5, 12, 0, 9, 3, 7, 1, 11, 2, 10, 4, 8, 6].map((i) => roster(13)[i]!);
    const a = assignRound(e, d, 3, roster(13));
    expect(assignRound(e, d, 3, shuffled)).toEqual(a);
    expect(assignRound(e, d, 3, roster(13))).toEqual(a);
    expect(a).toEqual(e.assignments![3]);
  });

  it('picks the lowest cost, then the fewest moves, then the lowest device ids (checked against every possibility)', () => {
    let e = ok(handleSetup(blank(8), { type: 'importTeams', csv: csvFor({ T: 8 }) }, ctx(admin)));
    e = ok(handleSetup(e, { type: 'suggestSetup' }, ctx(admin)));
    e = rotating(ok(handleSetup(e, { type: 'lockSetup' }, ctx(admin))));
    const refs = roster(5);
    const rounds = derive(e).rounds.length;
    let checked = 0;
    while (e.round.current < rounds) {
      e = open(e, refs);
      const round = e.round.current;
      const d = derive(e);
      const had = refereeTeams(e, d);
      const busy = busyStations(e, round);
      const teamsAt = (station: number) =>
        teamsInRound(d, round).filter((t) => stationOfTable(t.table, 2) === station).map((t) => t.teamId);
      const score = (ids: string[]): [number, number, string] => {
        let cost = 0;
        let moved = 0;
        ids.forEach((id, i) => {
          for (let r = 1; r < round; r++) {
            cost += teamsAt(busy[i]!).filter((t) => had[r]![id]?.includes(t)).length * (r === round - 1 ? 4 : 1);
          }
          const last = e.assignments![round - 1]?.find((a) => a.deviceId === id)?.station ?? refs.find((x) => x.deviceId === id)!.home;
          if (last !== busy[i]) moved++;
        });
        return [cost, moved, ids.join(',')];
      };
      const picks = (n: number, left: string[]): string[][] =>
        n === 0 ? [[]] : left.flatMap((id) => picks(n - 1, left.filter((x) => x !== id)).map((rest) => [id, ...rest]));
      const best = picks(busy.length, refs.map((r) => r.deviceId))
        .map(score)
        .sort((x, y) => x[0] - y[0] || x[1] - y[1] || (x[2] < y[2] ? -1 : 1))[0]!;
      // Whole stations only: compare the first referee of each station (a split final adds a second).
      const first = busy.map((s) => e.assignments![round]!.find((a) => a.station === s)!.deviceId);
      expect(score(first), `round ${round}`).toEqual(best);
      checked++;
      e = race(e);
    }
    expect(checked).toBeGreaterThanOrEqual(4);
  });

  it('is fast enough for 16 referees', () => {
    const e = rotating(previousEvent());
    const d = derive(e);
    assignRound(e, d, 1, roster(16));
    const started = performance.now();
    const a = assignRound(e, d, 1, roster(16));
    expect(performance.now() - started).toBeLessThan(50);
    expect(a.length).toBe(busyStations(e, 1).length);
  });
});

describe('finals split', () => {
  const stationsOf = (e: LiveEvent, round: number) => {
    const by: Record<number, number[][]> = {};
    for (const a of e.assignments![round]!) (by[a.station] ??= []).push(a.tables);
    return by;
  };

  it('gives the deciding race two referees when one is spare', () => {
    const e = openRound(rotating(lockedFour()), 4, roster(3));
    const d = derive(e);
    const winners = d.rounds[3]!.races.find((r) => r.role === 'winners')!;
    expect(winners.entrants.map((x) => x.table).sort()).toEqual([1, 2]);
    expect(stationsOf(e, 4)).toEqual({ 1: [[1], [2]], 2: [[3, 4]] });
    expect(new Set(e.assignments![4]!.map((a) => a.deviceId)).size).toBe(3);
    // Earlier rounds are not finals: one referee per station.
    expect(stationsOf(e, 3)).toEqual({ 1: [[1, 2]], 2: [[3, 4]] });
    const had = refereeTeams(e, d)[4]!;
    expect(Object.values(had).map((t) => t.length).sort()).toEqual([1, 1, 2]);
  });

  it('does not split without a spare referee', () => {
    const e = openRound(rotating(lockedFour()), 4, roster(2));
    expect(stationsOf(e, 4)).toEqual({ 1: [[1, 2]], 2: [[3, 4]] });
  });

  it('does not split when each referee has one table', () => {
    let e = lockedFour();
    e = ok(handleSetup(e, { type: 'unlockSetup' }, ctx(admin)));
    e = ok(handleSetup(e, { type: 'setTablesPerReferee', count: 1 }, ctx(admin)));
    e = ok(handleSetup(e, { type: 'suggestSetup' }, ctx(admin)));
    e = ok(handleSetup(e, { type: 'lockSetup' }, ctx(admin)));
    e = openRound(rotating(e), 4, roster(6));
    expect(e.assignments![4]).toHaveLength(4);
    expect(e.assignments![4]!.map((a) => a.tables)).toEqual([[1], [2], [3], [4]]);
  });
});
