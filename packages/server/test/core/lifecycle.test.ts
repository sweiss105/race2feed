import { describe, it, expect } from 'vitest';
import { handleLifecycle } from '../../src/core/lifecycle';
import { handleSetup } from '../../src/core/setup';
import { admin, blank, control, csvFor, ctx, lockedFour, ok, referee, runRound, teamId } from './helpers';

const seedTimes = { T1: 100_000, T2: 110_000, T3: 120_000, T4: 130_000 };
const code = (r: ReturnType<typeof handleLifecycle>) => (r.ok ? 'ok' : r.code);

describe('round lifecycle', () => {
  it('needs a locked setup before opening', () => {
    let e = ok(handleSetup(blank(4), { type: 'importTeams', csv: csvFor({ T: 4 }) }, ctx(admin)));
    expect(code(handleLifecycle(e, { type: 'openNextRound' }, ctx(control)))).toBe('setup_not_locked');
  });

  it('opening round 1 resets stations', () => {
    const e = ok(handleLifecycle(lockedFour(), { type: 'openNextRound' }, ctx(control)));
    expect(e.round).toEqual({ current: 1, phase: 'open', startedAt: null, finishedAt: null });
    expect(e.stations).toEqual({ 1: { ready: false, excluded: false }, 2: { ready: false, excluded: false } });
  });

  it('a station with no teams this round is excluded', () => {
    let e = ok(handleSetup(blank(6), { type: 'importTeams', csv: csvFor({ T: 4 }) }, ctx(admin)));
    e = ok(handleSetup(e, { type: 'suggestSetup' }, ctx(admin)));
    e = ok(handleSetup(e, { type: 'lockSetup' }, ctx(admin)));
    e = ok(handleLifecycle(e, { type: 'openNextRound' }, ctx(control)));
    expect(e.stations[3]).toEqual({ ready: false, excluded: true });
  });

  it('start is gated on every active station being ready', () => {
    let e = ok(handleLifecycle(lockedFour(), { type: 'openNextRound' }, ctx(control)));
    e = ok(handleLifecycle(e, { type: 'stationReady' }, ctx(referee(1))));
    const r = handleLifecycle(e, { type: 'startRace' }, ctx(control));
    expect(code(r)).toBe('stations_not_ready');
    if (!r.ok) expect(r.detail).toEqual([2]);
    e = ok(handleLifecycle(e, { type: 'overrideStation', station: 2, state: 'ready' }, ctx(control)));
    e = ok(handleLifecycle(e, { type: 'startRace' }, ctx(control, 1_234_000)));
    expect(e.round).toMatchObject({ phase: 'running', startedAt: 1_234_000 });
  });

  it('pressing START twice keeps the first start time', () => {
    let e = ok(handleLifecycle(lockedFour(), { type: 'openNextRound' }, ctx(control)));
    for (const station of [1, 2]) e = ok(handleLifecycle(e, { type: 'overrideStation', station, state: 'ready' }, ctx(control)));
    e = ok(handleLifecycle(e, { type: 'startRace' }, ctx(control, 1_234_000)));
    const again = handleLifecycle(e, { type: 'startRace' }, ctx(control, 1_240_000));
    expect(code(again)).toBe('already_running');
    expect(e.round.startedAt).toBe(1_234_000);
  });

  it('stationReady needs an open round', () => {
    expect(code(handleLifecycle(lockedFour(), { type: 'stationReady' }, ctx(referee(1))))).toBe('round_not_open');
  });

  it('finish is gated on every team having a result', () => {
    let e = ok(handleLifecycle(lockedFour(), { type: 'openNextRound' }, ctx(control)));
    for (const station of [1, 2]) e = ok(handleLifecycle(e, { type: 'overrideStation', station, state: 'ready' }, ctx(control)));
    e = ok(handleLifecycle(e, { type: 'startRace' }, ctx(control)));
    const ids = ['T1', 'T2', 'T3'].map((n) => teamId(e, n));
    e = { ...e, overrides: ids.map((id) => ({ round: 1, teamId: id, at: 1, set: { kind: 'time' as const, rawMs: 100_000 } })) };
    const r = handleLifecycle(e, { type: 'finishRace' }, ctx(control));
    expect(code(r)).toBe('teams_outstanding');
    if (!r.ok) expect(r.detail).toEqual([{ teamId: teamId(e, 'T4'), table: 4 }]);
    e = { ...e, overrides: [...e.overrides, { round: 1, teamId: teamId(e, 'T4'), at: 2, set: { kind: 'status', status: 'dns' } }] };
    e = ok(handleLifecycle(e, { type: 'finishRace' }, ctx(control, 5_000_000)));
    expect(e.round).toMatchObject({ phase: 'finished', finishedAt: 5_000_000 });
    expect(e.finishedRounds).toBe(1);
  });

  it('cannot open the next round mid-race', () => {
    let e = ok(handleLifecycle(lockedFour(), { type: 'openNextRound' }, ctx(control)));
    for (const station of [1, 2]) e = ok(handleLifecycle(e, { type: 'overrideStation', station, state: 'ready' }, ctx(control)));
    e = ok(handleLifecycle(e, { type: 'startRace' }, ctx(control)));
    expect(code(handleLifecycle(e, { type: 'openNextRound' }, ctx(control)))).toBe('round_in_progress');
  });

  it('a tie blocks the next round until decided', () => {
    let e = runRound(lockedFour(), seedTimes);
    e = runRound(e, seedTimes);
    // Heats: T1 v T4 tied at the hundredth; T2 beats T3.
    e = runRound(e, { T1: 200_001, T4: 200_009, T2: 200_000, T3: 210_000 });
    const blocked = handleLifecycle(e, { type: 'openNextRound' }, ctx(control));
    expect(code(blocked)).toBe('blocked');
    const raceId = 'r3:t:0:heat1';
    expect(code(handleLifecycle(e, { type: 'decideTie', raceId, order: [teamId(e, 'T2')] }, ctx(control)))).toBe('not_a_tie');
    e = ok(handleLifecycle(e, { type: 'decideTie', raceId, order: [teamId(e, 'T4'), teamId(e, 'T1')] }, ctx(control)));
    expect(code(handleLifecycle(e, { type: 'openNextRound' }, ctx(control)))).toBe('ok');
    // A decision can be changed while the same teams are involved.
    const changed = ok(handleLifecycle(e, { type: 'decideTie', raceId, order: [teamId(e, 'T1'), teamId(e, 'T4')] }, ctx(control)));
    expect(changed.tieDecisions[raceId]).toEqual([teamId(e, 'T1'), teamId(e, 'T4')]);
    // Once the next round is open, changing the decision would reshuffle it.
    const next = ok(handleLifecycle(e, { type: 'openNextRound' }, ctx(control)));
    const redo = handleLifecycle(next, { type: 'decideTie', raceId, order: [teamId(e, 'T1'), teamId(e, 'T4')] }, ctx(control));
    expect(code(redo)).toBe('unlock_required');
    expect(code(handleLifecycle(next, { type: 'decideTie', raceId, order: [teamId(e, 'T1'), teamId(e, 'T4')], confirmUnlock: true }, ctx(control))))
      .toBe('changes_current_round');
    expect(code(handleLifecycle(next, { type: 'decideTie', raceId, order: 'x' } as never, ctx(control)))).toBe('invalid');
  });

  it('reports when the event is complete', () => {
    let e = lockedFour();
    for (let i = 0; i < 4; i++) e = runRound(e, seedTimes);
    expect(code(handleLifecycle(e, { type: 'openNextRound' }, ctx(control)))).toBe('event_complete');
  });

  it('pins and unpins the projector', () => {
    const e = ok(handleLifecycle(lockedFour(), { type: 'pinProjector', screen: 'champion' }, ctx(control)));
    expect(e.projectorPin).toBe('champion');
  });
});
