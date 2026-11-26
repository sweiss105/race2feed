import { describe, it, expect } from 'vitest';
import { handleLifecycle } from '../../src/core/lifecycle';
import { handleSetup } from '../../src/core/setup';
import { derive } from '../../src/core/results';
import { admin, blank, csvFor, ctx, lockedFour, ok, referee, runRound, teamId } from './helpers';

const seedTimes = { T1: 100_000, T2: 110_000, T3: 120_000, T4: 130_000 };
const code = (r: ReturnType<typeof handleLifecycle>) => (r.ok ? 'ok' : r.code);

describe('round lifecycle', () => {
  it('needs a locked setup before opening', () => {
    let e = ok(handleSetup(blank(4), { type: 'importTeams', csv: csvFor({ T: 4 }) }, ctx(admin)));
    expect(code(handleLifecycle(e, { type: 'openNextRound' }, ctx(admin)))).toBe('setup_not_locked');
  });

  it('opening round 1 resets stations', () => {
    const e = ok(handleLifecycle(lockedFour(), { type: 'openNextRound' }, ctx(admin)));
    expect(e.round).toEqual({ current: 1, phase: 'open', startedAt: null, finishedAt: null });
    expect(e.stations).toEqual({ 1: { ready: false, excluded: false, readyTables: [] }, 2: { ready: false, excluded: false, readyTables: [] } });
  });

  it('a station with no teams this round is excluded', () => {
    let e = ok(handleSetup(blank(6), { type: 'importTeams', csv: csvFor({ T: 4 }) }, ctx(admin)));
    e = ok(handleSetup(e, { type: 'suggestSetup' }, ctx(admin)));
    e = ok(handleSetup(e, { type: 'lockSetup' }, ctx(admin)));
    e = ok(handleLifecycle(e, { type: 'openNextRound' }, ctx(admin)));
    expect(e.stations[3]).toEqual({ ready: false, excluded: true, readyTables: [] });
  });

  it('start is gated on every active station being ready', () => {
    let e = ok(handleLifecycle(lockedFour(), { type: 'openNextRound' }, ctx(admin)));
    e = ok(handleLifecycle(e, { type: 'stationReady' }, ctx(referee(1))));
    const r = handleLifecycle(e, { type: 'startRace' }, ctx(admin));
    expect(code(r)).toBe('stations_not_ready');
    if (!r.ok) expect(r.detail).toEqual([2]);
    e = ok(handleLifecycle(e, { type: 'overrideStation', station: 2, state: 'ready' }, ctx(admin)));
    e = ok(handleLifecycle(e, { type: 'startRace' }, ctx(admin, 1_234_000)));
    expect(e.round).toMatchObject({ phase: 'running', startedAt: 1_234_000 });
  });

  it('pressing START twice keeps the first start time', () => {
    let e = ok(handleLifecycle(lockedFour(), { type: 'openNextRound' }, ctx(admin)));
    for (const station of [1, 2]) e = ok(handleLifecycle(e, { type: 'overrideStation', station, state: 'ready' }, ctx(admin)));
    e = ok(handleLifecycle(e, { type: 'startRace' }, ctx(admin, 1_234_000)));
    const again = handleLifecycle(e, { type: 'startRace' }, ctx(admin, 1_240_000));
    expect(code(again)).toBe('already_running');
    expect(e.round.startedAt).toBe(1_234_000);
  });

  it('stationReady needs an open round', () => {
    expect(code(handleLifecycle(lockedFour(), { type: 'stationReady' }, ctx(referee(1))))).toBe('round_not_open');
  });

  it('finish is gated on every team having a result', () => {
    let e = ok(handleLifecycle(lockedFour(), { type: 'openNextRound' }, ctx(admin)));
    for (const station of [1, 2]) e = ok(handleLifecycle(e, { type: 'overrideStation', station, state: 'ready' }, ctx(admin)));
    e = ok(handleLifecycle(e, { type: 'startRace' }, ctx(admin)));
    const ids = ['T1', 'T2', 'T3'].map((n) => teamId(e, n));
    e = { ...e, overrides: ids.map((id) => ({ round: 1, teamId: id, at: 1, set: { kind: 'time' as const, rawMs: 100_000 } })) };
    const r = handleLifecycle(e, { type: 'finishRace' }, ctx(admin));
    expect(code(r)).toBe('teams_outstanding');
    if (!r.ok) expect(r.detail).toEqual([{ teamId: teamId(e, 'T4'), table: 4 }]);
    e = { ...e, overrides: [...e.overrides, { round: 1, teamId: teamId(e, 'T4'), at: 2, set: { kind: 'status', status: 'dns' } }] };
    e = ok(handleLifecycle(e, { type: 'finishRace' }, ctx(admin, 5_000_000)));
    expect(e.round).toMatchObject({ phase: 'finished', finishedAt: 5_000_000 });
    expect(e.finishedRounds).toBe(1);
  });

  it('cannot open the next round mid-race', () => {
    let e = ok(handleLifecycle(lockedFour(), { type: 'openNextRound' }, ctx(admin)));
    for (const station of [1, 2]) e = ok(handleLifecycle(e, { type: 'overrideStation', station, state: 'ready' }, ctx(admin)));
    e = ok(handleLifecycle(e, { type: 'startRace' }, ctx(admin)));
    expect(code(handleLifecycle(e, { type: 'openNextRound' }, ctx(admin)))).toBe('round_in_progress');
  });

  it('a tie blocks the next round until decided', () => {
    let e = runRound(lockedFour(), seedTimes);
    e = runRound(e, seedTimes);
    // Heats: T1 v T4 tied at the hundredth; T2 beats T3.
    e = runRound(e, { T1: 200_001, T4: 200_009, T2: 200_000, T3: 210_000 });
    const blocked = handleLifecycle(e, { type: 'openNextRound' }, ctx(admin));
    expect(code(blocked)).toBe('blocked');
    const raceId = 'r3:t:0:heat1';
    expect(code(handleLifecycle(e, { type: 'decideTie', raceId, order: [teamId(e, 'T2')] }, ctx(admin)))).toBe('not_a_tie');
    e = ok(handleLifecycle(e, { type: 'decideTie', raceId, order: [teamId(e, 'T4'), teamId(e, 'T1')] }, ctx(admin)));
    expect(code(handleLifecycle(e, { type: 'openNextRound' }, ctx(admin)))).toBe('ok');
    // A decision can be changed while the same teams are involved.
    const changed = ok(handleLifecycle(e, { type: 'decideTie', raceId, order: [teamId(e, 'T1'), teamId(e, 'T4')] }, ctx(admin)));
    expect(changed.tieDecisions[raceId]).toEqual([teamId(e, 'T1'), teamId(e, 'T4')]);
    // Once the next round is open, changing the decision needs confirming and keeps its line-up.
    const next = ok(handleLifecycle(e, { type: 'openNextRound' }, ctx(admin)));
    const redo = handleLifecycle(next, { type: 'decideTie', raceId, order: [teamId(e, 'T1'), teamId(e, 'T4')] }, ctx(admin));
    expect(code(redo)).toBe('unlock_required');
    const confirmed = ok(handleLifecycle(next, { type: 'decideTie', raceId, order: [teamId(e, 'T1'), teamId(e, 'T4')], confirmUnlock: true }, ctx(admin)));
    expect(derive(confirmed).rounds[3]!.races.map((r) => r.entrants)).toEqual(derive(next).rounds[3]!.races.map((r) => r.entrants));
    expect(code(handleLifecycle(next, { type: 'decideTie', raceId, order: 'x' } as never, ctx(admin)))).toBe('invalid');
  });

  it('reports when the event is complete', () => {
    let e = lockedFour();
    for (let i = 0; i < 4; i++) e = runRound(e, seedTimes);
    expect(code(handleLifecycle(e, { type: 'openNextRound' }, ctx(admin)))).toBe('event_complete');
  });

  it('pins and unpins the projector', () => {
    const e = ok(handleLifecycle(lockedFour(), { type: 'pinProjector', screen: 'champion' }, ctx(admin)));
    expect(e.projectorPin).toBe('champion');
  });
});

describe('per-table Ready', () => {
  const opened = () => ok(handleLifecycle(lockedFour(), { type: 'openNextRound' }, ctx(admin)));
  const ready = (e: ReturnType<typeof opened>, station: number, table?: number) =>
    handleLifecycle(e, { type: 'stationReady', ...(table === undefined ? {} : { table }) }, ctx(referee(station)));

  it('one table ready leaves the station not ready and the start refused', () => {
    const e = ok(ready(opened(), 1, 1));
    expect(e.stations[1]).toEqual({ ready: false, excluded: false, readyTables: [1] });
    e.stations[2] = { ready: true, excluded: false, readyTables: [3, 4] };
    const r = handleLifecycle(e, { type: 'startRace' }, ctx(admin));
    expect(code(r)).toBe('stations_not_ready');
    if (!r.ok) expect(r.detail).toEqual([1]);
  });

  it('both tables ready makes the station ready and allows the start', () => {
    let e = ok(ready(ok(ready(opened(), 1, 2)), 1, 1));
    expect(e.stations[1]).toEqual({ ready: true, excluded: false, readyTables: [1, 2] });
    e = ok(handleLifecycle(e, { type: 'overrideStation', station: 2, state: 'ready' }, ctx(admin)));
    expect(ok(handleLifecycle(e, { type: 'startRace' }, ctx(admin))).round.phase).toBe('running');
  });

  it('refuses a table that is not the referee’s this round', () => {
    expect(code(ready(opened(), 1, 3))).toBe('not_your_table');
    expect(code(ready(opened(), 1, 99))).toBe('not_your_table');
  });

  it('a table without a team is not needed, and cannot be readied', () => {
    let e = ok(handleSetup(blank(4), { type: 'importTeams', csv: csvFor({ T: 3 }) }, ctx(admin)));
    e = ok(handleSetup(e, { type: 'setGrandChampionship', enabled: false }, ctx(admin)));
    e = ok(handleSetup(e, { type: 'suggestSetup' }, ctx(admin)));
    e = ok(handleSetup(e, { type: 'lockSetup' }, ctx(admin)));
    e = ok(handleLifecycle(e, { type: 'openNextRound' }, ctx(admin)));
    const used = new Set(derive(e).rounds[0]!.races.flatMap((r) => r.entrants.map((x) => x.table)));
    const empty = [1, 2, 3, 4].find((t) => !used.has(t))!;
    const station = Math.ceil(empty / 2);
    const other = station * 2 - (empty % 2 === 0 ? 1 : 0);
    expect(code(ready(e, station, empty))).toBe('not_your_table');
    expect(ok(ready(e, station, other)).stations[station]).toMatchObject({ ready: true, readyTables: [other] });
  });

  it('without a table (an older tablet page) readies every occupied table', () => {
    expect(ok(ready(opened(), 1)).stations[1]).toEqual({ ready: true, excluded: false, readyTables: [1, 2] });
  });

  it('race control readies and clears every table of a station', () => {
    let e = ok(ready(opened(), 1, 1));
    e = ok(handleLifecycle(e, { type: 'overrideStation', station: 1, state: 'ready' }, ctx(admin)));
    expect(e.stations[1]).toEqual({ ready: true, excluded: false, readyTables: [1, 2] });
    e = ok(handleLifecycle(e, { type: 'overrideStation', station: 1, state: 'notReady' }, ctx(admin)));
    expect(e.stations[1]).toEqual({ ready: false, excluded: false, readyTables: [] });
    e = ok(handleLifecycle(e, { type: 'overrideStation', station: 1, state: 'excluded' }, ctx(admin)));
    expect(e.stations[1]).toEqual({ ready: false, excluded: true, readyTables: [] });
  });
});
