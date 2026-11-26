import { describe, it, expect } from 'vitest';
import { champions, nextRaceFor, rowsPerColumn, scheduleRows, seedHeading, seedingLine, seedingTable, teamSearch } from '../../src/lib/selectors';
import { heatsOpen, lockedFour, lockedWith, openNext, previousEvent, previousEventDone, runRound, runRounds, seedTimes, start, teamId, viewOf } from '../support/state';
import { applyRoundUpdate } from '../../src/lib/publicState';
import { publicRoundUpdate } from '../../../server/src/core/views';
import { derive } from '../../../server/src/core/results';
import type { LiveEvent } from '../../../server/src/core/model';

describe('teamSearch', () => {
  const teams = viewOf(previousEvent()).teams;
  it('finds by substring, prefix matches first', () => {
    const names = teamSearch(teams, 'ced').map((t) => t.name);
    expect(names).toEqual(['Cedar Falls High School #1', 'Cedar Falls High School #2']);
  });
  it('ignores case and accents', () => {
    expect(teamSearch(teams, 'ncyc').map((t) => t.name)).toEqual(['NCYC']);
    expect(teamSearch(teams, 'lîndqvist').map((t) => t.name)).toEqual(['Lindqvist & ABC']);
  });
  it('returns at most 8 and nothing for a blank query', () => {
    expect(teamSearch(teams, 'a').length).toBe(8);
    expect(teamSearch(teams, '  ')).toEqual([]);
  });
});

describe('nextRaceFor', () => {
  it('gives the table and opponents in the open round', () => {
    const e = heatsOpen();
    const next = nextRaceFor(viewOf(e), teamId(e, 'T1'));
    expect(next).toMatchObject({ round: 3, table: 1, opponents: ['T4'], status: 'upcoming' });
  });
  it('waits for the next round once the team has raced', () => {
    const e = runRound(lockedFour(), seedTimes);
    expect(nextRaceFor(viewOf(e), teamId(e, 'T1'))).toEqual({ waitingFor: 2 });
  });
  it('is null after the last round', () => {
    let e = lockedFour();
    for (let i = 0; i < 4; i++) e = runRound(e, seedTimes);
    expect(nextRaceFor(viewOf(e), teamId(e, 'T1'))).toBeNull();
  });
});

describe('schedule and seeding', () => {
  it('lists the open round by table', () => {
    const e = heatsOpen();
    expect(scheduleRows(viewOf(e)).map((r) => [r.table, r.name])).toEqual([[1, 'T1'], [2, 'T4'], [3, 'T2'], [4, 'T3']]);
  });
  it('says which tables are ready', () => {
    const e = heatsOpen();
    const ready = { ...e, stations: { ...e.stations, 2: { ready: true, excluded: false } } };
    expect(scheduleRows(viewOf(ready)).map((r) => [r.table, r.ready])).toEqual([[1, false], [2, false], [3, true], [4, true]]);
  });
  it('gives seeding rank, total and both runs', () => {
    const e = heatsOpen();
    expect(seedingLine(viewOf(e), teamId(e, 'T2'))).toMatchObject({ rank: 2, scoreMs: 220_000, runs: [110_000, 110_000] });
  });
});

const sec = (...s: number[]) => Object.fromEntries(s.map((v, i) => [`T${i + 1}`, v * 1000]));
const result = (e: LiveEvent, name: string, set: { kind: 'time'; rawMs: number } | { kind: 'status'; status: 'dnf' | 'dns' }): LiveEvent =>
  ({ ...e, overrides: [...e.overrides, { round: e.round.current, teamId: teamId(e, name), at: 5, set }] });

describe('seeding in every format', () => {
  it('names the value teams are ranked on', () => {
    expect(seedHeading({ seedingRuns: 2, seedingRank: 'total', brackets: 'placement' })).toBe('Total');
    expect(seedHeading({ seedingRuns: 3, seedingRank: 'total', brackets: 'placement' })).toBe('Total');
    expect(seedHeading({ seedingRuns: 2, seedingRank: 'best', brackets: 'placement' })).toBe('Best run');
    expect(seedHeading({ seedingRuns: 3, seedingRank: 'dropSlowest', brackets: 'none' })).toBe('Best two');
    // One run is just the time: no separate column.
    expect(seedHeading({ seedingRuns: 1, seedingRank: 'total', brackets: 'finals' })).toBe('Time');
  });

  it('one run: the run is the score', () => {
    const e = runRound(lockedWith({ seedingRuns: 1, brackets: 'finals' }), sec(100, 110, 120, 130));
    expect(seedingLine(viewOf(e), teamId(e, 'T3'))).toEqual({ rank: 3, runs: [120_000], counted: [true], scoreMs: 120_000 });
    const table = seedingTable(viewOf(e))[0]!;
    expect(table.rows.map((r) => [r.name, r.rank])).toEqual([['T1', 1], ['T2', 2], ['T3', 3], ['T4', 4]]);
  });

  it('three runs by total time, best run and best two, agreeing with the server', () => {
    const times = [sec(100, 101, 102, 103), sec(100, 90, 130, 103), sec(100, 120, 95, 103)];
    for (const [seedingRank, score] of [['total', 311_000], ['best', 90_000], ['dropSlowest', 191_000]] as const) {
      const e = runRounds(lockedWith({ seedingRuns: 3, seedingRank }), times);
      const v = viewOf(e);
      const line = seedingLine(v, teamId(e, 'T2'));
      expect(line.runs).toEqual([101_000, 90_000, 120_000]);
      expect(line.scoreMs).toBe(score);
      for (const t of v.teams) {
        expect(seedingLine(v, t.id).scoreMs).toBe(v.seedScoreMs[t.id]);
        expect(seedingLine(v, t.id).runs).toEqual(v.seedRuns[t.id]);
      }
    }
  });

  it('drop the slowest marks the run that is not counted', () => {
    let e = runRounds(lockedWith({ seedingRuns: 3, seedingRank: 'dropSlowest', brackets: 'none' }), [sec(60, 60, 50, 70), sec(61, 62, 55, 70)]);
    e = start(openNext(e));
    // Mid-way through the third run nothing is dropped yet: the run still to come is the slowest.
    expect(seedingLine(viewOf(e), teamId(e, 'T1'))).toMatchObject({ runs: [60_000, 61_000, null], counted: [true, true, false], scoreMs: 121_000 });
    e = result(result(result(result(e, 'T1', { kind: 'time', rawMs: 90_000 }), 'T2', { kind: 'status', status: 'dnf' }), 'T3', { kind: 'time', rawMs: 40_000 }), 'T4', { kind: 'time', rawMs: 70_000 });
    const v = viewOf(e);
    expect(seedingLine(v, teamId(e, 'T1'))).toMatchObject({ runs: [60_000, 61_000, 90_000], counted: [true, true, false], scoreMs: 121_000 });
    // A DNF is the slowest run, so both finished runs count.
    expect(seedingLine(v, teamId(e, 'T2'))).toMatchObject({ runs: [60_000, 62_000, null], counted: [true, true, false], scoreMs: 122_000 });
    expect(seedingLine(v, teamId(e, 'T3'))).toMatchObject({ counted: [true, false, true], scoreMs: 90_000 });
    // Equal runs: the later one is the one left out.
    expect(seedingLine(v, teamId(e, 'T4'))).toMatchObject({ counted: [true, true, false], scoreMs: 140_000 });
  });

  it('other rules mark nothing as not counted', () => {
    const e = runRounds(lockedWith({ seedingRuns: 2, seedingRank: 'best' }), [sec(100, 101, 102, 103), sec(90, 120, 102, 103)]);
    expect(seedingLine(viewOf(e), teamId(e, 'T1'))).toMatchObject({ counted: [true, true], scoreMs: 90_000 });
  });

  it('a live round update changes the score without a snapshot', () => {
    let e = runRound(lockedWith({ seedingRuns: 2, seedingRank: 'best', brackets: 'none' }), sec(100, 110, 120, 130));
    e = start(openNext(e));
    const snapshot = viewOf(e);
    const t1 = teamId(e, 'T1');
    expect(seedingLine(snapshot, t1).scoreMs).toBe(100_000);
    e = result(e, 'T1', { kind: 'time', rawMs: 80_000 });
    const live = applyRoundUpdate(snapshot, publicRoundUpdate(e, derive(e)));
    // The snapshot's own figures are stale; the selector reads the rounds.
    expect(live.seedScoreMs[t1]).toBe(100_000);
    expect(seedingLine(live, t1)).toMatchObject({ runs: [100_000, 80_000], scoreMs: 80_000 });
    expect(seedingTable(live)[0]!.rows[0]).toMatchObject({ name: 'T1', scoreMs: 80_000 });
  });

  it('orders the table by the server rank once there is one, by live score before', () => {
    let e = runRound(lockedFour(), sec(130, 120, 110, 100));
    expect(viewOf(e).seedRank).toBeNull();
    expect(seedingTable(viewOf(e))[0]!.rows.map((r) => [r.name, r.rank])).toEqual([['T4', 1], ['T3', 2], ['T2', 3], ['T1', 4]]);
    e = openNext(runRound(e, sec(100, 100, 100, 200)));
    expect(seedingTable(viewOf(e))[0]!.rows.map((r) => [r.name, r.rank, r.scoreMs])).toEqual([['T3', 1, 210_000], ['T2', 2, 220_000], ['T1', 3, 230_000], ['T4', 4, 300_000]]);
  });

  it('leaves out teams with nothing to rank on yet', () => {
    const e = start(openNext(lockedFour()));
    expect(seedingTable(viewOf(result(e, 'T2', { kind: 'time', rawMs: 99_000 })))[0]!.rows.map((r) => r.name)).toEqual(['T2']);
  });
});

describe('champions', () => {
  it('names the grand champion as the winner of its top bracket, by that bracket\'s name', () => {
    const v = viewOf(previousEventDone());
    expect(champions(v)[0]!.subtitle).toMatch(/ Gold Bracket winner$/);
    const renamed = { ...v, brackets: v.brackets.map((b) => (b.tierIndex === 0 ? { ...b, tierName: 'Platinum' } : b)) };
    expect(champions(renamed)[0]!.subtitle).toMatch(/ Platinum Bracket winner$/);
  });

  it('seeding only: the grand champion was its category\'s top seed', () => {
    let e = lockedWith({ seedingRuns: 1, brackets: 'none' }, { counts: { A: 2, B: 2 }, grand: true });
    e = runRounds(e, [{ 'A 1': 100_000, 'A 2': 90_000, 'B 1': 80_000, 'B 2': 85_000 }, { 'A 2': 100_000, 'B 1': 95_000 }]);
    expect(champions(viewOf(e))).toEqual([{ key: 'grand', title: 'Grand Champion', teamId: teamId(e, 'B 1'), name: 'B 1', subtitle: 'B top seed' }]);
  });

  it('seeding only with one category: the top seed is the champion', () => {
    const e = runRounds(lockedWith({ seedingRuns: 2, brackets: 'none' }), [sec(100, 110, 120, 130), sec(140, 100, 120, 130)]);
    expect(champions(viewOf(e))).toEqual([{ key: 't', title: 'T champion', teamId: teamId(e, 'T2'), name: 'T2', subtitle: null }]);
  });
});

describe('rowsPerColumn', () => {
  it('splits the teams over two columns', () => {
    expect([1, 2, 8, 9, 26, 50].map(rowsPerColumn)).toEqual([1, 1, 4, 5, 13, 25]);
  });
});
