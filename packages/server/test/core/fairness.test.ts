import { describe, expect, it } from 'vitest';
import { applyCommand } from '../../src/core/apply';
import {
  CLOSE_MS, FAST_MS, OUTLIER_AVG_FOR_NONE, OUTLIER_FROM_ROUND, OUTLIER_MIN, REPEAT_PENALTY_ROUNDS, REPEAT_TEAM_TIMES, WINS_MARGIN,
  WINS_MIN_RACES, fairnessWarnings, type WarningKind,
} from '../../src/core/fairness';
import type { Actor, Assignment, Command, LiveEvent, RosterEntry, Tap } from '../../src/core/model';
import { derive } from '../../src/core/results';
import { handleSetup } from '../../src/core/setup';
import { companionView, controlView, publicRoundUpdate, publicView, refereeView } from '../../src/core/views';
import { admin, blank, csvFor, ctx, lockedFour, ok, referee, roster, teamId } from './helpers';
import { previousEvent } from './fixture';

const rotating = (e: LiveEvent): LiveEvent => ({ ...e, settings: { ...e.settings, rotateReferees: true } });
/** When a round starts; results are entered from one second later, one millisecond apart. */
const startOf = (round: number) => 2_000_000 + round * 1_000_000;
const send = (e: LiveEvent, cmd: Command, actor: Actor = admin, now = startOf(e.round.current), r: RosterEntry[] = []) =>
  applyCommand(e, cmd, { ...ctx(actor, now), roster: r });
const run = (...args: Parameters<typeof send>) => ok(send(...args));

const warnings = (e: LiveEvent) => fairnessWarnings(e, derive(e));
const ofKind = (e: LiveEvent, kind: WarningKind) => warnings(e).filter((w) => w.kind === kind);
const view = (e: LiveEvent) => controlView(e, derive(e), { devices: [], audit: [], roster: [] });
const nameOf = (e: LiveEvent, id: string) => e.setup.teams.find((t) => t.id === id)!.name;
const racesIn = (e: LiveEvent, round = e.round.current) => derive(e).rounds[round - 1]!.races;
const tableOf = (e: LiveEvent, round: number, name: string) =>
  racesIn(e, round).flatMap((r) => r.entrants).find((x) => x.teamId === teamId(e, name))!.table;

/** Opens the next round with these referees, marks every station ready and starts the race. */
function start(e: LiveEvent, r: RosterEntry[] = []): LiveEvent {
  e = run(e, { type: 'openNextRound' }, admin, startOf(e.round.current + 1) - 10, r);
  for (const [s, st] of Object.entries(e.stations)) if (!st.excluded) e = run(e, { type: 'overrideStation', station: Number(s), state: 'ready' });
  return run(e, { type: 'startRace' });
}

/** A time for every team that keeps this file's warnings quiet: 3:20, 3:21, … by team order. */
const usual = (e: LiveEvent, id: string) => 200_000 + e.setup.teams.findIndex((t) => t.id === id) * 1000;

/** Race control enters a time for every team of the running round still without one, in line-up order, then finishes it. */
function finish(e: LiveEvent, times: Record<string, number> = {}): LiveEvent {
  const round = e.round.current;
  let i = 0;
  for (const { teamId: id } of racesIn(e).flatMap((r) => r.entrants)) {
    const done = e.overrides.some((o) => o.round === round && o.teamId === id) || e.taps.some((t) => t.round === round && t.teamId === id && t.kind === 'finish' && t.removedAt === null);
    if (done) continue;
    e = run(e, { type: 'setResult', round, teamId: id, set: { kind: 'time', rawMs: times[nameOf(e, id)] ?? usual(e, id) } }, admin, startOf(round) + 1000 + i++);
  }
  return run(e, { type: 'finishRace' }, admin, startOf(round) + 500_000);
}

const play = (e: LiveEvent, times: Record<string, number> = {}, r: RosterEntry[] = []) => finish(start(e, r), times);
const playTo = (e: LiveEvent, rounds: number, r: RosterEntry[] = []) => {
  while (e.finishedRounds < rounds) e = play(e, {}, r);
  return e;
};

/** A stored tap, for tests that write the event directly. */
const tap = (t: Partial<Tap> & Pick<Tap, 'kind' | 'round' | 'teamId'>): Tap =>
  ({ id: `tap${++tapN}`, source: 'referee', createdAt: 1, removedAt: null, ...t });
let tapN = 0;
const penalty = (e: LiveEvent, round: number, name: string, deviceId: string, extra: Partial<Tap> = {}): Tap =>
  tap({ kind: 'penalty', round, teamId: teamId(e, name), deviceId, amountMs: 0, review: { status: 'approved', reasonId: 'sealed', reasonName: 'Bag not sealed' }, ...extra });
const assign = (deviceId: string, name: string, station: number, tables: number[]): Assignment => ({ deviceId, name, station, tables });

describe('thresholds', () => {
  it('are the ones in the spec', () => {
    expect({ FAST_MS, WINS_MIN_RACES, WINS_MARGIN, REPEAT_TEAM_TIMES, REPEAT_PENALTY_ROUNDS, OUTLIER_FROM_ROUND, OUTLIER_MIN, OUTLIER_AVG_FOR_NONE, CLOSE_MS })
      .toEqual({ FAST_MS: 30_000, WINS_MIN_RACES: 6, WINS_MARGIN: 4, REPEAT_TEAM_TIMES: 3, REPEAT_PENALTY_ROUNDS: 2, OUTLIER_FROM_ROUND: 3, OUTLIER_MIN: 3, OUTLIER_AVG_FOR_NONE: 2, CLOSE_MS: 500 });
  });
});

describe('fast_time', () => {
  it('fires for a time 30 000 ms faster than the fastest time before it', () => {
    const e = play(lockedFour(), { T1: 200_000, T2: 170_000 });
    const found = ofKind(e, 'fast_time');
    expect(found).toHaveLength(1);
    expect(found[0]).toEqual({
      id: `fast_time:1:-:${teamId(e, 'T2')}`, kind: 'fast_time', round: 1, referee: null, refereeId: null, teamIds: [teamId(e, 'T2')],
      message: "T2's time of 2:50.00 in round 1 is 30.0 s faster than the fastest time before it.",
    });
  });

  it('stays quiet at 29 999 ms', () => {
    expect(ofKind(play(lockedFour(), { T1: 200_000, T2: 170_001 }), 'fast_time')).toEqual([]);
  });

  it('compares with times recorded earlier only, not with slower times that came later', () => {
    expect(ofKind(play(lockedFour(), { T1: 150_000, T2: 200_000 }), 'fast_time')).toEqual([]);
  });

  it('compares with the fastest time of any earlier round', () => {
    const e = play(play(lockedFour()), { T3: 165_000 });
    expect(ofKind(e, 'fast_time').map((w) => [w.round, w.teamIds, w.message])).toEqual([
      [2, [teamId(e, 'T3')], "T3's time of 2:45.00 in round 2 is 35.0 s faster than the fastest time before it."],
    ]);
  });

  it('counts the official time, penalties included', () => {
    let e = start(lockedFour());
    e = run(e, { type: 'setResult', round: 1, teamId: teamId(e, 'T1'), set: { kind: 'time', rawMs: 200_000 } }, admin, startOf(1) + 10);
    e = run(e, { type: 'setResult', round: 1, teamId: teamId(e, 'T2'), set: { kind: 'time', rawMs: 165_000 } }, admin, startOf(1) + 20);
    expect(ofKind(e, 'fast_time')).toHaveLength(1);
    // +10 s leaves it 25 s faster.
    e = run(e, { type: 'addPenalty', round: 1, teamId: teamId(e, 'T2'), reasonId: 'early' }, admin, startOf(1) + 30);
    expect(ofKind(e, 'fast_time')).toEqual([]);
  });

  it('appears while the round is running and goes when race control corrects the time', () => {
    let e = start(lockedFour());
    e = run(e, { type: 'setResult', round: 1, teamId: teamId(e, 'T1'), set: { kind: 'time', rawMs: 200_000 } }, admin, startOf(1) + 10);
    e = run(e, { type: 'setResult', round: 1, teamId: teamId(e, 'T2'), set: { kind: 'time', rawMs: 100_000 } }, admin, startOf(1) + 20);
    expect(e.round.phase).toBe('running');
    expect(ofKind(e, 'fast_time')).toHaveLength(1);
    e = play(finish(e));
    expect(ofKind(e, 'fast_time').map((w) => w.round)).toEqual([1]);
    // Round 2 is over and nothing later is open: the correction needs no unlock.
    e = run(e, { type: 'setResult', round: 1, teamId: teamId(e, 'T2'), set: { kind: 'time', rawMs: 195_000 }, confirmUnlock: true }, admin, startOf(3));
    expect(ofKind(e, 'fast_time')).toEqual([]);
  });

  it('names the referee who had the team when one is known', () => {
    const e = play(rotating(lockedFour()), { T1: 200_000, T2: 160_000 }, roster(2));
    expect(ofKind(e, 'fast_time')).toMatchObject([{ referee: 'Ref 1', refereeId: 'dev1', id: `fast_time:1:dev1:${teamId(e, 'T2')}` }]);
  });
});

/** Rounds 1 and 2 raced and round 3 (two heats of two) running. */
const heatsRunning = (e: LiveEvent, r: RosterEntry[] = []) => start(playTo(e, 2, r), r);
/** The race of the current round whose teams are at this station (two tables per referee). */
const raceAt = (e: LiveEvent, station: number) =>
  racesIn(e).find((r) => r.entrants.every((x) => Math.ceil(x.table / 2) === station))!;

describe('close_finish', () => {
  const close = (gap: number, r: RosterEntry[], e = rotating(lockedFour())) => {
    e = heatsRunning(e, r);
    const [a, b] = raceAt(e, 1).entrants.map((x) => nameOf(e, x.teamId)) as [string, string];
    return { e: finish(e, { [a]: 220_000, [b]: 220_000 + gap }), a, b };
  };

  it('fires for two teams of one race 500 ms apart at one referee', () => {
    const { e, a, b } = close(500, roster(2));
    const judge = e.assignments![3]!.find((x) => x.station === 1)!;
    expect(ofKind(e, 'close_finish')).toEqual([{
      id: `close_finish:3:${judge.deviceId}:${[teamId(e, a), teamId(e, b)].sort().join(',')}`, kind: 'close_finish', round: 3,
      referee: judge.name, refereeId: judge.deviceId, teamIds: [teamId(e, a), teamId(e, b)].sort(),
      message: `${a} and ${b} finished 0.50 s apart in round 3, both judged by ${judge.name}.`,
    }]);
  });

  it('stays quiet at 501 ms', () => {
    expect(ofKind(close(501, roster(2)).e, 'close_finish')).toEqual([]);
  });

  it('stays quiet when the two teams had different referees', () => {
    // Round 4: a spare referee splits the Winners race, so its two teams have one referee each.
    let e = start(playTo(rotating(lockedFour()), 3, roster(3)), roster(3));
    const winners = racesIn(e).find((r) => r.role === 'winners')!;
    const [a, b] = winners.entrants.map((x) => nameOf(e, x.teamId)) as [string, string];
    e = finish(e, { [a]: 220_000, [b]: 220_100 });
    expect(ofKind(e, 'close_finish')).toEqual([]);
  });

  it('stays quiet for teams of different races', () => {
    // Seeding: every team races alone, two of them at each referee.
    expect(ofKind(play(rotating(lockedFour()), { T1: 200_000, T2: 200_100 }, roster(2)), 'close_finish')).toEqual([]);
  });

  it('falls back to the tablet that tapped both finishes when no assignment is saved, without a name', () => {
    let e = heatsRunning(lockedFour());
    const [a, b] = raceAt(e, 1).entrants.map((x) => x.teamId) as [string, string];
    e = run(e, { type: 'tapFinish', teamId: a, atServerMs: startOf(3) + 100_000, clientTapId: 'a' }, referee(1), startOf(3) + 100_000);
    e = run(e, { type: 'tapFinish', teamId: b, atServerMs: startOf(3) + 100_300, clientTapId: 'b' }, referee(1), startOf(3) + 100_300);
    expect(ofKind(e, 'close_finish')).toMatchObject([{
      referee: null, refereeId: 'dev1', message: `${nameOf(e, a)} and ${nameOf(e, b)} finished 0.30 s apart in round 3, both judged by one referee.`,
    }]);
  });

  it('skips results nobody is known to have judged', () => {
    const e = heatsRunning(lockedFour());
    const [a, b] = raceAt(e, 1).entrants.map((x) => nameOf(e, x.teamId)) as [string, string];
    expect(ofKind(finish(e, { [a]: 220_000, [b]: 220_100 }), 'close_finish')).toEqual([]);
  });
});

describe('undo_changed_winner', () => {
  /** A referee taps `first` for team a, takes it back, and the race ends with a at `again` and b at `other` (seconds). */
  const undone = (first: number, again: number, other: number, stopBefore?: 'b') => {
    let e = heatsRunning(lockedFour());
    const [a, b] = raceAt(e, 1).entrants.map((x) => x.teamId) as [string, string];
    const at = (s: number) => startOf(3) + s * 1000;
    const finishTap = (id: string, s: number) => run(e, { type: 'tapFinish', teamId: id, atServerMs: at(s), clientTapId: `${id}-${s}` }, referee(1), at(s));
    e = finishTap(a, first);
    e = run(e, { type: 'undoTap', tapId: e.taps.at(-1)!.id }, referee(1), at(first + 1));
    e = finishTap(a, again);
    if (stopBefore !== 'b') e = finishTap(b, other);
    return { e, a: nameOf(e, a), b: nameOf(e, b) };
  };

  it('fires when the removed tap would have given the race another winner', () => {
    const { e, a, b } = undone(60, 70, 65);
    expect(ofKind(e, 'undo_changed_winner')).toEqual([{
      id: `undo_changed_winner:3:dev1:${teamId(e, a)}`, kind: 'undo_changed_winner', round: 3, referee: null, refereeId: 'dev1', teamIds: [teamId(e, a)],
      message: `A referee removed a finish tap for ${a} in round 3, which changed the winner from ${a} to ${b}.`,
    }]);
  });

  it('fires when the replacement made the team win', () => {
    const { e, a, b } = undone(70, 60, 65);
    expect(ofKind(e, 'undo_changed_winner').map((w) => w.message)).toEqual([
      `A referee removed a finish tap for ${a} in round 3, which changed the winner from ${b} to ${a}.`,
    ]);
  });

  it('stays quiet when the winner is the same either way', () => {
    expect(ofKind(undone(60, 62, 65).e, 'undo_changed_winner')).toEqual([]);
  });

  it('waits until every team of the race has a result', () => {
    expect(ofKind(undone(60, 70, 65, 'b').e, 'undo_changed_winner')).toEqual([]);
  });

  it('names the referee when the round has saved assignments', () => {
    let e = heatsRunning(rotating(lockedFour()), roster(2));
    const judge = e.assignments![3]!.find((x) => x.station === 1)!;
    const actor: Actor = { role: 'referee', label: judge.name, station: 9, deviceId: judge.deviceId };
    const [a, b] = raceAt(e, 1).entrants.map((x) => x.teamId) as [string, string];
    const at = (s: number) => startOf(3) + s * 1000;
    e = run(e, { type: 'tapFinish', teamId: a, atServerMs: at(60), clientTapId: 'a1' }, actor, at(60));
    e = run(e, { type: 'undoTap', tapId: e.taps.at(-1)!.id }, actor, at(61));
    e = run(e, { type: 'tapFinish', teamId: b, atServerMs: at(65), clientTapId: 'b1' }, actor, at(65));
    e = run(e, { type: 'tapFinish', teamId: a, atServerMs: at(70), clientTapId: 'a2' }, actor, at(70));
    expect(ofKind(e, 'undo_changed_winner').map((w) => w.message)).toEqual([
      `${judge.name} removed a finish tap for ${nameOf(e, a)} in round 3, which changed the winner from ${nameOf(e, a)} to ${nameOf(e, b)}.`,
    ]);
  });
});

describe('repeat_team', () => {
  /** All four rounds raced with no rotation, then `rounds` saved as if "Dana" (dev1) had T1's table in each. */
  const dana = (rounds: number[]) => {
    const e = playTo(lockedFour(), 4);
    return { ...e, assignments: Object.fromEntries(rounds.map((r) => [r, [assign('dev1', 'Dana', 1, [tableOf(e, r, 'T1')])]])) };
  };

  it('stays quiet the second time, when the rounds are not consecutive', () => {
    expect(ofKind(dana([1, 3]), 'repeat_team')).toEqual([]);
    expect(ofKind(dana([1, 4]), 'repeat_team')).toEqual([]);
  });

  it('fires for two consecutive rounds', () => {
    const e = dana([2, 3]);
    expect(ofKind(e, 'repeat_team')).toEqual([{
      id: `repeat_team:3:dev1:${teamId(e, 'T1')}`, kind: 'repeat_team', round: 3, referee: 'Dana', refereeId: 'dev1', teamIds: [teamId(e, 'T1')],
      message: 'Dana had T1 at their tables in rounds 2 and 3.',
    }]);
  });

  it('fires the third time, once, at the latest round', () => {
    const e = dana([1, 2, 4]);
    expect(ofKind(e, 'repeat_team').map((w) => [w.id, w.message])).toEqual([
      [`repeat_team:4:dev1:${teamId(e, 'T1')}`, 'Dana has had T1 at their tables 3 times: rounds 1, 2 and 4.'],
    ]);
  });

  it('counts the open round, so an unavoidable repeat shows as soon as the round opens', () => {
    // Two referees, four teams: by round 3 each referee has had every team, two of them in round 2.
    let e = playTo(rotating(lockedFour()), 2, roster(2));
    expect(ofKind(e, 'repeat_team')).toEqual([]);
    e = run(e, { type: 'openNextRound' }, admin, startOf(3), roster(2));
    expect(e.round.phase).toBe('open');
    const found = ofKind(e, 'repeat_team');
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((w) => w.round === 3 && /^Ref \d had T\d at their tables in rounds 2 and 3\.$/.test(w.message))).toBe(true);
  });

  it('fires when race control swaps a referee back to the teams they just had', () => {
    let e = play(rotating(lockedFour()), {}, roster(2));
    e = run(e, { type: 'openNextRound' }, admin, startOf(2), roster(2));
    expect(ofKind(e, 'repeat_team')).toEqual([]);
    e = run(e, { type: 'swapReferees', a: 'dev1', b: 'dev2' }, admin, startOf(2), roster(2));
    expect(ofKind(e, 'repeat_team').map((w) => w.message).sort()).toEqual([
      'Ref 1 had T1 at their tables in rounds 1 and 2.', 'Ref 1 had T2 at their tables in rounds 1 and 2.',
      'Ref 2 had T3 at their tables in rounds 1 and 2.', 'Ref 2 had T4 at their tables in rounds 1 and 2.',
    ]);
  });
});

describe('repeat_penalty', () => {
  /** A referee at station 1 penalises `name` in the running round; the round is finished and race control decides. */
  const penalise = (e: LiveEvent, name: string, decision: 'approve' | 'reject' | 'none', r: RosterEntry[] = []) => {
    e = start(e, r);
    const actor = r.length ? { ...referee(1), deviceId: e.assignments![e.round.current]!.find((a) => a.station === 1)!.deviceId } : referee(1);
    e = run(e, { type: 'tapPenalty', teamId: teamId(e, name), clientTapId: `p${e.round.current}` }, actor);
    const tapId = e.taps.at(-1)!.id;
    e = finish(e);
    return decision === 'none' ? e
      : run(e, { type: 'decidePenalty', tapId, decision, ...(decision === 'approve' ? { reasonId: 'sealed' } : {}) }, admin, startOf(e.round.current) + 600_000);
  };
  const withPenalties = () => run(lockedFour(), { type: 'setPenaltiesEnabled', enabled: true });

  it('fires when one referee penalised the same team in two rounds', () => {
    const e = penalise(penalise(withPenalties(), 'T1', 'approve'), 'T1', 'approve');
    expect(ofKind(e, 'repeat_penalty')).toEqual([{
      id: `repeat_penalty:2:dev1:${teamId(e, 'T1')}`, kind: 'repeat_penalty', round: 2, referee: null, refereeId: 'dev1', teamIds: [teamId(e, 'T1')],
      message: 'A referee gave T1 penalties in rounds 1 and 2.',
    }]);
  });

  it('stays quiet after one round, and for two penalties in the same round', () => {
    let e = start(withPenalties());
    e = run(e, { type: 'tapPenalty', teamId: teamId(e, 'T1'), clientTapId: 'p1' }, referee(1));
    e = run(e, { type: 'tapPenalty', teamId: teamId(e, 'T1'), clientTapId: 'p2' }, referee(1));
    expect(ofKind(finish(e), 'repeat_penalty')).toEqual([]);
  });

  it('stays quiet when the second penalty was for another team, was rejected, or was undone', () => {
    expect(ofKind(penalise(penalise(withPenalties(), 'T1', 'approve'), 'T2', 'approve'), 'repeat_penalty')).toEqual([]);
    expect(ofKind(penalise(penalise(withPenalties(), 'T1', 'approve'), 'T1', 'reject'), 'repeat_penalty')).toEqual([]);
    let e = start(penalise(withPenalties(), 'T1', 'approve'));
    e = run(e, { type: 'tapPenalty', teamId: teamId(e, 'T1'), clientTapId: 'p' }, referee(1));
    e = run(e, { type: 'undoTap', tapId: e.taps.at(-1)!.id }, referee(1));
    expect(ofKind(finish(e), 'repeat_penalty')).toEqual([]);
  });

  it('waits for the round to finish, and counts a penalty still to be reviewed', () => {
    let e = start(penalise(withPenalties(), 'T1', 'approve'));
    e = run(e, { type: 'tapPenalty', teamId: teamId(e, 'T1'), clientTapId: 'p' }, referee(1));
    expect(ofKind(e, 'repeat_penalty')).toEqual([]);
    expect(ofKind(finish(e), 'repeat_penalty')).toHaveLength(1);
  });

  it('names the referee when assignments are saved', () => {
    // One referee: station 1 is theirs in both rounds.
    const e = penalise(penalise(rotating(withPenalties()), 'T1', 'approve', roster(1)), 'T1', 'approve', roster(1));
    expect(ofKind(e, 'repeat_penalty').map((w) => w.message)).toEqual(['Ref 1 gave T1 penalties in rounds 1 and 2.']);
  });
});

describe('penalty_outlier', () => {
  /** `rounds` rounds raced, three referees saved in round 1, and this many standing penalties each (all in round 1). */
  const counts = (dev1: number, dev2: number, dev3: number, rounds = 3) => {
    const e = playTo(lockedFour(), rounds);
    const taps = [['dev1', dev1], ['dev2', dev2], ['dev3', dev3]].flatMap(([dev, n]) =>
      Array.from({ length: n as number }, () => penalty(e, 1, 'T1', dev as string)));
    return { ...e, taps: [...e.taps, ...taps], assignments: { 1: [assign('dev1', 'Dana', 1, [1]), assign('dev2', 'Eli', 1, [2]), assign('dev3', 'Fay', 2, [3, 4])] } };
  };
  const messages = (e: LiveEvent) => ofKind(e, 'penalty_outlier').map((w) => w.message);

  it('fires for a referee with at least 3 penalties and more than twice the average', () => {
    const e = counts(3, 0, 0);
    expect(ofKind(e, 'penalty_outlier')).toEqual([{
      id: 'penalty_outlier:dev1', kind: 'penalty_outlier', round: 3, referee: 'Dana', refereeId: 'dev1', teamIds: [],
      message: 'Dana has given 3 penalties; the average per referee is 1.0.',
    }]);
  });

  it('stays quiet below 3 penalties, and at exactly twice the average', () => {
    expect(messages(counts(2, 0, 0))).toEqual([]);
    // Average 2: 4 is not more than twice it; nobody has none.
    expect(messages(counts(4, 1, 1))).toEqual([]);
  });

  it('fires for a referee with none while the average is at least 2', () => {
    expect(messages(counts(3, 3, 0))).toEqual(['Fay has given no penalties; the average per referee is 2.0.']);
  });

  it('stays quiet for a referee with none while the average is below 2', () => {
    expect(messages(counts(3, 2, 0))).toEqual([]);
  });

  it('waits until three rounds are finished', () => {
    expect(messages(counts(3, 0, 0, 2))).toEqual([]);
    expect(messages(counts(3, 3, 0, 2))).toEqual([]);
  });

  it('ignores penalties that were undone or rejected, and race control\'s own', () => {
    const e = counts(2, 0, 0);
    const extra = [
      penalty(e, 1, 'T1', 'dev1', { removedAt: 5 }),
      penalty(e, 1, 'T1', 'dev1', { removedAt: 5, review: { status: 'rejected' } }),
      tap({ kind: 'penalty', round: 1, teamId: teamId(e, 'T1'), source: 'control', amountMs: 0 }),
    ];
    expect(messages({ ...e, taps: [...e.taps, ...extra] })).toEqual([]);
  });

  it('with no saved assignments, the referees are the tablets that tapped', () => {
    const e = playTo(lockedFour(), 3);
    const finishes = ['dev1', 'dev2', 'dev3'].map((deviceId) => tap({ kind: 'finish', round: 1, teamId: teamId(e, 'T1'), deviceId, elapsedMs: 200_000 }));
    const taps = [...e.taps, ...finishes, ...[1, 2, 3].map(() => penalty(e, 1, 'T1', 'dev1'))];
    expect(ofKind({ ...e, taps }, 'penalty_outlier')).toMatchObject([
      { id: 'penalty_outlier:dev1', referee: null, message: 'A referee has given 3 penalties; the average per referee is 1.0.' },
    ]);
  });
});

describe('referee_wins', () => {
  type Plan = 'better' | 'worse' | 'same';
  /**
   * The previous event with its four seeding rounds raced (team order is seeding order) and round 5 (13 heats of two)
   * raced. In heat i "Dana" (dev1) has one team: for 'better' the slower seed, who wins; for 'worse' the faster seed,
   * who loses; for 'same' the faster seed, who wins. "Eli" (dev2) has every other table.
   * `own`: Dana has both tables of those heats instead.
   */
  const heats = (plan: Plan[], opts: { own?: boolean; finished?: boolean } = {}) => {
    let e = start(playTo(previousEvent(), 4));
    const order = (id: string) => e.setup.teams.findIndex((t) => t.id === id);
    const times: Record<string, number> = {};
    const danas: number[] = [];
    racesIn(e).forEach((race, i) => {
      const [fast, slow] = [...race.entrants].sort((a, b) => order(a.teamId) - order(b.teamId)) as [typeof race.entrants[number], typeof race.entrants[number]];
      const p = plan[i];
      times[nameOf(e, fast.teamId)] = p === 'worse' ? 190_000 : 150_000 + i * 1000;
      times[nameOf(e, slow.teamId)] = p === 'better' ? 120_000 + i * 1000 : 170_000 + i * 1000;
      if (p) danas.push(...(opts.own ? [fast.table, slow.table] : [p === 'better' ? slow.table : fast.table]));
    });
    const others = racesIn(e).flatMap((r) => r.entrants.map((x) => x.table)).filter((t) => !danas.includes(t));
    e = { ...e, assignments: { 5: [assign('dev1', 'Dana', 1, danas), assign('dev2', 'Eli', 2, others)] } };
    return opts.finished === false ? e : finish(e, times);
  };
  const better = (n: number): Plan[] => Array.from({ length: n }, () => 'better');

  it('fires after 6 races with a margin of at least 4', () => {
    const e = heats(better(6));
    expect(racesIn(e, 5).length).toBeGreaterThanOrEqual(7);
    expect(ofKind(e, 'referee_wins')).toEqual([{
      id: 'referee_wins:dev1', kind: 'referee_wins', round: 5, referee: 'Dana', refereeId: 'dev1', teamIds: [],
      message: "Teams at Dana's tables finished better than their seeding predicted in 6 of 6 races, and worse in 0.",
    }]);
  });

  it('stays quiet after 5 races', () => {
    expect(ofKind(heats(better(5)), 'referee_wins')).toEqual([]);
    expect(ofKind(heats([...better(5), 'same']), 'referee_wins')).toHaveLength(1);
  });

  it('stays quiet at a margin of 3 and fires at 4', () => {
    expect(ofKind(heats([...better(5), 'worse', 'worse']), 'referee_wins')).toEqual([]);
    expect(ofKind(heats([...better(5), 'worse']), 'referee_wins').map((w) => w.message)).toEqual([
      "Teams at Dana's tables finished better than their seeding predicted in 5 of 6 races, and worse in 1.",
    ]);
  });

  it('does not count races whose teams were all at that referee', () => {
    expect(ofKind(heats(better(8), { own: true }), 'referee_wins')).toEqual([]);
  });

  it('counts finished rounds only', () => {
    expect(ofKind(heats(better(6), { finished: false }), 'referee_wins')).toEqual([]);
  });
});

describe('final_one_referee', () => {
  it('fires when the Winners race has one referee because no spare was free', () => {
    const e = run(playTo(rotating(lockedFour()), 3, roster(2)), { type: 'openNextRound' }, admin, startOf(4), roster(2));
    const winners = racesIn(e).find((r) => r.role === 'winners')!;
    const judge = e.assignments![4]!.find((a) => a.tables.includes(winners.entrants[0]!.table))!;
    const [a, b] = winners.entrants.map((x) => x.teamId) as [string, string];
    expect(ofKind(e, 'final_one_referee')).toEqual([{
      id: `final_one_referee:4:${judge.deviceId}:${[a, b].sort().join(',')}`, kind: 'final_one_referee', round: 4,
      referee: judge.name, refereeId: judge.deviceId, teamIds: [a, b].sort(),
      message: `The final between ${nameOf(e, a)} and ${nameOf(e, b)} in round 4 is judged by one referee, ${judge.name}.`,
    }]);
  });

  it('stays quiet when a spare referee split the final', () => {
    const e = run(playTo(rotating(lockedFour()), 3, roster(3)), { type: 'openNextRound' }, admin, startOf(4), roster(3));
    expect(e.assignments![4]).toHaveLength(3);
    expect(ofKind(e, 'final_one_referee')).toEqual([]);
  });

  it('stays quiet for heats, with rotation off, and with one table per referee', () => {
    expect(ofKind(playTo(rotating(lockedFour()), 3, roster(2)), 'final_one_referee')).toEqual([]);
    expect(ofKind(playTo(lockedFour(), 4, roster(2)), 'final_one_referee')).toEqual([]);
    let single = ok(handleSetup(blank(4), { type: 'importTeams', csv: csvFor({ T: 4 }) }, ctx(admin)));
    for (const cmd of [{ type: 'setGrandChampionship', enabled: false }, { type: 'setTablesPerReferee', count: 1 }, { type: 'suggestSetup' }, { type: 'lockSetup' }] as const) {
      single = ok(handleSetup(single, cmd, ctx(admin)));
    }
    single = playTo(rotating(single), 4, roster(2));
    expect(single.assignments![4]).toHaveLength(2);
    expect(ofKind(single, 'final_one_referee')).toEqual([]);
  });
});

describe('fairnessWarnings', () => {
  it('lists the newest round first, then by kind, then by id', () => {
    let e = playTo(rotating(lockedFour()), 2, roster(2));
    e = play(e, {}, roster(2));
    e = run(e, { type: 'openNextRound' }, admin, startOf(4), roster(2));
    const found = warnings(e);
    expect(found.length).toBeGreaterThan(2);
    const sorted = [...found].sort((a, b) => b.round - a.round || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    expect(found).toEqual(sorted);
    expect(new Set(found.map((w) => w.id)).size).toBe(found.length);
    expect(found[0]!.round).toBe(4);
  });

  it('is empty for a new event and for one with no rounds raced', () => {
    expect(warnings(blank())).toEqual([]);
    expect(warnings(lockedFour())).toEqual([]);
  });

  it('works on an event stored before rotation and fairness existed', () => {
    // Raced with referee tablets at their home stations: finish taps, two penalties for one team, an undo.
    let e = run(lockedFour(), { type: 'setPenaltiesEnabled', enabled: true });
    for (let round = 1; round <= 4; round++) {
      e = start(e);
      const at = (s: number) => startOf(round) + s * 1000;
      for (const race of racesIn(e)) {
        for (const [i, x] of race.entrants.entries()) {
          const actor = referee(Math.ceil(x.table / 2));
          e = run(e, { type: 'tapFinish', teamId: x.teamId, atServerMs: at(100 + i / 5), clientTapId: `f${round}-${x.table}` }, actor, at(100 + i / 5));
          if (round === 3 && i === 0) {
            e = run(e, { type: 'undoTap', tapId: e.taps.at(-1)!.id }, actor, at(101));
            e = run(e, { type: 'tapFinish', teamId: x.teamId, atServerMs: at(110), clientTapId: `g${round}-${x.table}` }, actor, at(110));
          }
          if (round <= 2 && x.table === 1) e = run(e, { type: 'tapPenalty', teamId: x.teamId, clientTapId: `p${round}` }, actor, at(120));
        }
      }
      e = run(e, { type: 'finishRace' }, admin, at(200));
      for (const t of e.taps.filter((x) => x.kind === 'penalty' && x.review?.status === 'pending')) {
        e = run(e, { type: 'decidePenalty', tapId: t.id, decision: 'approve', reasonId: 'sealed' }, admin, at(300));
      }
    }
    const stored = structuredClone(e);
    delete stored.assignments;
    delete stored.dismissed;
    delete stored.settings.rotateReferees;
    for (const t of stored.taps) { delete t.by; delete t.removedBy; }
    for (const o of stored.overrides) delete o.by;

    const found = warnings(stored);
    expect(found.map((w) => w.kind)).toEqual(expect.arrayContaining(['repeat_penalty', 'undo_changed_winner', 'close_finish']));
    for (const w of found) {
      expect(w.referee, w.id).toBeNull();
      expect(w.message, w.id).not.toMatch(/null|undefined|NaN|dev\d/);
    }
    expect(view(stored).fairness).toEqual({ open: found, dismissed: [] });
    expect(send(stored, { type: 'dismissWarning', id: found[0]!.id, note: 'Looked at it' }, admin, 9_000_000).ok).toBe(true);
  });
});

describe('dismissWarning', () => {
  /** Round 1 raced with one time flagged as too fast. */
  const flagged = () => {
    const e = play(lockedFour(), { T1: 200_000, T2: 150_000 });
    return { e, id: ofKind(e, 'fast_time')[0]!.id };
  };

  it('saves who dismissed it, when and the trimmed note, and writes a log entry', () => {
    const { e, id } = flagged();
    const r = send(e, { type: 'dismissWarning', id, note: '  Checked the video, the time is right.  ' }, { role: 'admin', label: 'kim@example.com' }, 5_000_000);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.event.dismissed).toEqual({ [id]: { by: 'kim@example.com', at: 5_000_000, note: 'Checked the video, the time is right.' } });
    expect(r.audit).toEqual({ action: 'dismissWarning', actor: 'kim@example.com', detail: { type: 'dismissWarning', id, note: '  Checked the video, the time is right.  ' } });
  });

  it('refuses an id that is not a current warning', () => {
    const { e } = flagged();
    expect(send(e, { type: 'dismissWarning', id: 'fast_time:9:-:nobody', note: 'x' })).toMatchObject({ ok: false, code: 'not_found' });
    expect(send(e, { type: 'dismissWarning', id: 'constructor', note: 'x' })).toMatchObject({ ok: false, code: 'not_found' });
  });

  it('refuses a missing, empty or too long note', () => {
    const { e, id } = flagged();
    for (const note of ['', '   ', 'x'.repeat(201), undefined as unknown as string, 5 as unknown as string]) {
      expect(send(e, { type: 'dismissWarning', id, note }), String(note).slice(0, 5)).toMatchObject({ ok: false, code: 'invalid' });
    }
    expect(send(e, { type: 'dismissWarning', id, note: 'x'.repeat(200) }).ok).toBe(true);
  });

  it('is for race control only', () => {
    const { e, id } = flagged();
    for (const actor of [referee(1), { role: 'companion', label: 'companion' } as Actor, { role: 'public', label: 'public' } as Actor]) {
      expect(send(e, { type: 'dismissWarning', id, note: 'x' }, actor), actor.role).toMatchObject({ ok: false, code: 'forbidden' });
    }
  });

  it('dismissing again replaces the note', () => {
    const { e, id } = flagged();
    const once = run(e, { type: 'dismissWarning', id, note: 'First' }, admin, 5_000_000);
    const twice = run(once, { type: 'dismissWarning', id, note: 'Second' }, admin, 6_000_000);
    expect(twice.dismissed).toEqual({ [id]: { by: 'admin', at: 6_000_000, note: 'Second' } });
  });
});

describe('what race control sees', () => {
  it('lists open warnings, and dismissed ones apart with their dismissal', () => {
    let e = play(lockedFour(), { T1: 200_000, T2: 150_000, T3: 110_000 });
    const [first, second] = ofKind(e, 'fast_time') as [ReturnType<typeof warnings>[number], ReturnType<typeof warnings>[number]];
    expect(view(e).fairness).toEqual({ open: [first, second], dismissed: [] });
    e = run(e, { type: 'dismissWarning', id: second.id, note: 'Fine' }, admin, 5_000_000);
    expect(view(e).fairness).toEqual({ open: [first], dismissed: [{ ...second, dismissal: { by: 'admin', at: 5_000_000, note: 'Fine' } }] });
  });

  it('keeps a dismissed warning dismissed when an unrelated result changes', () => {
    let e = heatsRunning(rotating(lockedFour()), roster(2));
    const [a, b] = raceAt(e, 1).entrants.map((x) => nameOf(e, x.teamId)) as [string, string];
    const [c] = raceAt(e, 2).entrants.map((x) => x.teamId) as [string];
    e = finish(e, { [a]: 220_000, [b]: 220_200 });
    const close = ofKind(e, 'close_finish')[0]!;
    e = run(e, { type: 'dismissWarning', id: close.id, note: 'Both on video' }, admin, 8_000_000);
    e = run(e, { type: 'setResult', round: 3, teamId: c, set: { kind: 'time', rawMs: 199_000 } }, admin, 8_100_000);
    e = run(e, { type: 'addPenalty', round: 3, teamId: c, reasonId: 'sealed' }, admin, 8_200_000);
    const fairness = view(e).fairness;
    expect(fairness.dismissed.filter((w) => w.kind === 'close_finish')).toEqual([{ ...close, dismissal: { by: 'admin', at: 8_000_000, note: 'Both on video' } }]);
    expect(fairness.open.some((w) => w.id === close.id)).toBe(false);
  });

  it('drops a dismissed warning that no longer applies, and shows it dismissed if it applies again', () => {
    let e = play(lockedFour(), { T1: 200_000, T2: 150_000 });
    const { id } = ofKind(e, 'fast_time')[0]!;
    e = run(e, { type: 'dismissWarning', id, note: 'Fine' }, admin, 5_000_000);
    e = run(e, { type: 'setResult', round: 1, teamId: teamId(e, 'T2'), set: { kind: 'time', rawMs: 201_000 } }, admin, 5_100_000);
    expect(view(e).fairness).toEqual({ open: [], dismissed: [] });
    e = run(e, { type: 'setResult', round: 1, teamId: teamId(e, 'T2'), set: { kind: 'time', rawMs: 150_000 } }, admin, 5_200_000);
    expect(view(e).fairness.dismissed.map((w) => w.id)).toEqual([id]);
  });

  it('shows nothing about fairness, assignments or dismissals to anyone else', () => {
    let e = playTo(rotating(lockedFour()), 3, roster(2));
    e = run(e, { type: 'openNextRound' }, admin, startOf(4), roster(2));
    e = run(e, { type: 'dismissWarning', id: warnings(e)[0]!.id, note: 'Seen' }, admin, startOf(4));
    expect(view(e).fairness.open.length).toBeGreaterThan(0);
    expect(view(e).fairness.dismissed).toHaveLength(1);
    const d = derive(e);
    const others = [publicView(e, d), publicRoundUpdate(e, d), refereeView(e, d, { station: 1, deviceId: 'dev1' }), refereeView(e, d, { station: 2 }), companionView(e, d)];
    for (const v of others) {
      const text = JSON.stringify(v);
      for (const word of ['"fairness"', '"assignments"', '"dismissed"', '"dismissal"', 'Seen', 'at their tables']) expect(text).not.toContain(word);
    }
  });
});

describe('who entered a result or penalty at the console', () => {
  it('is saved with setResult and addPenalty, and with a penalty removed or rejected', () => {
    const kim: Actor = { role: 'admin', label: 'kim@example.com' };
    let e = start(run(lockedFour(), { type: 'setPenaltiesEnabled', enabled: true }));
    e = run(e, { type: 'tapPenalty', teamId: teamId(e, 'T2'), clientTapId: 'p' }, referee(1));
    const fromReferee = e.taps.at(-1)!;
    expect(fromReferee.by).toBeUndefined();
    e = run(e, { type: 'setResult', round: 1, teamId: teamId(e, 'T1'), set: { kind: 'time', rawMs: 200_000 } }, kim);
    expect(e.overrides.at(-1)).toMatchObject({ by: 'kim@example.com' });
    e = run(e, { type: 'addPenalty', round: 1, teamId: teamId(e, 'T1'), reasonId: 'sealed' }, kim);
    const fromControl = e.taps.at(-1)!;
    expect(fromControl).toMatchObject({ source: 'control', by: 'kim@example.com' });
    e = run(e, { type: 'removePenalty', tapId: fromControl.id }, kim);
    expect(e.taps.find((t) => t.id === fromControl.id)).toMatchObject({ removedBy: 'kim@example.com' });
    e = run(e, { type: 'decidePenalty', tapId: fromReferee.id, decision: 'reject' }, kim);
    expect(e.taps.find((t) => t.id === fromReferee.id)).toMatchObject({ removedBy: 'kim@example.com', review: { status: 'rejected' } });
    e = run(e, { type: 'decidePenalty', tapId: fromReferee.id, decision: 'approve', reasonId: 'sealed' }, kim);
    expect(e.taps.find((t) => t.id === fromReferee.id)).not.toHaveProperty('removedBy');
  });

  it('is not saved for a referee\'s own finish tap or undo', () => {
    let e = start(lockedFour());
    e = run(e, { type: 'tapFinish', teamId: teamId(e, 'T1'), atServerMs: startOf(1) + 5000, clientTapId: 'f' }, referee(1), startOf(1) + 5000);
    e = run(e, { type: 'undoTap', tapId: e.taps.at(-1)!.id }, referee(1), startOf(1) + 6000);
    expect(e.taps.at(-1)).not.toHaveProperty('by');
    expect(e.taps.at(-1)).not.toHaveProperty('removedBy');
  });
});
