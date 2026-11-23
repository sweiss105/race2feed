import { describe, it, expect } from 'vitest';
import { rankSeeding } from '../src/seeding';
import type { EntryResult, Team } from '../src/types';

const fin = (s: number): EntryResult => ({ status: 'finished', rawMs: s * 1000, penaltiesMs: 0 });
const dns: EntryResult = { status: 'dns', rawMs: null, penaltiesMs: 0 };
const team = (id: string, order: number, categoryId = 'hs'): Team => ({ id, name: id, categoryId, order });

describe('rankSeeding', () => {
  it('lower total wins', () => {
    const r = rankSeeding([team('a', 0), team('b', 1)], { a: fin(268), b: fin(238) }, { a: fin(209), b: fin(214) });
    expect(r).toEqual({ b: 1, a: 2 });
  });

  it('equal total breaks on the better single run', () => {
    const r = rankSeeding([team('a', 0), team('b', 1)], { a: fin(220), b: fin(240) }, { a: fin(220), b: fin(200) });
    expect(r).toEqual({ b: 1, a: 2 });
  });

  it('equal total and best run break on team order', () => {
    const r = rankSeeding([team('a', 1), team('b', 0)], { a: fin(200), b: fin(200) }, { a: fin(220), b: fin(220) });
    expect(r).toEqual({ b: 1, a: 2 });
  });

  it('two finished runs beat one', () => {
    const r = rankSeeding([team('a', 0), team('b', 1)], { a: fin(100), b: fin(300) }, { a: dns, b: fin(300) });
    expect(r).toEqual({ b: 1, a: 2 });
  });

  it('counts penalties in the run time', () => {
    const r = rankSeeding(
      [team('a', 0), team('b', 1)],
      { a: { status: 'finished', rawMs: 200_000, penaltiesMs: 10_000 }, b: fin(205) },
      { a: fin(200), b: fin(200) },
    );
    expect(r).toEqual({ b: 1, a: 2 });
  });

  it('ranks are per category', () => {
    const r = rankSeeding([team('a', 0, 'hs'), team('b', 1, 'corp')], { a: fin(300), b: fin(200) }, { a: fin(300), b: fin(200) });
    expect(r).toEqual({ a: 1, b: 1 });
  });
});
