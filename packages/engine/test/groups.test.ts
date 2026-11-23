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
  it('fills groups in category order: 14/16/20 on 26 tables gives 26 and 24', () => {
    const ts = teams([14, 16, 20]);
    const { groups, tableOf } = suggestSeedingGroups(cats, ts, 26);
    expect(groups.map((g) => g.id)).toEqual(['A', 'B']);
    expect(groups.map((g) => g.teamIds.length)).toEqual([26, 24]);
    const count = (g: number, c: string) => groups[g]!.teamIds.filter((id) => id.startsWith(c)).length;
    expect([count(0, 'hs'), count(0, 'cm'), count(0, 'co')]).toEqual([14, 12, 0]);
    expect([count(1, 'hs'), count(1, 'cm'), count(1, 'co')]).toEqual([0, 4, 20]);
    expect(groups[0]!.teamIds.map((id) => tableOf[id])).toEqual(Array.from({ length: 26 }, (_, i) => i + 1));
    expect(groups[1]!.teamIds.map((id) => tableOf[id])).toEqual(Array.from({ length: 24 }, (_, i) => i + 1));
  });

  it('keeps a small category whole when it fits', () => {
    const { groups } = suggestSeedingGroups(cats, teams([30, 3]), 26);
    expect(groups.map((g) => g.teamIds.length)).toEqual([26, 7]);
    expect(groups[1]!.teamIds.filter((id) => id.startsWith('cm')).length).toBe(3);
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
