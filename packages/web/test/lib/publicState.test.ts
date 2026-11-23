import { describe, it, expect } from 'vitest';
import { applyRoundUpdate, applySnapshot } from '../../src/lib/publicState';

const view = {
  round: { current: 2, phase: 'running', startedAt: 1, finishedAt: null },
  projector: 'clock',
  rounds: [
    { round: 1, kind: 'seeding', status: 'locked', races: [{ id: 'r1' }] },
    { round: 2, kind: 'seeding', status: 'ready', races: [{ id: 'r2-old' }] },
  ],
} as any;

describe('public state', () => {
  it('replaces only the current round and the round state', () => {
    const s = applySnapshot(view);
    const next = applyRoundUpdate(s, {
      round: { current: 2, phase: 'running', startedAt: 1, finishedAt: null },
      projector: 'clock',
      races: [{ id: 'r2-new' }],
    } as any);
    expect(next.rounds[0]!.races).toEqual([{ id: 'r1' }]);
    expect(next.rounds[1]!.races).toEqual([{ id: 'r2-new' }]);
    expect(next).not.toBe(s);
  });
});
