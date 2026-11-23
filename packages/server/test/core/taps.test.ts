import { describe, it, expect } from 'vitest';
import { handleTaps } from '../../src/core/taps';
import { handleLifecycle } from '../../src/core/lifecycle';
import { buildProgress } from '../../src/core/results';
import type { CommandResult, LiveEvent } from '../../src/core/model';
import { control, ctx, lockedFour, ok, referee, runRound, teamId } from './helpers';

const START = 1_000_000;
const code = (r: CommandResult) => (r.ok ? 'ok' : r.code);

/** Round 1 running since START; station 1 = T1, T2; station 2 = T3, T4. */
function running(): LiveEvent {
  let e = ok(handleLifecycle(lockedFour(), { type: 'openNextRound' }, ctx(control, START)));
  for (const station of [1, 2]) e = ok(handleLifecycle(e, { type: 'overrideStation', station, state: 'ready' }, ctx(control, START)));
  return ok(handleLifecycle(e, { type: 'startRace' }, ctx(control, START)));
}
const tapFinish = (e: LiveEvent, name: string, atServerMs: number, clientTapId = `c-${name}-${atServerMs}`, now = START + 300_000) =>
  handleTaps(e, { type: 'tapFinish', teamId: teamId(e, name), atServerMs, clientTapId }, ctx(referee(1), now));
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
    const e = ok(handleLifecycle(lockedFour(), { type: 'openNextRound' }, ctx(control, START)));
    expect(code(tapFinish(e, 'T1', START))).toBe('round_not_running');
  });
});

describe('penalties', () => {
  const penalty = (e: LiveEvent, name: string, clientTapId = `p-${name}`) =>
    handleTaps(e, { type: 'tapPenalty', teamId: teamId(e, name), clientTapId }, ctx(referee(1), START + 100_000));

  it('are refused while switched off', () => {
    expect(code(penalty(running(), 'T1'))).toBe('penalties_disabled');
  });

  it('add the configured amount when on, before or after the finish', () => {
    let e = ok(handleTaps(running(), { type: 'setPenaltiesEnabled', enabled: true }, ctx(control)));
    e = ok(penalty(e, 'T1', 'p1'));
    e = ok(tapFinish(e, 'T1', START + 200_000));
    e = ok(penalty(e, 'T1', 'p2'));
    expect(result(e, 'T1')).toEqual({ status: 'finished', rawMs: 200_000, penaltiesMs: 10_000 });
  });

  it('switching off keeps penalties already given', () => {
    let e = ok(handleTaps(running(), { type: 'setPenaltiesEnabled', enabled: true }, ctx(control)));
    e = ok(tapFinish(ok(penalty(e, 'T1')), 'T1', START + 200_000));
    e = ok(handleTaps(e, { type: 'setPenaltiesEnabled', enabled: false }, ctx(control)));
    expect(result(e, 'T1')?.penaltiesMs).toBe(5_000);
  });

  it('race control can add and remove penalties even when switched off', () => {
    let e = ok(tapFinish(running(), 'T1', START + 200_000));
    e = ok(handleTaps(e, { type: 'addPenalty', round: 1, teamId: teamId(e, 'T1') }, ctx(control)));
    expect(result(e, 'T1')?.penaltiesMs).toBe(5_000);
    const tapId = e.taps.find((t) => t.kind === 'penalty')!.id;
    e = ok(handleTaps(e, { type: 'removePenalty', tapId }, ctx(control)));
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
    e = ok(handleTaps(e, { type: 'setResult', round: 1, teamId: teamId(e, 'T3'), set: { kind: 'status', status: 'dnf' } }, ctx(control)));
    e = ok(handleTaps(e, { type: 'setResult', round: 1, teamId: teamId(e, 'T4'), set: { kind: 'time', rawMs: 199_000 } }, ctx(control)));
    expect(result(e, 'T3')?.status).toBe('dnf');
    expect(result(e, 'T4')?.rawMs).toBe(199_000);
  });

  it('a late correction needs confirmation once later rounds have results', () => {
    const times = { T1: 100_000, T2: 110_000, T3: 120_000, T4: 130_000 };
    let e = runRound(runRound(lockedFour(), times), times);
    e = ok(handleLifecycle(e, { type: 'openNextRound' }, ctx(control)));
    const cmd = { type: 'setResult' as const, round: 1, teamId: teamId(e, 'T1'), set: { kind: 'time' as const, rawMs: 99_000 } };
    const r = handleTaps(e, cmd, ctx(control));
    expect(code(r)).toBe('unlock_required');
    if (!r.ok) expect(r.detail).toEqual({ laterRounds: [2] });
    expect(code(handleTaps(e, { ...cmd, confirmUnlock: true }, ctx(control)))).toBe('ok');
  });
});
