import { describe, it, expect } from 'vitest';
import { applyCommand } from '../../src/core/apply';
import { STARTER_REASONS, reasonsOf, reviewOf } from '../../src/core/reasons';
import { newEvent, type Tap } from '../../src/core/model';
import { admin, blank, ctx, lockedFour } from './helpers';

const code = (r: ReturnType<typeof applyCommand>) => (r.ok ? 'ok' : r.code);

describe('penalty reasons', () => {
  it('new events start with the starter list', () => {
    expect(newEvent('ev1', 'Test', '2026-12-01', 26).penaltyReasons).toEqual(STARTER_REASONS);
    expect(STARTER_REASONS.map((r) => [r.name, r.kind === 'time' ? r.amountMs : 'dq'])).toEqual([
      ['Fluffing Bags', 5000], ['False Start', 10_000], ['Interference', 15_000], ['Unsafe Conduct', 30_000],
    ]);
  });

  it('events stored before the list existed get the starter list', () => {
    const { penaltyReasons: _, ...old } = blank();
    expect(reasonsOf(old as never)).toEqual(STARTER_REASONS);
  });

  it('admin can replace the list, even with setup locked', () => {
    const reasons = [{ id: 'a', name: 'Spill', kind: 'time' as const, amountMs: 3000 }, { id: 'b', name: 'Cheating', kind: 'dq' as const }];
    const r = applyCommand(lockedFour(), { type: 'setPenaltyReasons', reasons }, ctx(admin));
    expect(r.ok && r.event.penaltyReasons).toEqual(reasons);
  });

  it('rejects duplicate names and timed reasons without an amount', () => {
    const dup = [{ id: 'a', name: 'Spill', kind: 'time' as const, amountMs: 1 }, { id: 'b', name: 'spill', kind: 'time' as const, amountMs: 1 }];
    expect(code(applyCommand(blank(), { type: 'setPenaltyReasons', reasons: dup }, ctx(admin)))).toBe('invalid');
    const noAmount = [{ id: 'a', name: 'Spill', kind: 'time' as const }];
    expect(code(applyCommand(blank(), { type: 'setPenaltyReasons', reasons: noAmount as never }, ctx(admin)))).toBe('invalid');
    expect(code(applyCommand(blank(), { type: 'setPenaltyReasons', reasons: [] }, ctx(admin)))).toBe('invalid');
  });

  it('treats penalty taps from before reviews existed as approved', () => {
    const legacy: Tap = { id: 'p', kind: 'penalty', round: 1, teamId: 't', amountMs: 5000, source: 'referee', createdAt: 1, removedAt: null };
    expect(reviewOf(legacy).status).toBe('approved');
  });
});
