import { describe, expect, it } from 'vitest';
import { stationOfTable, tablesOfStation } from '@race2feed/engine';
import { newEvent, type Actor, type CommandResult, type Ctx, type LiveEvent, type RosterEntry } from '../../src/core/model';
import { handleSetup } from '../../src/core/setup';
import { handleLifecycle } from '../../src/core/lifecycle';
import { handleTaps } from '../../src/core/taps';
import { applyCommand } from '../../src/core/apply';
import { companionView, controlView, publicRoundUpdate, publicView, refereeView } from '../../src/core/views';
import { derive, teamsInRound } from '../../src/core/results';
import { assignmentOf, assignRound, refereeTeams, rotationOn, tablesFor, withLateReferee, withoutReferee } from '../../src/core/rotation';
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

const code = (r: CommandResult) => (r.ok ? 'ok' : r.code);
/** Readies every station and starts the open round at `now`. */
function start(e: LiveEvent, now = 3_000_000): LiveEvent {
  for (const s of Object.keys(e.stations)) {
    e = ok(handleLifecycle(e, { type: 'overrideStation', station: Number(s), state: 'ready' }, ctx(admin, now)));
  }
  return ok(handleLifecycle(e, { type: 'startRace' }, ctx(admin, now)));
}
const atTable = (e: LiveEvent, table: number) => teamsInRound(derive(e), e.round.current).find((t) => t.table === table)!.teamId;
const tap = (e: LiveEvent, who: Actor, table: number, now = 3_100_000) =>
  handleTaps(e, { type: 'tapFinish', teamId: atTable(e, table), atServerMs: now, clientTapId: `c-${who.deviceId}-${table}` }, ctx(who, now));
const ready = (e: LiveEvent, who: Actor, table?: number) =>
  handleLifecycle(e, { type: 'stationReady', ...(table === undefined ? {} : { table }) }, ctx(who));
/** Both referees paired to station 1: rotation puts dev1 on station 1 and dev2 on station 2. */
const bothHomeOne: RosterEntry[] = [{ deviceId: 'dev1', name: 'Ref 1', home: 1 }, { deviceId: 'dev2', name: 'Ref 2', home: 1 }];
const dev1 = refereeDev('dev1', 1);
const dev2 = refereeDev('dev2', 1);
const dev3 = refereeDev('dev3', 1);

describe('permissions follow the assignment', () => {
  const opened = () => open(rotating(lockedFour()), bothHomeOne);

  it('lets a referee tap for the assigned tables only, wherever the tablet was paired', () => {
    const e = start(opened());
    expect(e.assignments![1]!.map((a) => [a.deviceId, a.station])).toEqual([['dev1', 1], ['dev2', 2]]);
    expect(code(tap(e, dev2, 3))).toBe('ok');
    expect(code(tap(e, dev2, 1))).toBe('not_your_team');
    expect(code(tap(e, dev1, 3))).toBe('not_your_team');
    expect(code(tap(e, dev1, 2))).toBe('ok');
    const penalties = { ...e, settings: { ...e.settings, penaltiesEnabled: true } };
    const penalty = (who: Actor, table: number) =>
      handleTaps(penalties, { type: 'tapPenalty', teamId: atTable(e, table), clientTapId: `p-${who.deviceId}-${table}` }, ctx(who, 3_100_000));
    expect(code(penalty(dev2, 4))).toBe('ok');
    expect(code(penalty(dev2, 2))).toBe('not_your_team');
  });

  it('gives a referee without an assignment nothing to do', () => {
    const e = opened();
    expect(code(ready(e, dev3))).toBe('not_your_station');
    expect(code(ready(e, dev3, 1))).toBe('not_your_station');
    expect(code(tap(start(e), dev3, 1))).toBe('not_your_team');
  });

  it('marks the assigned station ready, not the one the tablet was paired to', () => {
    let e = ok(ready(opened(), dev2, 3));
    expect(e.stations[2]).toEqual({ ready: false, excluded: false, readyTables: [3] });
    expect(e.stations[1]!.readyTables).toEqual([]);
    expect(code(ready(e, dev2, 1))).toBe('not_your_table');
    e = ok(ready(e, dev2));
    expect(e.stations[2]).toEqual({ ready: true, excluded: false, readyTables: [3, 4] });
    expect(e.stations[1]!.ready).toBe(false);
  });

  it('splits Ready and taps between the two referees of a final', () => {
    let e = openRound(rotating(lockedFour()), 4, roster(3));
    const split = e.assignments![4]!.filter((a) => a.station === 1);
    expect(split.map((a) => a.tables)).toEqual([[1], [2]]);
    const lower = refereeDev(split[0]!.deviceId, 2);
    const higher = refereeDev(split[1]!.deviceId, 2);
    expect(code(ready(e, lower, 2))).toBe('not_your_table');
    expect(code(ready(e, higher, 1))).toBe('not_your_table');
    e = ok(ready(e, lower));
    expect(e.stations[1]).toEqual({ ready: false, excluded: false, readyTables: [1] });
    e = ok(ready(e, higher, 2));
    expect(e.stations[1]).toEqual({ ready: true, excluded: false, readyTables: [1, 2] });
    e = start(e);
    expect(code(tap(e, lower, 2))).toBe('not_your_team');
    expect(code(tap(e, higher, 1))).toBe('not_your_team');
    expect(code(tap(e, lower, 1))).toBe('ok');
    expect(code(tap(e, higher, 2))).toBe('ok');
  });
});

describe('the referee view follows the assignment', () => {
  it('lists exactly the teams at the assigned tables', () => {
    const e = open(rotating(lockedFour()), bothHomeOne);
    const v = refereeView(e, derive(e), dev2);
    expect(v.station).toEqual({ number: 2, tables: [3, 4], ready: false, excluded: false, readyTables: [], assigned: true, moved: true });
    expect(v.teams.map((t) => [t.name, t.table])).toEqual([['T3', 3], ['T4', 4]]);
    const home = refereeView(e, derive(e), dev1);
    expect(home.station).toMatchObject({ number: 1, tables: [1, 2], assigned: true, moved: false });
    expect(home.teams.map((t) => t.table)).toEqual([1, 2]);
  });

  it('shows a referee without an assignment no tables and no teams', () => {
    const e = open(rotating(lockedFour()), bothHomeOne);
    const v = refereeView(e, derive(e), dev3);
    expect(v.station).toEqual({ number: 0, tables: [], ready: false, excluded: true, readyTables: [], assigned: false, moved: false });
    expect(v.teams).toEqual([]);
    expect(refereeView(e, derive(e), { station: 1 }).station.assigned).toBe(false);
  });

  it('says a referee moved when the tables differ from the round before', () => {
    let e = race(open(rotating(lockedFour()), roster(2)));
    e = open(e, roster(2));
    const d = derive(e);
    for (const r of roster(2)) {
      const before = assignmentOf(e, 1, r.deviceId)!.tables;
      const now = assignmentOf(e, 2, r.deviceId)!.tables;
      expect(refereeView(e, d, refereeDev(r.deviceId, r.home)).station.moved).toBe(before.join() !== now.join());
    }
    // Rotation moves both in round 2: each would otherwise have the same teams again.
    expect(refereeView(e, d, dev1).station).toMatchObject({ number: 2, tables: [3, 4], moved: true });
    // The same tables as the round before: not moved.
    const same: LiveEvent = { ...e, assignments: { ...e.assignments, 2: e.assignments![1]! } };
    expect(refereeView(same, d, dev1).station).toMatchObject({ number: 1, tables: [1, 2], moved: false });
  });

  it('shows each referee of a split final their own table and its Ready', () => {
    let e = openRound(rotating(lockedFour()), 4, roster(3));
    const [lower, higher] = e.assignments![4]!.filter((a) => a.station === 1).map((a) => refereeDev(a.deviceId, 2));
    e = ok(ready(e, lower!));
    const mine = refereeView(e, derive(e), lower!);
    expect(mine.station).toMatchObject({ number: 1, tables: [1], ready: false, readyTables: [1], assigned: true });
    expect(mine.teams.map((t) => [t.table, t.ready])).toEqual([[1, true]]);
    const theirs = refereeView(e, derive(e), higher!);
    expect(theirs.station).toMatchObject({ number: 1, tables: [2], ready: false, readyTables: [] });
    expect(theirs.teams.map((t) => [t.table, t.ready])).toEqual([[2, false]]);
  });

  it('is what it was with rotation off, plus assigned and not moved', () => {
    const e = ok(ready(open(lockedFour(), roster(2)), referee(1), 2));
    const v = refereeView(e, derive(e), { station: 1 });
    expect(v).toEqual({
      round: { current: 1, phase: 'open', startedAt: null, finishedAt: null, autoFinishAt: null },
      settings: { ...e.settings },
      reasons: e.penaltyReasons,
      station: { number: 1, tables: [1, 2], ready: false, excluded: false, readyTables: [2], assigned: true, moved: false },
      teams: [
        { teamId: atTable(e, 1), name: 'T1', table: 1, result: null, dq: null, ready: false, penaltyPending: false, taps: [] },
        { teamId: atTable(e, 2), name: 'T2', table: 2, result: null, dq: null, ready: true, penaltyPending: false, taps: [] },
      ],
    });
    expect(refereeView(e, derive(e), referee(1))).toEqual(v);
    // A device paired to a station that does not exist, and one with no station: as an excluded station.
    expect(refereeView(e, derive(e), {}).station).toEqual({ number: 0, tables: [], ready: false, excluded: true, readyTables: [], assigned: true, moved: false });
  });
});

describe('swapReferees', () => {
  const swap = (e: LiveEvent, a: string, b: string, r: RosterEntry[]) =>
    handleLifecycle(e, { type: 'swapReferees', a, b }, withRoster(r));

  it('exchanges two referees while the round is open', () => {
    const before = open(rotating(lockedFour()), roster(2));
    const e = ok(swap(before, 'dev1', 'dev2', roster(2)));
    expect(e.assignments![1]).toEqual([
      { deviceId: 'dev2', name: 'Ref 2', station: 1, tables: [1, 2] },
      { deviceId: 'dev1', name: 'Ref 1', station: 2, tables: [3, 4] },
    ]);
    expect(code(ready(e, refereeDev('dev1', 1), 3))).toBe('ok');
    expect(code(ready(e, refereeDev('dev1', 1), 1))).toBe('not_your_table');
    expect(ok(swap(e, 'dev2', 'dev1', roster(2))).assignments).toEqual(before.assignments);
  });

  it('takes away a Ready already given at the tables involved', () => {
    let e = open(rotating(lockedFour()), roster(2));
    e = ok(ready(e, refereeDev('dev1', 1)));
    e = ok(ready(e, refereeDev('dev2', 2), 3));
    expect(e.stations[1]!.ready).toBe(true);
    e = ok(swap(e, 'dev1', 'dev2', roster(2)));
    expect(e.stations).toEqual({ 1: { ready: false, excluded: false, readyTables: [] }, 2: { ready: false, excluded: false, readyTables: [] } });
  });

  it('moves a referee without tables in, and the other out', () => {
    const before = open(rotating(lockedFour()), roster(3));
    expect(assignmentOf(before, 1, 'dev3')).toBeUndefined();
    const e = ok(swap(ok(ready(before, refereeDev('dev2', 2))), 'dev2', 'dev3', roster(3)));
    expect(e.assignments![1]).toEqual([
      { deviceId: 'dev1', name: 'Ref 1', station: 1, tables: [1, 2] },
      { deviceId: 'dev3', name: 'Ref 3', station: 2, tables: [3, 4] },
    ]);
    expect(e.stations[2]).toEqual({ ready: false, excluded: false, readyTables: [] });
    // Either way round.
    expect(ok(swap(before, 'dev3', 'dev2', roster(3))).assignments![1]).toEqual(e.assignments![1]);
  });

  it('swaps the two tables of a split final', () => {
    const before = openRound(rotating(lockedFour()), 4, roster(3));
    const [lower, higher] = before.assignments![4]!.filter((a) => a.station === 1);
    const e = ok(swap(ok(ready(before, refereeDev(lower!.deviceId, 1))), lower!.deviceId, higher!.deviceId, roster(3)));
    expect(assignmentOf(e, 4, lower!.deviceId)).toMatchObject({ station: 1, tables: [2] });
    expect(assignmentOf(e, 4, higher!.deviceId)).toMatchObject({ station: 1, tables: [1] });
    expect(e.stations[1]).toEqual({ ready: false, excluded: false, readyTables: [] });
    expect(e.assignments![3]).toEqual(before.assignments![3]);
  });

  it('is refused unless a round is open with saved assignments and both are paired referees', () => {
    const opened = open(rotating(lockedFour()), roster(3));
    expect(code(swap(rotating(lockedFour()), 'dev1', 'dev2', roster(2)))).toBe('round_not_open');
    expect(code(swap(start(opened), 'dev1', 'dev2', roster(3)))).toBe('round_not_open');
    expect(code(swap(race(opened), 'dev1', 'dev2', roster(3)))).toBe('round_not_open');
    expect(code(swap(open(lockedFour(), roster(2)), 'dev1', 'dev2', roster(2)))).toBe('rotation_off');
    expect(code(swap(opened, 'dev1', 'dev9', roster(3)))).toBe('not_found');
    expect(code(swap(opened, 'dev9', 'dev1', roster(3)))).toBe('not_found');
    expect(code(handleLifecycle(opened, { type: 'swapReferees', a: 'dev1', b: 'dev2' }, ctx(admin)))).toBe('not_found');
    expect(code(swap(opened, 'dev1', 'dev1', roster(3)))).toBe('invalid');
    expect(code(swap(open(rotating(lockedFour()), roster(0)), 'dev1', 'dev2', roster(2)))).toBe('not_assigned');
  });

  it('is for race control only', () => {
    const opened = open(rotating(lockedFour()), roster(2));
    const cmd = { type: 'swapReferees' as const, a: 'dev1', b: 'dev2' };
    expect(code(applyCommand(opened, cmd, { ...ctx(refereeDev('dev1', 1)), roster: roster(2) }))).toBe('forbidden');
    expect(code(applyCommand(opened, cmd, { ...ctx({ role: 'companion', label: 'c' }), roster: roster(2) }))).toBe('forbidden');
    expect(code(applyCommand(opened, cmd, withRoster(roster(2))))).toBe('ok');
  });
});

describe('a referee paired while a round is open', () => {
  const late: RosterEntry = { deviceId: 'dev9', name: 'Late', home: 2 };
  const one = roster(1);

  it('takes the home station when it has no referee', () => {
    const before = open(rotating(lockedFour()), one);
    expect(before.assignments![1]).toEqual([{ deviceId: 'dev1', name: 'Ref 1', station: 1, tables: [1, 2] }]);
    const e = withLateReferee(before, derive(before), late);
    expect(e.assignments![1]).toEqual([
      { deviceId: 'dev1', name: 'Ref 1', station: 1, tables: [1, 2] },
      { deviceId: 'dev9', name: 'Late', station: 2, tables: [3, 4] },
    ]);
    expect(code(ready(e, refereeDev('dev9', 2), 3))).toBe('ok');
    // Pairing does not touch Ready, and doing it twice changes nothing more.
    expect(e.stations).toEqual(before.stations);
    expect(withLateReferee(e, derive(e), late)).toBe(e);
  });

  it('waits for the next round when the home station has a referee', () => {
    const e = open(rotating(lockedFour()), one);
    expect(withLateReferee(e, derive(e), { ...late, home: 1 })).toBe(e);
    const split = openRound(rotating(lockedFour()), 4, roster(3));
    expect(withLateReferee(split, derive(split), { ...late, home: 1 })).toBe(split);
  });

  it('gets only the tables that have a team, and nothing at a station without teams', () => {
    let e = ok(handleSetup(blank(6), { type: 'importTeams', csv: csvFor({ T: 3 }) }, ctx(admin)));
    e = ok(handleSetup(e, { type: 'setGrandChampionship', enabled: false }, ctx(admin)));
    e = ok(handleSetup(e, { type: 'suggestSetup' }, ctx(admin)));
    e = open(rotating(ok(handleSetup(e, { type: 'lockSetup' }, ctx(admin)))), []);
    const d = derive(e);
    const tables = teamsInRound(d, 1).map((t) => t.table).sort((a, b) => a - b);
    expect(tables).toEqual([1, 2, 3]);
    expect(withLateReferee(e, d, late).assignments![1]).toEqual([{ deviceId: 'dev9', name: 'Late', station: 2, tables: [3] }]);
    expect(withLateReferee(e, d, { ...late, home: 3 })).toBe(e);
    expect(withLateReferee(e, d, { ...late, home: 99 })).toBe(e);
  });

  it('changes nothing once the race is running or finished, before the first round, or with rotation off', () => {
    const opened = open(rotating(lockedFour()), one);
    for (const e of [start(opened), race(opened), rotating(lockedFour()), open(lockedFour(), one)]) {
      expect(withLateReferee(e, derive(e), late)).toBe(e);
    }
  });
});

describe('a referee revoked during a round', () => {
  it('leaves the tables without a referee, while open and while running', () => {
    const opened = open(rotating(lockedFour()), roster(2));
    for (const before of [opened, start(opened)]) {
      const e = withoutReferee(before, 'dev2');
      expect(e.assignments![1]).toEqual([{ deviceId: 'dev1', name: 'Ref 1', station: 1, tables: [1, 2] }]);
      expect(tablesFor(e, refereeDev('dev2', 2), 1)).toEqual([]);
      expect(e.stations).toEqual(before.stations);
    }
  });

  it('never changes a round that is over, or an event without saved assignments', () => {
    const finished = race(open(rotating(lockedFour()), roster(2)));
    expect(withoutReferee(finished, 'dev2')).toBe(finished);
    const second = open(finished, roster(2));
    const e = withoutReferee(second, 'dev2');
    expect(e.assignments![1]).toEqual(second.assignments![1]);
    expect(e.assignments![2]!.map((a) => a.deviceId)).toEqual(['dev1']);
    const off = open(lockedFour(), roster(2));
    expect(withoutReferee(off, 'dev2')).toBe(off);
    expect(withoutReferee(second, 'nobody')).toBe(second);
  });
});

describe('who sees the assignments', () => {
  const keysDeep = (v: unknown, out = new Set<string>()): Set<string> => {
    if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.add(k); keysDeep(x, out); }
    return out;
  };

  it('race control sees the current round\'s assignments and the paired referees', () => {
    const e = open(race(open(rotating(lockedFour()), roster(2))), roster(2));
    const v = controlView(e, derive(e), { devices: [], audit: [], roster: roster(3) });
    expect(v.assignments).toEqual(e.assignments![2]);
    expect(v.roster).toEqual(roster(3));
    const off = open(lockedFour(), roster(2));
    expect(controlView(off, derive(off), { devices: [], audit: [], roster: [] }).assignments).toEqual([]);
    const idle = rotating(lockedFour());
    expect(controlView(idle, derive(idle), { devices: [], audit: [], roster: [] }).assignments).toEqual([]);
  });

  it('nobody else does', () => {
    const e = open(rotating(lockedFour()), roster(2));
    const d = derive(e);
    for (const v of [publicView(e, d), publicRoundUpdate(e, d), companionView(e, d), refereeView(e, d, dev1)]) {
      const keys = keysDeep(v);
      for (const k of ['assignments', 'roster', 'deviceId']) expect(keys.has(k), k).toBe(false);
      expect(JSON.stringify(v)).not.toContain('Ref 2');
    }
  });
});
