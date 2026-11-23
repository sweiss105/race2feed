import { describe, it, expect } from 'vitest';
import { suggestSeedingGroups, validateSeedingGroups } from '../src/groups';
import type { Category, EventInput, Team } from '../src/types';

const cats: Category[] = [{ id: 'hs', name: 'HS' }, { id: 'cm', name: 'Comm' }, { id: 'co', name: 'Corp' }];
function teams(counts: number[]): Team[] {
  const out: Team[] = [];
  counts.forEach((n, c) => {
    for (let i = 0; i < n; i++) out.push({ id: `${cats[c]!.id}${i}`, name: '', categoryId: cats[c]!.id, order: out.length });
  });
  return out;
}

describe('suggestSeedingGroups', () => {
  it('splits 14/16/20 on 26 tables into two groups of 25', () => {
    const ts = teams([14, 16, 20]);
    const { groups, tableOf } = suggestSeedingGroups(cats, ts, 26);
    expect(groups.map((g) => g.id)).toEqual(['A', 'B']);
    expect(groups.map((g) => g.teamIds.length)).toEqual([25, 25]);
    const inA = (c: string) => groups[0]!.teamIds.filter((id) => id.startsWith(c)).length;
    expect([inA('hs'), inA('cm'), inA('co')]).toEqual([7, 8, 10]);
    expect(groups[0]!.teamIds.map((id) => tableOf[id])).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
    expect(groups[0]!.teamIds.slice(0, 2)).toEqual(['hs0', 'hs1']);
  });

  it('fits exactly at capacity in one group', () => {
    expect(suggestSeedingGroups(cats, teams([26]), 26).groups.length).toBe(1);
  });

  it('needs a second group one over capacity', () => {
    expect(suggestSeedingGroups(cats, teams([27]), 26).groups.length).toBe(2);
  });

  it('never exceeds the table count with odd-sized categories', () => {
    const { groups } = suggestSeedingGroups(cats, teams([15, 17, 20]), 26);
    expect(groups.length).toBe(2);
    for (const g of groups) expect(g.teamIds.length).toBeLessThanOrEqual(26);
  });
});

describe('validateSeedingGroups', () => {
  const base = (): EventInput => {
    const ts = teams([3]);
    return {
      tableCount: 4, categories: cats, teams: ts,
      groups: [{ id: 'A', teamIds: ts.map((t) => t.id) }],
      tableOf: { hs0: 1, hs1: 2, hs2: 3 }, brackets: [], grandChampionship: false,
    };
  };
  it('accepts a valid assignment', () => {
    expect(validateSeedingGroups(base())).toEqual([]);
  });
  it('flags a team in no group', () => {
    const i = base(); i.groups[0]!.teamIds.pop();
    expect(validateSeedingGroups(i)).not.toEqual([]);
  });
  it('flags a team in two groups', () => {
    const i = base(); i.groups.push({ id: 'B', teamIds: ['hs0'] });
    expect(validateSeedingGroups(i)).not.toEqual([]);
  });
  it('flags two teams on one table in a group', () => {
    const i = base(); i.tableOf.hs1 = 1;
    expect(validateSeedingGroups(i)).not.toEqual([]);
  });
  it('flags tables out of range', () => {
    const i = base(); i.tableOf.hs2 = 5;
    expect(validateSeedingGroups(i)).not.toEqual([]);
    i.tableOf.hs2 = 0;
    expect(validateSeedingGroups(i)).not.toEqual([]);
  });
});
