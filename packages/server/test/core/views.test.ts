import { describe, it, expect } from 'vitest';
import { companionView, controlView, projectorScreen, publicRoundUpdate, publicView, refereeView } from '../../src/core/views';
import { handleLifecycle } from '../../src/core/lifecycle';
import { derive } from '../../src/core/results';
import type { LiveEvent } from '../../src/core/model';
import type { DerivedEvent } from '@race2feed/engine';
import { control, ctx, lockedFour, ok, referee, runRound, teamId } from './helpers';
import { fixture, previousEvent } from './fixture';

const open = (e: LiveEvent) => ok(handleLifecycle(e, { type: 'openNextRound' }, ctx(control)));
const readyAll = (e: LiveEvent) => {
  for (const [s, st] of Object.entries(e.stations)) {
    if (!st.excluded) e = ok(handleLifecycle(e, { type: 'overrideStation', station: Number(s), state: 'ready' }, ctx(control)));
  }
  return e;
};
const start = (e: LiveEvent) => ok(handleLifecycle(readyAll(e), { type: 'startRace' }, ctx(control)));
const times = { T1: 100_000, T2: 110_000, T3: 120_000, T4: 130_000 };

function keysDeep(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) v.forEach((x) => keysDeep(x, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.add(k); keysDeep(x, out); }
  return out;
}

describe('projectorScreen', () => {
  it('follows the round phase', () => {
    let e = lockedFour();
    expect(projectorScreen(e, derive(e))).toBe('welcome');
    e = open(e);
    expect(projectorScreen(e, derive(e))).toBe('tables');
    e = start(e);
    expect(projectorScreen(e, derive(e))).toBe('clock');
    e = runRound(lockedFour(), times);
    expect(projectorScreen(e, derive(e))).toBe('seeding-results');
    e = runRound(runRound(e, times), times);
    expect(projectorScreen(e, derive(e))).toBe('brackets');
  });
  it('shows the champion after the grand round', () => {
    const e = { ...lockedFour(), round: { current: 1, phase: 'finished' as const, startedAt: 1, finishedAt: 2 } };
    const d = { rounds: [{ spec: { round: 1, kind: 'grand' }, status: 'locked', races: [] }] } as unknown as DerivedEvent;
    expect(projectorScreen(e, d)).toBe('champion');
  });
  it('a pin overrides the automatic screen', () => {
    const e = { ...lockedFour(), projectorPin: 'standings' as const };
    expect(projectorScreen(e, derive(e))).toBe('standings');
  });
});

describe('publicView', () => {
  it('never exposes taps, devices or overrides', () => {
    let e = start(open(lockedFour()));
    e = { ...e, taps: [{ id: 'x', kind: 'finish', round: 1, teamId: teamId(e, 'T1'), elapsedMs: 1, source: 'referee', deviceId: 'd', createdAt: 1, removedAt: null }] };
    const keys = keysDeep(publicView(e, derive(e)));
    for (const k of ['taps', 'deviceId', 'overrides']) expect(keys.has(k)).toBe(false);
  });
  it('shows results, places and seeding totals', () => {
    const e = runRound(lockedFour(), times);
    const v = publicView(e, derive(e));
    const t1 = v.rounds[0]!.races.flatMap((r) => r.entrants).find((x) => x.teamId === teamId(e, 'T1'))!;
    expect(t1).toMatchObject({ status: 'finished', rawMs: 100_000, officialMs: 100_000, place: 1, table: 1 });
    expect(v.seedTotalsMs[teamId(e, 'T1')]).toBe(100_000);
  });
});

describe('publicView before a round opens', () => {
  it('does not publish matchups until the round is opened', () => {
    const e = lockedFour();
    expect(publicView(e, derive(e)).rounds[0]!.races).toEqual([]);
    const opened = open(e);
    expect(publicView(opened, derive(opened)).rounds[0]!.races.length).toBe(4);
    const done = runRound(lockedFour(), times);
    expect(publicView(done, derive(done)).rounds[1]!.races).toEqual([]);
  });
});

describe('publicRoundUpdate', () => {
  it('carries the projector screen', () => {
    const e = start(open(lockedFour()));
    expect(publicRoundUpdate(e, derive(e)).projector).toBe('clock');
  });

  it('stays under 8 KB for 26 teams in a running bracket round', () => {
    let e = previousEvent();
    const byName = Object.fromEntries(fixture.teams.map((t) => [t.name, 200_000]));
    for (let r = 0; r < 4; r++) e = runRound(e, byName);
    e = start(open(e));
    const update = publicRoundUpdate(e, derive(e));
    expect(update.races.flatMap((r) => r.entrants).length).toBe(26);
    expect(JSON.stringify(update).length).toBeLessThanOrEqual(8192);
  });
});

describe('refereeView', () => {
  it('lists only the teams at the station', () => {
    const e = open(lockedFour());
    const v = refereeView(e, derive(e), 1);
    expect(v.station).toEqual({ number: 1, tables: [1, 2], ready: false, excluded: false });
    expect(v.teams.map((t) => [t.name, t.table])).toEqual([['T1', 1], ['T2', 2]]);
  });
});

describe('companionView and controlView', () => {
  it('control sees taps and overrides from every round', () => {
    let e = runRound(lockedFour(), times);
    e = { ...e, taps: [{ id: 'pen', kind: 'penalty', round: 1, teamId: teamId(e, 'T1'), amountMs: 5000, source: 'control', createdAt: 1, removedAt: null }] };
    e = open(e);
    const c = controlView(e, derive(e), { devices: [], audit: [] });
    expect(c.taps.map((t) => t.id)).toContain('pen');
    expect(c.overrides.length).toBe(4);
  });

  it('counts ready stations and outstanding teams', () => {
    let e = open(lockedFour());
    e = ok(handleLifecycle(e, { type: 'stationReady' }, ctx(referee(1))));
    expect(companionView(e, derive(e))).toMatchObject({ state: 'open', round: 1, readyCount: 1, stationCount: 2, outstanding: 4 });
    const c = controlView(e, derive(e), { devices: [], audit: [] });
    expect(c.outstanding.map((o) => o.table)).toEqual([1, 2, 3, 4]);
  });
});
