import { describe, it, expect } from 'vitest';
import { handleSetup } from '../../src/core/setup';
import { handleLifecycle } from '../../src/core/lifecycle';
import { handleTaps } from '../../src/core/taps';
import { applyCommand } from '../../src/core/apply';
import { refereeView } from '../../src/core/views';
import { derive } from '../../src/core/results';
import { admin, blank, csvFor, ctx, ok, referee } from './helpers';
import type { LiveEvent } from '../../src/core/model';

function lockedFourSingles(): LiveEvent {
  let e = ok(handleSetup(blank(4), { type: 'importTeams', csv: csvFor({ T: 4 }).replace(/T (\d)/g, 'T$1') }, ctx(admin)));
  e = ok(handleSetup(e, { type: 'setGrandChampionship', enabled: false }, ctx(admin)));
  e = ok(handleSetup(e, { type: 'setTablesPerReferee', count: 1 }, ctx(admin)));
  e = ok(handleSetup(e, { type: 'suggestSetup' }, ctx(admin)));
  return ok(handleSetup(e, { type: 'lockSetup' }, ctx(admin)));
}

describe('tables per referee', () => {
  it('defaults to two and accepts only 1 or 2', () => {
    expect(blank().setup.tablesPerStation ?? 2).toBe(2);
    const bad = handleSetup(blank(), { type: 'setTablesPerReferee', count: 3 as 1 }, ctx(admin));
    expect(bad.ok ? 'ok' : bad.code).toBe('invalid');
  });

  it('is refused once setup is locked', () => {
    const locked = lockedFourSingles();
    const r = handleSetup(locked, { type: 'setTablesPerReferee', count: 2 }, ctx(admin));
    expect(r.ok ? 'ok' : r.code).toBe('setup_locked');
  });

  it('opens a station per table and limits each referee to its own table', () => {
    let e = ok(handleLifecycle(lockedFourSingles(), { type: 'openNextRound' }, ctx(admin)));
    expect(Object.keys(e.stations).length).toBe(4);
    for (const s of Object.keys(e.stations)) e = ok(handleLifecycle(e, { type: 'overrideStation', station: Number(s), state: 'ready' }, ctx(admin)));
    e = ok(handleLifecycle(e, { type: 'startRace' }, ctx(admin, 1_000_000)));
    const view = refereeView(e, derive(e), 3);
    expect(view.station.tables).toEqual([3]);
    expect(view.teams.map((t) => t.table)).toEqual([3]);
    const onTable = (table: number) => view.teams.find((t) => t.table === table)?.teamId
      ?? e.setup.teams.find((t) => e.setup.tableOf[t.id] === table)!.id;
    const tap = (teamIdValue: string) => handleTaps(e, { type: 'tapFinish', teamId: teamIdValue, atServerMs: 1_100_000, clientTapId: `c-${teamIdValue}` }, ctx(referee(3), 1_100_000));
    expect(tap(onTable(3)).ok).toBe(true);
    const other = tap(onTable(4));
    expect(other.ok ? 'ok' : other.code).toBe('not_your_team');
  });
});
