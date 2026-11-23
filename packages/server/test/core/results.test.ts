import { describe, it, expect } from 'vitest';
import { buildProgress } from '../../src/core/results';
import type { LiveEvent, Override, Tap } from '../../src/core/model';
import { blank } from './helpers';

const finish = (elapsedMs: number, createdAt = 1, removedAt: number | null = null): Tap =>
  ({ id: `f${createdAt}`, kind: 'finish', round: 1, teamId: 't', elapsedMs, source: 'referee', createdAt, removedAt });
const penalty = (createdAt: number, removedAt: number | null = null): Tap =>
  ({ id: `p${createdAt}`, kind: 'penalty', round: 1, teamId: 't', amountMs: 5000, source: 'referee', createdAt, removedAt });
const override = (at: number, set: Override['set']): Override => ({ round: 1, teamId: 't', at, set });
const withFacts = (taps: Tap[], overrides: Override[] = []): LiveEvent => ({ ...blank(), taps, overrides });
const result = (e: LiveEvent) => buildProgress(e).results[1]?.t;

describe('buildProgress', () => {
  it('finish tap plus active penalties', () => {
    expect(result(withFacts([finish(200_000), penalty(2), penalty(3)])))
      .toEqual({ status: 'finished', rawMs: 200_000, penaltiesMs: 10_000 });
  });
  it('ignores removed penalties', () => {
    expect(result(withFacts([finish(200_000), penalty(2, 5)]))?.penaltiesMs).toBe(0);
  });
  it('a later DNF override beats the finish tap', () => {
    expect(result(withFacts([finish(200_000, 1)], [override(2, { kind: 'status', status: 'dnf' })]))?.status).toBe('dnf');
  });
  it('a later time override replaces a DNF', () => {
    const e = withFacts([], [override(1, { kind: 'status', status: 'dnf' }), override(2, { kind: 'time', rawMs: 210_000 })]);
    expect(result(e)).toEqual({ status: 'finished', rawMs: 210_000, penaltiesMs: 0 });
  });
  it('clear leaves the team pending', () => {
    expect(result(withFacts([finish(200_000, 1)], [override(2, { kind: 'clear' })]))).toBeUndefined();
  });
  it('a removed finish tap leaves the team pending', () => {
    expect(result(withFacts([finish(200_000, 1, 4)]))).toBeUndefined();
  });
  it('never reports finished without a usable time', () => {
    expect(result(withFacts([], [override(1, { kind: 'time', rawMs: Number.NaN })]))).toBeUndefined();
    expect(result(withFacts([{ ...finish(200_000), elapsedMs: Number.NaN }]))).toBeUndefined();
  });
  it('copies finished rounds and tie decisions', () => {
    const e = { ...blank(), finishedRounds: 3, tieDecisions: { r: ['a', 'b'] } };
    expect(buildProgress(e)).toMatchObject({ finishedRounds: 3, tieDecisions: { r: ['a', 'b'] } });
  });
});
