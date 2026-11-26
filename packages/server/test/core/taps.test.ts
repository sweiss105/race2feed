import { describe, it, expect } from 'vitest';
import { handleTaps } from '../../src/core/taps';
import { applyCommand } from '../../src/core/apply';
import { handleLifecycle } from '../../src/core/lifecycle';
import { buildProgress, derive } from '../../src/core/results';
import type { CommandResult, LiveEvent } from '../../src/core/model';
import { admin, ctx, lockedFour, ok, referee, runRound, teamId } from './helpers';

const START = 1_000_000;
const code = (r: CommandResult) => (r.ok ? 'ok' : r.code);

/** Round 1 running since START; station 1 = T1, T2; station 2 = T3, T4. */
function running(): LiveEvent {
  let e = ok(handleLifecycle(lockedFour(), { type: 'openNextRound' }, ctx(admin, START)));
  for (const station of [1, 2]) e = ok(handleLifecycle(e, { type: 'overrideStation', station, state: 'ready' }, ctx(admin, START)));
  return ok(handleLifecycle(e, { type: 'startRace' }, ctx(admin, START)));
}
const tapFinish = (e: LiveEvent, name: string, atServerMs: number, clientTapId = `c-${name}-${atServerMs}`, now = atServerMs) =>
  handleTaps(e, { type: 'tapFinish', teamId: teamId(e, name), atServerMs, clientTapId }, ctx(referee(1), now));
const names = (e: LiveEvent, round: number) =>
  derive(e).rounds[round - 1]!.races.map((r) => r.entrants.map((x) => e.setup.teams.find((t) => t.id === x.teamId)!.name).join(' v '));
const result = (e: LiveEvent, name: string, round = 1) => buildProgress(e).results[round]?.[teamId(e, name)];

describe('tapFinish', () => {
  it('records elapsed time from the start; a second tap is refused', () => {
    const e = ok(tapFinish(running(), 'T1', START + 200_000));
    expect(result(e, 'T1')).toEqual({ status: 'finished', rawMs: 200_000, penaltiesMs: 0 });
    expect(code(tapFinish(e, 'T1', START + 210_000))).toBe('already_finished');
  });

  it('a resent queued tap is a no-op', () => {
    const e = ok(tapFinish(running(), 'T1', START + 200_000, 'same'));
    const again = tapFinish(e, 'T1', START + 200_000, 'same');
    expect(code(again)).toBe('ok');
    if (again.ok) expect(again.event.taps.length).toBe(e.taps.length);
  });

  it('rejects timestamps before the start or in the future', () => {
    const e = running();
    expect(code(tapFinish(e, 'T1', START - 1_000))).toBe('bad_timestamp');
    const now = START + 300_000;
    expect(code(tapFinish(e, 'T1', now + 2_001, 'x', now))).toBe('bad_timestamp');
    expect(e.taps).toEqual([]);
  });

  it('rejects teams on another station', () => {
    expect(code(tapFinish(running(), 'T3', START + 200_000))).toBe('not_your_team');
  });

  it('rejects taps when no race is running', () => {
    const e = ok(handleLifecycle(lockedFour(), { type: 'openNextRound' }, ctx(admin, START)));
    expect(code(tapFinish(e, 'T1', START))).toBe('round_not_running');
  });
});

describe('input validation', () => {
  it('rejects a tap without a usable timestamp or id', () => {
    const e = running();
    const id = teamId(e, 'T1');
    const tap = (cmd: object) => handleTaps(e, { type: 'tapFinish', teamId: id, ...cmd } as never, ctx(referee(1), START + 300_000));
    expect(code(tap({ clientTapId: 'a' }))).toBe('invalid');
    expect(code(tap({ clientTapId: 'a', atServerMs: Number.NaN }))).toBe('invalid');
    expect(code(tap({ clientTapId: '', atServerMs: START + 1 }))).toBe('invalid');
    expect(e.taps).toEqual([]);
  });
  it('rejects malformed result overrides', () => {
    const e = running();
    const set = (s: object) => handleTaps(e, { type: 'setResult', round: 1, teamId: teamId(e, 'T1'), set: s } as never, ctx(admin));
    expect(code(set({ kind: 'finished' }))).toBe('invalid');
    expect(code(set({ kind: 'status', status: 'won' }))).toBe('invalid');
    expect(code(set({ kind: 'time', rawMs: -5 }))).toBe('invalid');
  });
});

describe('taps resent or delayed into a later round', () => {
  const others = (e: LiveEvent, round: number, names: string[]) =>
    ({ ...e, overrides: [...e.overrides, ...names.map((n) => ({ round, teamId: teamId(e, n), at: 1, set: { kind: 'time' as const, rawMs: 1 } }))] });
  /** Finishes the running round 1 and starts round 2 (same teams at the same tables: one seeding group). */
  function intoRound2(e: LiveEvent): LiveEvent {
    e = ok(handleLifecycle(e, { type: 'finishRace' }, ctx(admin, START + 400_000)));
    e = ok(handleLifecycle(e, { type: 'openNextRound' }, ctx(admin, START + 500_000)));
    for (const station of [1, 2]) e = ok(handleLifecycle(e, { type: 'overrideStation', station, state: 'ready' }, ctx(admin)));
    return ok(handleLifecycle(e, { type: 'startRace' }, ctx(admin, START + 600_000)));
  }

  it('a penalty resent after it was rejected does not flag the team in the next round', () => {
    let e = ok(handleTaps(running(), { type: 'setPenaltiesEnabled', enabled: true }, ctx(admin)));
    // The command as an older referee page sends it: no round.
    const cmd = { type: 'tapPenalty' as const, teamId: teamId(e, 'T1'), clientTapId: 'pen-1' };
    e = ok(handleTaps(e, cmd, ctx(referee(1), START + 100_000)));
    e = ok(handleLifecycle(others(e, 1, ['T1', 'T2', 'T3', 'T4']), { type: 'finishRace' }, ctx(admin, START + 400_000)));
    e = ok(applyCommand(e, { type: 'decidePenalty', tapId: e.taps[0]!.id, decision: 'reject' }, ctx(admin, START + 401_000)));
    e = ok(handleLifecycle(e, { type: 'openNextRound' }, ctx(admin, START + 500_000)));
    for (const station of [1, 2]) e = ok(handleLifecycle(e, { type: 'overrideStation', station, state: 'ready' }, ctx(admin)));
    e = ok(handleLifecycle(e, { type: 'startRace' }, ctx(admin, START + 600_000)));
    const again = handleTaps(e, cmd, ctx(referee(1), START + 700_000));
    expect(code(again)).toBe('ok');
    if (again.ok) expect(again.event.taps).toEqual(e.taps);
    expect(e.taps.filter((t) => t.round === 2)).toEqual([]);
    // The same answer when the device names the round.
    const named = handleTaps(e, { ...cmd, round: 1 }, ctx(referee(1), START + 700_000));
    expect(code(named)).toBe('ok');
    if (named.ok) expect(named.event.taps).toEqual(e.taps);
  });

  it('a finish tap already delivered in an earlier round records nothing when resent', () => {
    let e = ok(tapFinish(running(), 'T1', START + 100_000, 'tap-1'));
    e = intoRound2(others(e, 1, ['T2', 'T3', 'T4']));
    const again = handleTaps(e, { type: 'tapFinish', teamId: teamId(e, 'T1'), atServerMs: START + 700_000, clientTapId: 'tap-1' }, ctx(referee(1), START + 800_000));
    expect(code(again)).toBe('ok');
    expect(result(ok(again), 'T1', 2)).toBeUndefined();
  });

  it('a resend is recognised after the tap was undone', () => {
    let e = ok(tapFinish(running(), 'T1', START + 100_000, 'tap-1', START + 100_000));
    e = ok(handleTaps(e, { type: 'undoTap', tapId: e.taps[0]!.id }, ctx(referee(1), START + 101_000)));
    const again = tapFinish(e, 'T1', START + 100_000, 'tap-1', START + 102_000);
    expect(code(again)).toBe('ok');
    expect(result(ok(again), 'T1')).toBeUndefined();
  });

  it('the same tap id from another device, team or kind is a new tap', () => {
    let e = ok(handleTaps(running(), { type: 'setPenaltiesEnabled', enabled: true }, ctx(admin)));
    e = ok(tapFinish(e, 'T1', START + 100_000, 'tap-1'));
    e = ok(tapFinish(e, 'T2', START + 110_000, 'tap-1'));
    e = ok(handleTaps(e, { type: 'tapPenalty', teamId: teamId(e, 'T1'), clientTapId: 'tap-1' }, ctx(referee(1), START + 120_000)));
    e = ok(handleTaps(e, { type: 'tapFinish', teamId: teamId(e, 'T3'), atServerMs: START + 130_000, clientTapId: 'tap-1' }, ctx(referee(2), START + 140_000)));
    expect(e.taps.map((t) => t.kind)).toEqual(['finish', 'finish', 'penalty', 'finish']);
  });

  it('a tap that names an earlier round is refused and records nothing', () => {
    let e = ok(handleTaps(running(), { type: 'setPenaltiesEnabled', enabled: true }, ctx(admin)));
    e = intoRound2(others(e, 1, ['T1', 'T2', 'T3', 'T4']));
    // Never delivered in round 1; they arrive once round 2 is running.
    const finish = handleTaps(e, { type: 'tapFinish', teamId: teamId(e, 'T1'), atServerMs: START + 650_000, clientTapId: 'late-f', round: 1 }, ctx(referee(1), START + 700_000));
    const penalty = handleTaps(e, { type: 'tapPenalty', teamId: teamId(e, 'T1'), clientTapId: 'late-p', round: 1 }, ctx(referee(1), START + 700_000));
    for (const r of [finish, penalty]) {
      expect(code(r)).toBe('round_over');
      if (!r.ok) expect(r.message).toBe('That tap was for round 1, which is over.');
    }
    expect(result(e, 'T1', 2)).toBeUndefined();
  });

  it('a tap that names the current round, or no round, is recorded', () => {
    let e = ok(handleTaps(running(), { type: 'setPenaltiesEnabled', enabled: true }, ctx(admin)));
    e = ok(handleTaps(e, { type: 'tapFinish', teamId: teamId(e, 'T1'), atServerMs: START + 100_000, clientTapId: 'f1', round: 1 }, ctx(referee(1), START + 100_000)));
    e = ok(handleTaps(e, { type: 'tapPenalty', teamId: teamId(e, 'T1'), clientTapId: 'p1', round: 1 }, ctx(referee(1), START + 100_000)));
    e = ok(tapFinish(e, 'T2', START + 110_000));
    expect(e.taps.map((t) => [t.kind, t.round])).toEqual([['finish', 1], ['penalty', 1], ['finish', 1]]);
    expect(code(handleTaps(e, { type: 'tapPenalty', teamId: teamId(e, 'T1'), clientTapId: 'p2', round: 'x' } as never, ctx(referee(1), START + 100_000)))).toBe('invalid');
  });
});

describe('penalties', () => {
  const penalty = (e: LiveEvent, name: string, clientTapId = `p-${name}`) =>
    handleTaps(e, { type: 'tapPenalty', teamId: teamId(e, name), clientTapId }, ctx(referee(1), START + 100_000));

  it('are refused while switched off', () => {
    expect(code(penalty(running(), 'T1'))).toBe('penalties_disabled');
  });

  it('add no time themselves when on, before or after the finish', () => {
    let e = ok(handleTaps(running(), { type: 'setPenaltiesEnabled', enabled: true }, ctx(admin)));
    e = ok(penalty(e, 'T1', 'p1'));
    e = ok(tapFinish(e, 'T1', START + 200_000));
    e = ok(penalty(e, 'T1', 'p2'));
    expect(result(e, 'T1')).toEqual({ status: 'finished', rawMs: 200_000, penaltiesMs: 0 });
    expect(e.taps.filter((t) => t.kind === 'penalty').map((t) => t.amountMs)).toEqual([0, 0]);
  });

  it('switching off keeps penalties already given', () => {
    let e = ok(handleTaps(running(), { type: 'setPenaltiesEnabled', enabled: true }, ctx(admin)));
    e = ok(tapFinish(ok(penalty(e, 'T1')), 'T1', START + 200_000));
    e = ok(handleTaps(e, { type: 'setPenaltiesEnabled', enabled: false }, ctx(admin)));
    expect(result(e, 'T1')?.penaltiesMs).toBe(0);
    expect(e.taps.filter((t) => t.kind === 'penalty' && t.removedAt === null).length).toBe(1);
  });

  it('a referee penalty adds no time until race control approves it', () => {
    let e = ok(handleTaps(running(), { type: 'setPenaltiesEnabled', enabled: true }, ctx(admin)));
    e = ok(tapFinish(e, 'T1', START + 60_000));
    e = ok(penalty(e, 'T1'));
    const tap = e.taps.find((t) => t.kind === 'penalty')!;
    expect(tap.amountMs).toBe(0);
    expect(tap.review?.status).toBe('pending');
    expect(buildProgress(e).results[1]![teamId(e, 'T1')]!.penaltiesMs).toBe(0);
    for (const t of e.setup.teams) if (!result(e, t.name)) e = ok(applyCommand(e, { type: 'setResult', round: 1, teamId: t.id, set: { kind: 'time', rawMs: 150_000 } }, ctx(admin, START + 300_000)));
    e = ok(handleLifecycle(e, { type: 'finishRace' }, ctx(admin, START + 300_000)));
    e = ok(applyCommand(e, { type: 'decidePenalty', tapId: tap.id, decision: 'approve', reasonId: 'early' }, ctx(admin, START + 301_000)));
    expect(buildProgress(e).results[1]![teamId(e, 'T1')]!.penaltiesMs).toBe(10_000);
  });

  it('race control can add and remove penalties even when switched off', () => {
    let e = ok(tapFinish(running(), 'T1', START + 200_000));
    e = ok(handleTaps(e, { type: 'addPenalty', round: 1, teamId: teamId(e, 'T1'), reasonId: 'sealed' }, ctx(admin)));
    expect(result(e, 'T1')?.penaltiesMs).toBe(5_000);
    const tapId = e.taps.find((t) => t.kind === 'penalty')!.id;
    e = ok(handleTaps(e, { type: 'removePenalty', tapId }, ctx(admin)));
    expect(result(e, 'T1')?.penaltiesMs).toBe(0);
  });
});

describe('undoTap', () => {
  const undo = (e: LiveEvent, now: number, device = 'dev1') =>
    handleTaps(e, { type: 'undoTap', tapId: e.taps[0]!.id }, ctx(referee(1, device), now));

  it('works within the undo window, from the same device', () => {
    const e = ok(tapFinish(running(), 'T1', START + 200_000, 'c', START + 200_000));
    const undone = ok(undo(e, START + 210_000));
    expect(undone.taps[0]!.removedAt).toBe(START + 210_000);
    expect(result(undone, 'T1')).toBeUndefined();
    expect(code(undo(e, START + 210_001))).toBe('undo_expired');
    expect(code(undo(e, START + 205_000, 'other'))).toBe('not_your_tap');
  });
});

describe('race control results', () => {
  it('sets DNF, DNS and times', () => {
    let e = running();
    e = ok(handleTaps(e, { type: 'setResult', round: 1, teamId: teamId(e, 'T3'), set: { kind: 'status', status: 'dnf' } }, ctx(admin)));
    e = ok(handleTaps(e, { type: 'setResult', round: 1, teamId: teamId(e, 'T4'), set: { kind: 'time', rawMs: 199_000 } }, ctx(admin)));
    expect(result(e, 'T3')?.status).toBe('dnf');
    expect(result(e, 'T4')?.rawMs).toBe(199_000);
  });

  const times = { T1: 100_000, T2: 110_000, T3: 120_000, T4: 130_000 };
  /** Seeding rounds 1–2 raced; heats round 3 opened (T1 v T4, T2 v T3), nothing tapped yet. */
  const heatsOpen = () => ok(handleLifecycle(runRound(runRound(lockedFour(), times), times), { type: 'openNextRound' }, ctx(admin)));

  it('a correction to an earlier round needs confirmation once a later round is open', () => {
    const e = heatsOpen();
    const cmd = { type: 'setResult' as const, round: 1, teamId: teamId(e, 'T1'), set: { kind: 'time' as const, rawMs: 99_000 } };
    const r = handleTaps(e, cmd, ctx(admin));
    expect(code(r)).toBe('unlock_required');
    if (!r.ok) expect(r.detail).toEqual({ laterRounds: [2, 3], keptRounds: [], bracketsKept: false });
    expect(code(handleTaps(e, { ...cmd, confirmUnlock: true }, ctx(admin)))).toBe('ok');
  });

  it('lists the rounds whose matchups a correction would change', () => {
    const e = heatsOpen();
    const r = handleTaps(e, { type: 'setResult', round: 2, teamId: teamId(e, 'T4'), set: { kind: 'time', rawMs: 1_000 } }, ctx(admin, 3_000_000));
    expect(code(r)).toBe('unlock_required');
    if (!r.ok) expect(r.detail).toEqual({ laterRounds: [3], keptRounds: [3], bracketsKept: true });
  });

  it('never reshuffles the round that is open or running, even when confirmed', () => {
    const e = heatsOpen();
    const r = handleTaps(e, { type: 'setResult', round: 2, teamId: teamId(e, 'T4'), set: { kind: 'time', rawMs: 1_000 }, confirmUnlock: true }, ctx(admin, 3_000_000));
    expect(names(ok(r), 3)).toEqual(names(e, 3));
  });
});

describe('resends, late finishes and waiting penalties', () => {
  it('marks a resend as unchanged, through applyCommand too, and returns the same event', () => {
    const e = ok(tapFinish(running(), 'T1', START + 200_000, 'same'));
    const cmd = { type: 'tapFinish' as const, teamId: teamId(e, 'T1'), atServerMs: START + 200_000, clientTapId: 'same' };
    for (const again of [handleTaps(e, cmd, ctx(referee(1), START + 300_000)), applyCommand(e, cmd, ctx(referee(1), START + 300_000))]) {
      expect(again).toMatchObject({ ok: true, unchanged: true });
      if (again.ok) expect(again.event).toBe(e);
    }
    const first = tapFinish(running(), 'T1', START + 200_000, 'new');
    expect(first.ok && first.unchanged).toBeFalsy();
  });

  const lateTap = (e: LiveEvent = running(), name = 'T1', lateBy = 45_000) => ok(tapFinish(e, name, START + 200_000, `late-${name}`, START + 200_000 + lateBy));
  const decide = (e: LiveEvent, decision: 'confirm' | 'reject', now = START + 260_000) =>
    handleTaps(e, { type: 'decideLateFinish', tapId: e.taps.find((t) => t.hold)!.id, decision }, ctx(admin, now));

  it('holds a finish that arrives 10 s or more after its time: the team has no result yet', () => {
    const onTime = ok(tapFinish(running(), 'T1', START + 200_000, 'a', START + 200_000 + 9_999));
    expect(onTime.taps[0]).not.toHaveProperty('hold');
    expect(result(onTime, 'T1')).toBeDefined();
    const late = lateTap();
    expect(late.taps[0]).toMatchObject({ elapsedMs: 200_000, lateMs: 45_000, createdAt: START + 245_000, hold: { status: 'pending' } });
    expect(result(late, 'T1')).toBeUndefined();
  });

  it('refuses another finish tap for the team while one is held, and still answers a resend as done', () => {
    const late = lateTap();
    expect(code(tapFinish(late, 'T1', START + 250_000, 'again', START + 250_000))).toBe('finish_held');
    expect(tapFinish(late, 'T1', START + 200_000, 'late-T1', START + 250_000)).toMatchObject({ ok: true, unchanged: true });
    expect(code(tapFinish(late, 'T2', START + 250_000, 'other', START + 250_000))).toBe('ok');
  });

  it('confirming gives the team the device’s time; only race control may decide, and only once', () => {
    const late = lateTap();
    expect(code(applyCommand(late, { type: 'decideLateFinish', tapId: late.taps[0]!.id, decision: 'confirm' }, ctx(referee(1), START + 260_000)))).toBe('forbidden');
    expect(code(handleTaps(late, { type: 'decideLateFinish', tapId: late.taps[0]!.id, decision: 'maybe' } as never, ctx(admin, START + 260_000)))).toBe('invalid');
    const e = ok(decide(late, 'confirm'));
    expect(result(e, 'T1')).toEqual({ status: 'finished', rawMs: 200_000, penaltiesMs: 0 });
    expect(e.taps[0]).toMatchObject({ createdAt: START + 245_000, removedAt: null, hold: { status: 'confirmed', decidedAt: START + 260_000, by: admin.label } });
    expect(code(decide(e, 'confirm'))).toBe('not_found');
    expect(code(decide(e, 'reject'))).toBe('not_found');
    // Confirmed, it is race control's: the referee cannot take it back.
    expect(code(handleTaps(e, { type: 'undoTap', tapId: e.taps[0]!.id }, ctx(referee(1), START + 246_000)))).toBe('already_decided');
  });

  it('rejecting removes it: the team has no result and can be tapped or entered again', () => {
    const e = ok(decide(lateTap(), 'reject'));
    expect(e.taps[0]).toMatchObject({ removedAt: START + 260_000, removedBy: admin.label, hold: { status: 'rejected' } });
    expect(result(e, 'T1')).toBeUndefined();
    expect(code(tapFinish(e, 'T1', START + 270_000, 'fresh', START + 270_000))).toBe('ok');
  });

  it('will not confirm over a result entered meanwhile, but confirms once that is cleared', () => {
    const late = lateTap();
    const id = teamId(late, 'T1');
    const entered = ok(handleTaps(late, { type: 'setResult', round: 1, teamId: id, set: { kind: 'time', rawMs: 230_000 } }, ctx(admin, START + 250_000)));
    expect(code(decide(entered, 'confirm'))).toBe('already_finished');
    expect(code(decide(entered, 'reject'))).toBe('ok');
    const cleared = ok(handleTaps(entered, { type: 'setResult', round: 1, teamId: id, set: { kind: 'clear' } }, ctx(admin, START + 255_000)));
    expect(result(ok(decide(cleared, 'confirm')), 'T1')).toEqual({ status: 'finished', rawMs: 200_000, penaltiesMs: 0 });
  });

  it('the referee can undo a held finish inside the undo window; then nothing waits', () => {
    const late = lateTap();
    const undone = ok(handleTaps(late, { type: 'undoTap', tapId: late.taps[0]!.id }, ctx(referee(1), START + 246_000)));
    expect(code(decide(undone, 'confirm'))).toBe('not_found');
    expect(code(tapFinish(undone, 'T1', START + 250_000, 'fresh', START + 250_000))).toBe('ok');
  });

  it('the round cannot be finished while a team’s finish is held', () => {
    let e = lateTap();
    for (const name of ['T2', 'T3', 'T4']) {
      e = ok(handleTaps(e, { type: 'setResult', round: 1, teamId: teamId(e, name), set: { kind: 'time', rawMs: 210_000 } }, ctx(admin, START + 250_000)));
    }
    expect(code(handleLifecycle(e, { type: 'finishRace' }, ctx(admin, START + 300_000)))).not.toBe('ok');
    expect(code(handleLifecycle(ok(decide(e, 'confirm')), { type: 'finishRace' }, ctx(admin, START + 300_000)))).toBe('ok');
  });

  it('refuses an eleventh penalty from one device on one team while ten wait for race control', () => {
    let e = ok(handleTaps(running(), { type: 'setPenaltiesEnabled', enabled: true }, ctx(admin, START)));
    const pen = (ev: LiveEvent, name: string, id: string) =>
      handleTaps(ev, { type: 'tapPenalty', teamId: teamId(ev, name), clientTapId: id }, ctx(referee(1), START + 100_000));
    for (let i = 0; i < 10; i++) e = ok(pen(e, 'T1', `p${i}`));
    expect(code(pen(e, 'T1', 'p10'))).toBe('too_many_penalties');
    expect(code(pen(e, 'T2', 'other-team'))).toBe('ok');
    // A resend of one already taken is still answered as done.
    expect(pen(e, 'T1', 'p3')).toMatchObject({ ok: true, unchanged: true });
    // Once race control has decided one, there is room again.
    e = ok(handleTaps(e, { type: 'decidePenalty', tapId: e.taps.find((t) => t.clientTapId === 'p0')!.id, decision: 'reject' }, ctx(admin, START + 110_000)));
    expect(code(pen(e, 'T1', 'p10'))).toBe('ok');
  });

  it('logs only the known fields of a referee command', () => {
    const e = running();
    const r = handleTaps(e, { type: 'tapPenalty', teamId: teamId(e, 'T1'), clientTapId: 'c'.repeat(300), junk: { deep: 'x'.repeat(5000) } } as never, ctx(referee(1), START));
    expect(code(r)).toBe('invalid');
    const fine = handleTaps(e, { type: 'tapFinish', teamId: teamId(e, 'T1'), atServerMs: START + 5, clientTapId: 'k', junk: 'x'.repeat(5000) } as never, ctx(referee(1), START + 5));
    expect(fine.ok && fine.audit.detail).toEqual({ type: 'tapFinish', teamId: teamId(e, 'T1'), atServerMs: START + 5, clientTapId: 'k', round: undefined });
  });
});
