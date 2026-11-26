import { describe, it, expect } from 'vitest';
import { raceAction } from '../../src/lib/raceAction';
import { ctlViewOf, lockedFour, openNext, runRound, seedTimes, start, teamId } from '../support/state';
import type { LiveEvent } from '../../../server/src/core/model';
import type { ControlView } from '../../src/lib/types';

const NOW = 5_000_000;

function pending(e: LiveEvent, n: number): LiveEvent {
  const taps = Array.from({ length: n }, (_, i) => ({
    id: `pen-${i}`, kind: 'penalty' as const, round: e.round.current, teamId: teamId(e, 'T2'), amountMs: 0, source: 'referee' as const,
    deviceId: 'd', createdAt: 5 + i, removedAt: null, review: { status: 'pending' as const },
  }));
  return { ...e, taps: [...e.taps, ...taps] };
}

const afterRound1 = () => runRound(lockedFour(), seedTimes);
const allDone = () => [1, 2, 3, 4].reduce((e) => runRound(e, seedTimes), lockedFour());
const running = () => ctlViewOf(start(openNext(lockedFour())));
const allIn = (autoFinishAt: number | null): ControlView => {
  const v = running();
  return { ...v, outstanding: [], round: { ...v.round, autoFinishAt } };
};
const tied = (v: ControlView): ControlView => ({ ...v, ties: [{ raceId: 'r1-a', teams: [['a', 'b']] }], blockers: ['Round 1: tie in r1-a'] });
const openWith = (ready: boolean[], tablesPerStation?: 1 | 2): ControlView => {
  const v = ctlViewOf(openNext(lockedFour()));
  const setup = tablesPerStation === undefined ? v.setup : { ...v.setup, tablesPerStation };
  return { ...v, setup, stations: Object.fromEntries(ready.map((r, i) => [i + 1, { ready: r, excluded: false, readyTables: [] as number[] }])) };
};
const withoutPerStation = (v: ControlView): ControlView => {
  const { tablesPerStation: _, ...setup } = v.setup;
  return { ...v, setup };
};

type Row = [string, ControlView, ReturnType<typeof raceAction>];

const rows: Row[] = [
  ['champion showing', ctlViewOf({ ...allDone(), championShown: true }),
    { label: 'Hide champion', kind: 'hideChampion', enabled: true, pulse: false, status: 'Champion is showing' }],
  ['running, teams outstanding', running(),
    { label: 'Finish now', kind: 'finish', enabled: false, pulse: false, status: 'Racing — waiting on 4 teams' }],
  ['running, all in, auto-finish counting down', allIn(NOW + 22_500),
    { label: 'Finish now', kind: 'finish', enabled: true, pulse: false, status: 'All teams in — finishing in 23 s' }],
  ['running, all in, auto-finish overdue', allIn(NOW - 2_000),
    { label: 'Finish now', kind: 'finish', enabled: true, pulse: false, status: 'All teams in — finishing in 0 s' }],
  ['running, all in, no auto-finish', allIn(null),
    { label: 'Finish now', kind: 'finish', enabled: true, pulse: true, status: 'All teams in' }],
  ['open, referees not ready (2 tables per referee)', openWith([false, false], 2),
    { label: 'Start', kind: 'start', enabled: false, pulse: false, status: 'Waiting on 2 referees to be ready' }],
  ['open, referees not ready (tables per referee not stored)', withoutPerStation(openWith([false, false])),
    { label: 'Start', kind: 'start', enabled: false, pulse: false, status: 'Waiting on 2 referees to be ready' }],
  ['open, all referees ready', openWith([true, true], 2),
    { label: 'Start', kind: 'start', enabled: true, pulse: true, status: 'All referees ready' }],
  ['open, tables not ready (1 table per referee)', openWith([false, false], 1),
    { label: 'Start', kind: 'start', enabled: false, pulse: false, status: 'Waiting on 2 tables to be ready' }],
  ['open, all tables ready (1 table per referee)', openWith([true, true], 1),
    { label: 'Start', kind: 'start', enabled: true, pulse: true, status: 'All tables ready' }],
  ['penalties pending', ctlViewOf(pending(afterRound1(), 2)),
    { label: 'Open round 2', kind: 'open', enabled: false, pulse: false, status: 'Waiting on 2 penalties to be reviewed' }],
  ['penalties pending after the last round', ctlViewOf(pending(allDone(), 1)),
    { label: 'Show champion', kind: 'showChampion', enabled: false, pulse: false, status: 'Waiting on 1 penalty to be reviewed' }],
  ['penalties pending and a tie', tied(ctlViewOf(pending(afterRound1(), 1))),
    { label: 'Open round 2', kind: 'open', enabled: false, pulse: false, status: 'Waiting on 1 penalty to be reviewed' }],
  ['undecided tie', tied(ctlViewOf(afterRound1())),
    { label: 'Open round 2', kind: 'open', enabled: false, pulse: false, status: 'Waiting on a tie to be decided' }],
  ['a finished round missing a result', { ...ctlViewOf(afterRound1()), blockers: ['Round 1: T3 has no result. Enter a time, DNF or DNS.'] },
    { label: 'Open round 2', kind: 'open', enabled: false, pulse: false, status: 'Waiting on a missing result to be entered' }],
  ['undecided tie after the last round', tied(ctlViewOf(allDone())),
    { label: 'Show champion', kind: 'showChampion', enabled: false, pulse: false, status: 'Waiting on a tie to be decided' }],
  ['a missing result after the last round', { ...ctlViewOf(allDone()), blockers: ['Round 4: T1 has no result. Enter a time, DNF or DNS.'] },
    { label: 'Show champion', kind: 'showChampion', enabled: false, pulse: false, status: 'Waiting on a missing result to be entered' }],
  ['last round finished', ctlViewOf(allDone()),
    { label: 'Show champion', kind: 'showChampion', enabled: true, pulse: true, status: 'Event complete' }],
  ['between rounds', ctlViewOf(afterRound1()),
    { label: 'Open round 2', kind: 'open', enabled: true, pulse: true, status: 'Ready to open round 2' }],
  ['before round 1', ctlViewOf(lockedFour()),
    { label: 'Open round 1', kind: 'open', enabled: true, pulse: true, status: 'Ready to open round 1' }],
  ['setup not locked', { ...ctlViewOf(lockedFour()), setupLocked: false },
    { label: 'Open round 1', kind: 'open', enabled: false, pulse: false, status: 'Waiting on setup to be locked' }],
];

describe('raceAction', () => {
  it.each(rows)('%s', (_, view, expected) => {
    expect(raceAction(view, NOW)).toEqual(expected);
  });

  it('counts one and two of each thing', () => {
    const v = running();
    expect(raceAction({ ...v, outstanding: v.outstanding.slice(0, 1) }, NOW).status).toBe('Racing — waiting on 1 team');
    expect(raceAction({ ...v, outstanding: v.outstanding.slice(0, 2) }, NOW).status).toBe('Racing — waiting on 2 teams');
    expect(raceAction(openWith([true, false], 2), NOW).status).toBe('Waiting on 1 referee to be ready');
    expect(raceAction(openWith([false, false], 2), NOW).status).toBe('Waiting on 2 referees to be ready');
    expect(raceAction(openWith([true, false], 1), NOW).status).toBe('Waiting on 1 table to be ready');
    expect(raceAction(openWith([false, false], 1), NOW).status).toBe('Waiting on 2 tables to be ready');
    expect(raceAction(ctlViewOf(pending(afterRound1(), 1)), NOW).status).toBe('Waiting on 1 penalty to be reviewed');
    expect(raceAction(ctlViewOf(pending(afterRound1(), 2)), NOW).status).toBe('Waiting on 2 penalties to be reviewed');
  });

  it('ignores excluded tables and decided penalties', () => {
    const v = openWith([true, true]);
    expect(raceAction({ ...v, stations: { ...v.stations, 3: { ready: false, excluded: true, readyTables: [] } } }, NOW).enabled).toBe(true);
    const e = pending(afterRound1(), 1);
    const decided = { ...e, taps: e.taps.map((t) => (t.id === 'pen-0' ? { ...t, review: { status: 'rejected' as const } } : t)) };
    expect(raceAction(ctlViewOf(decided), NOW).status).toBe('Ready to open round 2');
  });

  it('never pulses while the server would refuse', () => {
    for (const [, view] of rows) {
      const a = raceAction(view, NOW);
      if (a.pulse) expect(a.enabled).toBe(true);
    }
    // The server refuses to open a round before setup is locked.
    const unlocked = raceAction({ ...ctlViewOf(lockedFour()), setupLocked: false }, NOW);
    expect(unlocked).toMatchObject({ label: 'Open round 1', enabled: false, pulse: false, status: 'Waiting on setup to be locked' });
  });
});
