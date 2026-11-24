import { describe, it, expect } from 'vitest';
import { applyCommand } from '../../src/core/apply';
import { nextAlarm } from '../../src/core/autofinish';
import { derive, teamsInRound } from '../../src/core/results';
import type { Command, LiveEvent } from '../../src/core/model';
import { admin, ctx, lockedFour, ok, referee, teamId } from './helpers';

const START = 2_000_000;
const run = (e: LiveEvent, cmd: Command, now: number, actor = admin) => ok(applyCommand(e, cmd, ctx(actor, now)));
const time = (e: LiveEvent, name: string, now: number) =>
  run(e, { type: 'setResult', round: e.round.current, teamId: teamId(e, name), set: { kind: 'time', rawMs: 100_000 } }, now);

/** Round 1 running from START with penalties on; `settings` are applied first. */
function running(settings: { autoFinishMs?: number; undoWindowMs?: number } = {}): LiveEvent {
  let e = lockedFour();
  if (Object.keys(settings).length) e = run(e, { type: 'setSettings', ...settings }, START, admin);
  e = run(e, { type: 'setPenaltiesEnabled', enabled: true }, START);
  e = run(e, { type: 'openNextRound' }, START);
  for (const s of Object.keys(e.stations)) e = run(e, { type: 'overrideStation', station: Number(s), state: 'ready' }, START);
  return run(e, { type: 'startRace' }, START);
}

/** Every team in the round has a time: three at 2_050_000, the last at 2_060_000. */
function allIn(e: LiveEvent): { e: LiveEvent; during: (number | null)[] } {
  const names = teamsInRound(derive(e), e.round.current).map((t) => e.setup.teams.find((x) => x.id === t.teamId)!.name);
  expect(names).toHaveLength(4);
  const during: (number | null)[] = [];
  for (const name of names.slice(0, 3)) {
    e = time(e, name, 2_050_000);
    during.push(e.round.autoFinishAt ?? null);
  }
  return { e: time(e, names[3]!, 2_060_000), during };
}

describe('auto-finish', () => {
  it('starts a 30 s countdown when the last team has a result', () => {
    const { e, during } = allIn(running());
    expect(during).toEqual([null, null, null]);
    expect(e.round.autoFinishAt).toBe(2_090_000);
  });

  it('restarts on any later tap, penalty or correction, and cancels when a result is cleared', () => {
    let { e } = allIn(running());
    const station1 = teamsInRound(derive(e), 1).find((t) => t.table <= 2)!.teamId;
    e = run(e, { type: 'tapPenalty', teamId: station1, clientTapId: 'pen-1' }, 2_070_000, referee(1));
    expect(e.round.autoFinishAt).toBe(2_100_000);
    e = run(e, { type: 'setResult', round: 1, teamId: station1, set: { kind: 'clear' } }, 2_075_000);
    expect(e.round.autoFinishAt).toBeNull();
  });

  it("restarts when a referee adds a penalty note during the countdown", () => {
    let { e } = allIn(running());
    const station1 = teamsInRound(derive(e), 1).find((t) => t.table <= 2)!.teamId;
    e = run(e, { type: 'tapPenalty', teamId: station1, clientTapId: 'pen-1' }, 2_070_000, referee(1));
    const tapId = e.taps.at(-1)!.id;
    e = run(e, { type: 'notePenalty', tapId, reasonId: 'early' }, 2_085_000, referee(1));
    expect(e.round.phase).toBe('running');
    expect(e.round.autoFinishAt).toBe(2_085_000 + 30_000);
  });

  it('keeps the countdown when nothing about the results changes', () => {
    let { e } = allIn(running());
    e = run(e, { type: 'pinProjector', screen: 'clock' }, 2_080_000);
    expect(e.round.autoFinishAt).toBe(2_090_000);
  });

  it('clears the countdown once the round is finished', () => {
    let { e } = allIn(running());
    e = run(e, { type: 'finishRace' }, 2_070_000);
    expect(e.round.phase).toBe('finished');
    expect(e.round.autoFinishAt).toBeNull();
  });

  it('restarts when the undo window or the delay changes mid-countdown', () => {
    const { e } = allIn(running());
    expect(e.round.autoFinishAt).toBe(2_090_000);
    expect(run(e, { type: 'setSettings', undoWindowMs: 60_000 }, 2_070_000, admin).round.autoFinishAt).toBe(2_130_000);
    expect(run(e, { type: 'setSettings', autoFinishMs: 45_000 }, 2_070_000, admin).round.autoFinishAt).toBe(2_115_000);
  });

  it('never undercuts the referee undo window', () => {
    const { e } = allIn(running({ autoFinishMs: 5_000, undoWindowMs: 10_000 }));
    expect(e.round.autoFinishAt).toBe(2_060_000 + 10_000);
  });

  it('is off when the delay is 0', () => {
    const { e, during } = allIn(running({ autoFinishMs: 0 }));
    expect(during).toEqual([null, null, null]);
    expect(e.round.autoFinishAt ?? null).toBeNull();
  });

  it('refuses a delay that is not a whole number of ms', () => {
    const r = applyCommand(lockedFour(), { type: 'setSettings', autoFinishMs: -1 }, ctx(admin));
    expect(r.ok ? 'ok' : r.code).toBe('invalid');
    const r2 = applyCommand(lockedFour(), { type: 'setSettings', autoFinishMs: 1.5 }, ctx(admin));
    expect(r2.ok ? 'ok' : r2.code).toBe('invalid');
  });

  it('picks the earlier alarm', () => {
    expect(nextAlarm(1000, 500)).toBe(500);
    expect(nextAlarm(null, 500)).toBe(500);
    expect(nextAlarm(1000, null)).toBe(1000);
    expect(nextAlarm(null, undefined)).toBe(null);
  });
});
