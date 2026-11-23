import { describe, it, expect } from 'vitest';
import { rankRace, officialMs } from '../src/race';
import type { EntryResult } from '../src/types';

const fin = (ms: number, pen = 0): EntryResult => ({ status: 'finished', rawMs: ms, penaltiesMs: pen });
const dnf: EntryResult = { status: 'dnf', rawMs: null, penaltiesMs: 0 };
const dns: EntryResult = { status: 'dns', rawMs: null, penaltiesMs: 0 };

describe('officialMs', () => {
  it('adds penalties for finishers and is null otherwise', () => {
    expect(officialMs(fin(190_000, 5_000))).toBe(195_000);
    expect(officialMs(dnf)).toBeNull();
  });
});

describe('rankRace', () => {
  it('orders finishers, then dnf, then dns, then pending', () => {
    const r = rankRace(
      [
        { teamId: 'b', result: fin(200_000) },
        { teamId: 'a', result: dnf },
        { teamId: 'c', result: fin(190_000) },
        { teamId: 'd', result: dns },
        { teamId: 'e', result: undefined },
      ],
      { fallbackOrder: ['a', 'b', 'c', 'd', 'e'] },
    );
    expect(r.order).toEqual(['c', 'b', 'a', 'd', 'e']);
    expect(r.ties).toEqual([]);
  });

  it('penalty changes the order', () => {
    const r = rankRace(
      [{ teamId: 'a', result: fin(190_000, 5_000) }, { teamId: 'b', result: fin(194_000) }],
      { fallbackOrder: ['a', 'b'] },
    );
    expect(r.order).toEqual(['b', 'a']);
  });

  it('same hundredth is a tie', () => {
    const r = rankRace(
      [{ teamId: 'a', result: fin(192_401) }, { teamId: 'b', result: fin(192_409) }],
      { fallbackOrder: ['b', 'a'] },
    );
    expect(r.ties).toEqual([['b', 'a']]);
    expect(r.order).toEqual(['b', 'a']);
  });

  it('penalty creating equality is a tie', () => {
    const r = rankRace(
      [{ teamId: 'a', result: fin(190_000, 5_000) }, { teamId: 'b', result: fin(195_000) }],
      { fallbackOrder: ['a', 'b'] },
    );
    expect(r.ties.length).toBe(1);
  });

  it('tieOrder resolves the tie', () => {
    const r = rankRace(
      [{ teamId: 'a', result: fin(192_401) }, { teamId: 'b', result: fin(192_409) }],
      { fallbackOrder: ['b', 'a'], tieOrder: ['a', 'b'] },
    );
    expect(r.order).toEqual(['a', 'b']);
    expect(r.ties).toEqual([]);
  });

  it('two non-finishers break by fallback, no tie', () => {
    const r = rankRace(
      [{ teamId: 'a', result: dnf }, { teamId: 'b', result: dnf }],
      { fallbackOrder: ['b', 'a'] },
    );
    expect(r.order).toEqual(['b', 'a']);
    expect(r.ties).toEqual([]);
  });
});
