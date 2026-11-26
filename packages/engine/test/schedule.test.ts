import { describe, it, expect } from 'vitest';
import { buildRoundPlan } from '../src/schedule';
import { suggestBracketPlan } from '../src/brackets';
import type { Category, EventInput, Team } from '../src/types';

const cats: Category[] = [{ id: 'hs', name: 'HS' }, { id: 'cm', name: 'Comm' }, { id: 'co', name: 'Corp' }];
function input(counts: number[], tableCount: number, grand = true, groups = ['A', 'B']): EventInput {
  const teams: Team[] = [];
  counts.forEach((n, c) => {
    for (let i = 0; i < n; i++) teams.push({ id: `${cats[c]!.id}${i}`, name: '', categoryId: cats[c]!.id, order: teams.length });
  });
  const categories = cats.slice(0, counts.length);
  return {
    tableCount, categories, teams,
    groups: groups.map((id) => ({ id, teamIds: [] })),
    tableOf: {}, brackets: suggestBracketPlan(categories, teams), grandChampionship: grand,
  };
}
const sizeOf = (inp: EventInput, ids: string[]) =>
  ids.reduce((s, id) => s + inp.brackets.find((b) => b.id === id)!.size, 0);

describe('buildRoundPlan', () => {
  it('reproduces the previous event shape', () => {
    const inp = input([14, 16, 20], 26);
    const plan = buildRoundPlan(inp);
    expect(plan.map((r) => r.round)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(plan.slice(0, 4)).toEqual([
      { round: 1, kind: 'seeding', groupId: 'A', run: 1 },
      { round: 2, kind: 'seeding', groupId: 'B', run: 1 },
      { round: 3, kind: 'seeding', groupId: 'A', run: 2 },
      { round: 4, kind: 'seeding', groupId: 'B', run: 2 },
    ]);
    const rest = plan.slice(4).map((r) => (r.kind === 'heats' || r.kind === 'placement' ? [r.kind, r.set, r.bracketIds.length, sizeOf(inp, r.bracketIds)] : [r.kind]));
    expect(rest).toEqual([
      ['heats', 'lower', 6, 26], ['heats', 'upper', 6, 24],
      ['placement', 'lower', 6, 26], ['placement', 'upper', 6, 24], ['grand'],
    ]);
  });

  it('chunks keep brackets whole within the table count', () => {
    const inp = input([14, 16, 20], 20);
    const plan = buildRoundPlan(inp);
    const lowerHeats = plan.filter((r) => r.kind === 'heats' && r.set === 'lower');
    const lowerPlace = plan.filter((r) => r.kind === 'placement' && r.set === 'lower');
    expect(lowerHeats.length).toBe(2);
    for (const r of plan) if (r.kind === 'heats' || r.kind === 'placement') expect(sizeOf(inp, r.bracketIds)).toBeLessThanOrEqual(20);
    expect(lowerPlace.map((r) => (r.kind === 'placement' ? r.bracketIds : []))).toEqual(
      lowerHeats.map((r) => (r.kind === 'heats' ? r.bracketIds : [])),
    );
  });

  it('a small bracket races only in heats', () => {
    const inp = input([4, 3], 26);
    const plan = buildRoundPlan(inp);
    const heats = plan.filter((r) => r.kind === 'heats');
    const placement = plan.filter((r) => r.kind === 'placement');
    expect(heats.flatMap((r) => (r.kind === 'heats' ? r.bracketIds : []))).toContain('cm:0');
    expect(placement.flatMap((r) => (r.kind === 'placement' ? r.bracketIds : []))).not.toContain('cm:0');
  });

  it('omits the grand round when only one category would produce a winner', () => {
    // Two A teams; B's bracket was left behind when its last team was removed.
    const two = input([2, 1], 3);
    const removed: EventInput = { ...two, categories: two.categories.slice(0, 1), teams: two.teams.filter((t) => t.categoryId === 'hs') };
    expect(removed.brackets.map((b) => b.categoryId)).toEqual(['hs', 'cm']);
    expect(buildRoundPlan(removed).some((r) => r.kind === 'grand')).toBe(false);
    // The category is still listed but has no teams.
    expect(buildRoundPlan({ ...removed, categories: two.categories }).some((r) => r.kind === 'grand')).toBe(false);
    // Only a top bracket sends a winner.
    const noTop: EventInput = { ...two, brackets: two.brackets.map((b) => (b.categoryId === 'cm' ? { ...b, tierIndex: 1 } : b)) };
    expect(buildRoundPlan(noTop).some((r) => r.kind === 'grand')).toBe(false);
    expect(buildRoundPlan(two).some((r) => r.kind === 'grand')).toBe(true);
  });
  it('omits the grand round when disabled or with one category', () => {
    expect(buildRoundPlan(input([14, 16], 26, false)).some((r) => r.kind === 'grand')).toBe(false);
    expect(buildRoundPlan(input([14], 26, true)).some((r) => r.kind === 'grand')).toBe(false);
  });
});
