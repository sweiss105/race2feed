import { describe, it, expect } from 'vitest';
import { handleLifecycle } from '../../src/core/lifecycle';
import { handleSetup } from '../../src/core/setup';
import { handleTaps } from '../../src/core/taps';
import { derive } from '../../src/core/results';
import { backfillLineups } from '../../src/core/lineups';
import type { LiveEvent } from '../../src/core/model';
import { admin, blank, control, csvFor, ctx, lockedFour, ok, runRound, teamId } from './helpers';

const names = (e: LiveEvent, round: number) =>
  derive(e).rounds[round - 1]!.races.map((r) => r.entrants.map((x) => e.setup.teams.find((t) => t.id === x.teamId)!.name).join(' v '));
const times = { T1: 60_000, T2: 61_000, T3: 62_000, T4: 63_000 };

describe('saved line-ups', () => {
  it('saves the line-up when a round opens', () => {
    const e = ok(handleLifecycle(lockedFour(), { type: 'openNextRound' }, ctx(control)));
    expect(e.lineups![1]!.map((r) => r.teams.length)).toEqual([1, 1, 1, 1]);
  });

  it('a confirmed seeding correction re-tabulates without changing a raced round', () => {
    let e = runRound(runRound(lockedFour(), times), times);
    e = runRound(e, { T1: 50_000, T4: 55_000, T2: 51_000, T3: 56_000 });
    const cmd = { type: 'setResult' as const, round: 1, teamId: teamId(e, 'T4'), set: { kind: 'time' as const, rawMs: 1_000 } };
    const asked = handleTaps(e, cmd, ctx(control, 9_000_000));
    expect(asked.ok ? 'ok' : asked.code).toBe('unlock_required');
    if (!asked.ok) expect(asked.detail).toEqual({ laterRounds: [2, 3], keptRounds: [3] });
    const after = ok(handleTaps(e, { ...cmd, confirmUnlock: true }, ctx(control, 9_000_000)));
    expect(names(after, 3)).toEqual(['T1 v T4', 'T2 v T3']);
    expect(derive(after).seedRank![teamId(e, 'T4')]).toBe(1);
    expect(derive(after).rounds[3]!.races.map((r) => r.entrants.length)).toEqual([2, 2]); // placement still built from the raced heats
  });

  it('keeps every team in exactly one bracket when seeding is corrected between bracket rounds', () => {
    let e = ok(handleSetup(blank(12), { type: 'importTeams', csv: csvFor({ T: 12 }) }, ctx(admin)));
    e = ok(handleSetup(e, { type: 'setGrandChampionship', enabled: false }, ctx(admin)));
    e = ok(handleSetup(e, { type: 'suggestSetup' }, ctx(admin)));
    e = ok(handleSetup(e, { type: 'lockSetup' }, ctx(admin)));
    const seedTimes = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`T ${i + 1}`, 60_000 + (i + 1) * 1_000]));
    e = runRound(runRound(e, seedTimes), seedTimes);
    e = ok(handleLifecycle(e, { type: 'openNextRound' }, ctx(control)));
    expect(derive(e).rounds[2]!.races.every((r) => r.label.includes('Bronze'))).toBe(true);
    // T 9 (seed 9) moves ahead of T 8 (seed 8): totals 135 s against 136 s.
    const swap = { type: 'setResult' as const, round: 1, teamId: teamId(e, 'T 9'), set: { kind: 'time' as const, rawMs: 66_000 }, confirmUnlock: true };
    e = ok(handleTaps(e, swap, ctx(control, 9_000_000)));
    expect(derive(e).seedRank![teamId(e, 'T 9')]).toBe(8);
    for (const s of Object.keys(e.stations)) e = ok(handleLifecycle(e, { type: 'overrideStation', station: Number(s), state: 'ready' }, ctx(control)));
    e = ok(handleLifecycle(e, { type: 'startRace' }, ctx(control)));
    const raced = derive(e).rounds[2]!.races.flatMap((r) => r.entrants);
    e = { ...e, overrides: [...e.overrides, ...raced.map((x, i) => ({ round: 3, teamId: x.teamId, at: 9_000_001, set: { kind: 'time' as const, rawMs: 70_000 + i * 1_000 } }))] };
    e = ok(handleLifecycle(e, { type: 'finishRace' }, ctx(control, 9_000_002)));
    e = ok(handleLifecycle(e, { type: 'openNextRound' }, ctx(control, 9_000_003)));
    const ids = [3, 4].flatMap((round) => derive(e).rounds[round - 1]!.races.flatMap((r) => r.entrants.map((x) => x.teamId)));
    expect(ids).toHaveLength(12);
    expect(new Set(ids).size).toBe(12);
  });

  it('backfills line-ups for an event stored before they existed', () => {
    const e = runRound(runRound(lockedFour(), times), times);
    const legacy = { ...e, lineups: undefined, bracketMembers: undefined };
    const filled = backfillLineups(legacy);
    expect(Object.keys(filled.lineups!)).toEqual(['1', '2']);
    expect(backfillLineups(filled)).toBe(filled);
  });
});
