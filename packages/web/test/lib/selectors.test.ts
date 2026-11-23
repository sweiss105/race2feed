import { describe, it, expect } from 'vitest';
import { nextRaceFor, scheduleRows, seedingRow, teamSearch } from '../../src/lib/selectors';
import { heatsOpen, lockedFour, previousEvent, runRound, seedTimes, teamId, viewOf } from '../support/state';

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
  it('gives seeding rank, total and both runs', () => {
    const e = heatsOpen();
    expect(seedingRow(viewOf(e), teamId(e, 'T2'))).toEqual({ rank: 2, totalMs: 220_000, runs: [110_000, 110_000] });
  });
});
