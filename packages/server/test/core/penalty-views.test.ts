import { describe, it, expect } from 'vitest';
import { applyCommand } from '../../src/core/apply';
import { derive } from '../../src/core/results';
import { controlView, publicView, refereeView } from '../../src/core/views';
import { eventCsv } from '../../src/core/export';
import type { Command, LiveEvent } from '../../src/core/model';
import { admin, ctx, lockedFour, ok, referee, teamId } from './helpers';

const run = (e: LiveEvent, cmd: Command, actor = admin) => ok(applyCommand(e, cmd, ctx(actor, 2_000_000)));

/** Round 1 finished; referee gave T1 and T2 a penalty each, with a note on T1's. */
function reviewed() {
  let e = run(lockedFour(), { type: 'setPenaltiesEnabled', enabled: true });
  e = run(e, { type: 'openNextRound' });
  for (const s of [1, 2]) e = run(e, { type: 'overrideStation', station: s, state: 'ready' });
  e = run(e, { type: 'startRace' });
  e = run(e, { type: 'tapPenalty', teamId: teamId(e, 'T1'), clientTapId: 'a' }, referee(1));
  e = run(e, { type: 'tapPenalty', teamId: teamId(e, 'T2'), clientTapId: 'b' }, referee(1));
  for (const n of ['T1', 'T2', 'T3', 'T4']) e = run(e, { type: 'setResult', round: 1, teamId: teamId(e, n), set: { kind: 'time', rawMs: 120_000 } });
  e = run(e, { type: 'finishRace' });
  const [a, b] = e.taps.filter((t) => t.kind === 'penalty');
  e = run(e, { type: 'notePenalty', tapId: a!.id, reasonId: 'early', note: 'jumped' }, referee(1));
  return { e, a: a!, b: b! };
}
const entrant = (e: LiveEvent, name: string) =>
  publicView(e, derive(e)).rounds[0]!.races.flatMap((r) => r.entrants).find((x) => x.teamId === teamId(e, name))!;

describe('penalties in views', () => {
  it('public entrants show approved reasons, pending reviews and DQs', () => {
    let { e, a, b } = reviewed();
    expect(entrant(e, 'T1')).toMatchObject({ penaltyPending: true, penaltyNotes: [], dq: null });
    e = run(e, { type: 'decidePenalty', tapId: a.id, decision: 'approve', reasonId: 'early' });
    e = run(e, { type: 'decidePenalty', tapId: b.id, decision: 'approve', reasonId: 'unsafe' });
    expect(entrant(e, 'T1')).toMatchObject({ penaltyPending: false, penaltyNotes: ['Started early'], penaltiesMs: 10_000, dq: null });
    expect(entrant(e, 'T2')).toMatchObject({ status: 'dnf', dq: 'Unsafe conduct' });
  });

  it('public views never include referee notes', () => {
    const { e } = reviewed();
    expect(JSON.stringify(publicView(e, derive(e)))).not.toContain('jumped');
  });

  it('referees get the reason list and each tap\'s review', () => {
    const { e } = reviewed();
    const v = refereeView(e, derive(e), 1);
    expect(v.reasons.map((r) => r.id)).toEqual(['sealed', 'count', 'early', 'unsafe']);
    expect(v.teams[0]!.taps[0]).toMatchObject({ source: 'referee', review: { status: 'pending', refereeReasonId: 'early', refereeNote: 'jumped' } });
  });

  it('race control sees penalties to review with the referee note', () => {
    const { e, a } = reviewed();
    const v = controlView(e, derive(e), { devices: [], audit: [] });
    expect(v.penaltyReasons.length).toBe(4);
    expect(v.penaltyReviews.find((r) => r.tapId === a.id)).toMatchObject({ round: 1, status: 'pending', refereeReasonId: 'early', refereeNote: 'jumped' });
  });

  it('the CSV export includes reasons, DQs and referee notes', () => {
    let { e, a, b } = reviewed();
    e = run(e, { type: 'decidePenalty', tapId: a.id, decision: 'approve', reasonId: 'early' });
    e = run(e, { type: 'decidePenalty', tapId: b.id, decision: 'approve', reasonId: 'unsafe' });
    const csv = eventCsv(e);
    expect(csv.split('\n')[0]).toBe('round,team,category,table,status,raw_ms,penalties_ms,official_ms,place,penalty_reasons,dq_reason,referee_notes');
    const t1 = csv.split('\n').find((l) => l.startsWith('1,T1,'))!;
    expect(t1).toContain('Started early');
    expect(t1).toContain('jumped');
    expect(csv.split('\n').find((l) => l.startsWith('1,T2,'))).toContain('Unsafe conduct');
  });
});
