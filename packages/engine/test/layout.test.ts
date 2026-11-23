import { describe, it, expect } from 'vitest';
import { layoutTables } from '../src/layout';

const race = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

describe('layoutTables', () => {
  it('lays head-to-heads on station pairs', () => {
    const out = layoutTables([race('a', 2), race('b', 2), race('c', 2)]);
    expect(out.map((r) => r.tables)).toEqual([[1, 2], [3, 4], [5, 6]]);
  });

  it('keeps 3-team races adjacent (previous event HS Bronze placement)', () => {
    const out = layoutTables([race('a', 3), race('b', 3), race('c', 2), race('d', 2)]);
    expect(out.map((r) => r.tables)).toEqual([[1, 2, 3], [4, 5, 6], [7, 8], [9, 10]]);
  });

  it('pulls an odd-sized race forward so a head-to-head is not split', () => {
    const a = race('a', 2), b = race('b', 3), c = race('c', 2), d = race('d', 3);
    const out = layoutTables([a, b, c, d]);
    expect(out.map((r) => r.race)).toEqual([a, b, d, c]);
    expect(out.map((r) => r.tables)).toEqual([[1, 2], [3, 4, 5], [6, 7, 8], [9, 10]]);
  });

  it('moves a lone 3-team race behind the head-to-heads', () => {
    const a = race('a', 3), b = race('b', 2);
    const out = layoutTables([a, b]);
    expect(out.map((r) => r.race)).toEqual([b, a]);
    expect(out.map((r) => r.tables)).toEqual([[1, 2], [3, 4, 5]]);
  });

  it('never splits a head-to-head when a 3-team heat sits mid-round (9 + 8 teams)', () => {
    const sizes = [2, 2, 2, 3, 2, 2, 2, 2];
    const out = layoutTables(sizes.map((n, i) => race(`r${i}`, n)));
    const split = out.filter((r) => r.race.length === 2 && r.tables[0]! % 2 === 0);
    expect(split).toEqual([]);
  });
});
