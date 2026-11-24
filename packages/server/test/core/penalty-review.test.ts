import { describe, it, expect } from 'vitest';
import { applyCommand } from '../../src/core/apply';
import { buildProgress, derive } from '../../src/core/results';
import type { Command, LiveEvent } from '../../src/core/model';
import { admin, ctx, lockedFour, ok, referee, runRound, teamId } from './helpers';

const NOW = 2_000_000;
const seed = { T1: 100_000, T2: 110_000, T3: 120_000, T4: 130_000 };
const run = (e: LiveEvent, cmd: Command, actor = admin, now = NOW) => applyCommand(e, cmd, ctx(actor, now));
const code = (r: ReturnType<typeof applyCommand>) => (r.ok ? 'ok' : r.code);

/** Opens the next round with penalties on, readies all stations and starts it. */
function startNext(e: LiveEvent): LiveEvent {
  e = ok(run(e, { type: 'setPenaltiesEnabled', enabled: true }));
  e = ok(run(e, { type: 'openNextRound' }));
  for (const [s, st] of Object.entries(e.stations)) if (!st.excluded) e = ok(run(e, { type: 'overrideStation', station: Number(s), state: 'ready' }));
  return ok(run(e, { type: 'startRace' }));
}
/** Gives every team in the current round a time (by name), then finishes. */
function finish(e: LiveEvent, times: Record<string, number>): LiveEvent {
  const inRound = derive(e).rounds[e.round.current - 1]!.races.flatMap((r) => r.entrants.map((x) => x.teamId));
  for (const id of inRound) {
    const name = e.setup.teams.find((t) => t.id === id)!.name;
    e = ok(run(e, { type: 'setResult', round: e.round.current, teamId: id, set: { kind: 'time', rawMs: times[name] ?? 150_000 } }));
  }
  return ok(run(e, { type: 'finishRace' }, admin, NOW + 1));
}
function refPenalty(e: LiveEvent, name: string, clientTapId = `p-${name}`) {
  const r = run(e, { type: 'tapPenalty', teamId: teamId(e, name), clientTapId }, referee(1));
  const next = ok(r);
  return { e: next, tap: next.taps.at(-1)! };
}
const result = (e: LiveEvent, name: string, round = e.round.current) => buildProgress(e).results[round]?.[teamId(e, name)];

describe('penalty review', () => {
  it("a referee's penalty starts pending and adds no time", () => {
    const { e, tap } = refPenalty(startNext(lockedFour()), 'T1');
    expect(tap.review).toEqual({ status: 'pending' });
    const done = finish(e, seed);
    expect(result(done, 'T1')).toMatchObject({ status: 'finished', penaltiesMs: 0 });
  });

  it('notes are sent after the race, not during it', () => {
    const { e, tap } = refPenalty(startNext(lockedFour()), 'T1');
    const note = { type: 'notePenalty' as const, tapId: tap.id, reasonId: 'early', note: ' jumped the start ' };
    expect(code(run(e, note, referee(1)))).toBe('round_not_finished');
    const done = finish(e, seed);
    const noted = ok(run(done, note, referee(1)));
    expect(noted.taps.find((t) => t.id === tap.id)!.review).toMatchObject({ status: 'pending', refereeReasonId: 'early', refereeNote: 'jumped the start' });
    expect(code(run(done, note, referee(1, 'someone-else')))).toBe('not_your_tap');
    expect(code(run(done, { ...note, reasonId: 'nope' }, referee(1)))).toBe('invalid');
  });

  it('approving with a timed reason sets its time; a later note is refused', () => {
    let { e, tap } = refPenalty(startNext(lockedFour()), 'T1');
    e = finish(e, seed);
    e = ok(run(e, { type: 'decidePenalty', tapId: tap.id, decision: 'approve', reasonId: 'early' }));
    expect(e.taps.find((t) => t.id === tap.id)).toMatchObject({ amountMs: 10_000, review: { status: 'approved', reasonId: 'early', reasonName: 'Started early' } });
    expect(result(e, 'T1')?.penaltiesMs).toBe(10_000);
    expect(code(run(e, { type: 'notePenalty', tapId: tap.id, reasonId: 'sealed' }, referee(1)))).toBe('already_decided');
  });

  it('rejecting removes the penalty but keeps the record', () => {
    let { e, tap } = refPenalty(startNext(lockedFour()), 'T1');
    e = finish(e, seed);
    e = ok(run(e, { type: 'decidePenalty', tapId: tap.id, decision: 'reject' }));
    const t = e.taps.find((x) => x.id === tap.id)!;
    expect(t.removedAt).not.toBeNull();
    expect(t.review?.status).toBe('rejected');
    expect(result(e, 'T1')?.penaltiesMs).toBe(0);
  });

  it('approving needs a reason', () => {
    let { e, tap } = refPenalty(startNext(lockedFour()), 'T1');
    e = finish(e, seed);
    expect(code(run(e, { type: 'decidePenalty', tapId: tap.id, decision: 'approve' }))).toBe('invalid');
  });

  it('a DQ makes the result DNF and stays even if another penalty is approved later', () => {
    let e = startNext(lockedFour());
    const first = refPenalty(e, 'T1', 'a');
    const second = refPenalty(first.e, 'T1', 'b');
    e = finish(second.e, seed);
    e = ok(run(e, { type: 'decidePenalty', tapId: first.tap.id, decision: 'approve', reasonId: 'unsafe' }));
    expect(result(e, 'T1')).toMatchObject({ status: 'dnf', rawMs: null });
    e = ok(run(e, { type: 'decidePenalty', tapId: second.tap.id, decision: 'approve', reasonId: 'sealed' }));
    expect(result(e, 'T1')?.status).toBe('dnf');
  });

  it('a disqualified fastest team loses its heat', () => {
    let e = runRound(runRound(lockedFour(), seed), seed); // heats next: T1 v T4, T2 v T3
    e = startNext(e);
    const { e: withPen, tap } = refPenalty(e, 'T1');
    e = finish(withPen, { T1: 100_000, T4: 200_000, T2: 100_000, T3: 200_000 });
    e = ok(run(e, { type: 'decidePenalty', tapId: tap.id, decision: 'approve', reasonId: 'unsafe' }));
    e = ok(run(e, { type: 'openNextRound' }));
    const winners = derive(e).rounds[3]!.races.find((r) => r.id.endsWith(':winners'))!;
    expect(winners.entrants.map((x) => e.setup.teams.find((t) => t.id === x.teamId)!.name)).toEqual(['T4', 'T2']);
  });

  it('the next round waits until every penalty is decided', () => {
    let { e, tap } = refPenalty(startNext(lockedFour()), 'T1');
    e = finish(e, seed);
    const blocked = run(e, { type: 'openNextRound' });
    expect(code(blocked)).toBe('penalties_pending');
    if (!blocked.ok) expect(blocked.detail).toEqual([{ tapId: tap.id, round: 1, teamId: teamId(e, 'T1') }]);
    e = ok(run(e, { type: 'decidePenalty', tapId: tap.id, decision: 'approve', reasonId: 'sealed' }));
    expect(code(run(e, { type: 'openNextRound' }))).toBe('ok');
  });

  it("race control's own penalties need a reason and count as approved", () => {
    let e = finish(startNext(lockedFour()), seed);
    expect(code(run(e, { type: 'addPenalty', round: 1, teamId: teamId(e, 'T2') } as never))).toBe('invalid');
    e = ok(run(e, { type: 'addPenalty', round: 1, teamId: teamId(e, 'T2'), reasonId: 'early' }));
    expect(e.taps.at(-1)).toMatchObject({ amountMs: 10_000, source: 'control', review: { status: 'approved', reasonName: 'Started early' } });
    expect(code(run(e, { type: 'openNextRound' }))).toBe('ok');
  });

  it('the champion cannot be shown while a final-round penalty is pending', () => {
    let e = runRound(runRound(runRound(lockedFour(), seed), seed), seed);
    e = startNext(e);
    ({ e } = refPenalty(e, 'T1'));
    e = finish(e, seed);
    expect(code(run(e, { type: 'showChampion', bagTotal: '10' }))).toBe('penalties_pending');
    const tapId = e.taps.find((t) => t.kind === 'penalty')!.id;
    e = ok(run(e, { type: 'decidePenalty', tapId, decision: 'reject' }));
    expect(code(run(e, { type: 'showChampion', bagTotal: '10' }))).toBe('ok');
  });

  it('a referee cannot undo a penalty race control already decided', () => {
    let e = startNext(runRound(runRound(lockedFour(), seed), seed));
    ({ e } = refPenalty(e, 'T1'));
    const tapId = e.taps.find((t) => t.kind === 'penalty')!.id;
    e = ok(run(e, { type: 'decidePenalty', tapId, decision: 'approve', reasonId: 'sealed' }));
    expect(code(run(e, { type: 'undoTap', tapId }, referee(1)))).toBe('already_decided');
  });
});
