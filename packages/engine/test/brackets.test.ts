import { describe, it, expect } from 'vitest';
import {
  suggestBracketPlan, validateBracketPlan, bracketSet, buildHeats, buildPlacement,
} from '../src/brackets';
import type { BracketSpec, Category, EventInput, Team } from '../src/types';

const cat: Category = { id: 'c', name: 'Cat' };
const teamsOf = (n: number, categoryId = 'c'): Team[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${categoryId}${i}`, name: `T${i}`, categoryId, order: i }));
const sizes = (n: number) => suggestBracketPlan([cat], teamsOf(n)).map((b) => b.size);

describe('suggestBracketPlan', () => {
  it('14 teams → 4,4,6 Gold/Silver/Bronze', () => {
    const plan = suggestBracketPlan([cat], teamsOf(14));
    expect(plan.map((b) => [b.size, b.tierName, b.firstSeed, b.id])).toEqual([
      [4, 'Gold', 1, 'c:0'], [4, 'Silver', 5, 'c:1'], [6, 'Bronze', 9, 'c:2'],
    ]);
  });
  it('sizes for other counts', () => {
    expect(sizes(16)).toEqual([4, 4, 4, 4]);
    expect(sizes(9)).toEqual([4, 5]);
    expect(sizes(7)).toEqual([7]);
    expect(sizes(3)).toEqual([3]);
  });
  it('names tiers past Tin', () => {
    expect(suggestBracketPlan([cat], teamsOf(20)).at(-1)!.tierName).toBe('Tin');
    const plan = suggestBracketPlan([cat], teamsOf(24));
    expect(plan.length).toBe(6);
    expect(plan[5]!.tierName).toBe('Tier 6');
  });
  it('orders output by category then tier', () => {
    const cats = [{ id: 'x', name: 'X' }, { id: 'y', name: 'Y' }];
    const plan = suggestBracketPlan(cats, [...teamsOf(4, 'y'), ...teamsOf(8, 'x')]);
    expect(plan.map((b) => b.id)).toEqual(['x:0', 'x:1', 'y:0']);
  });
});

describe('buildHeats', () => {
  it('pairs outside-in', () => {
    expect(buildHeats([1, 2, 3, 4])).toEqual([[1, 4], [2, 3]]);
    expect(buildHeats([9, 10, 11, 12, 13, 14])).toEqual([[9, 14], [10, 13], [11, 12]]);
  });
  it('odd sizes put the middle seed in the last heat', () => {
    expect(buildHeats([9, 10, 11, 12, 13])).toEqual([[9, 13], [10, 12, 11]]);
    expect(buildHeats([1, 2, 3, 4, 5, 6, 7])).toEqual([[1, 7], [2, 6], [3, 5, 4]]);
  });
  it('fewer than 4 teams race once', () => {
    expect(buildHeats([1, 2, 3])).toEqual([[1, 2, 3]]);
  });
});

describe('buildPlacement', () => {
  it('heat winners vs the rest, in heat order', () => {
    expect(buildPlacement([[4, 1], [2, 3]])).toEqual({ winners: [4, 2], others: [1, 3] });
    expect(buildPlacement([[9, 13], [11, 10, 12]])).toEqual({ winners: [9, 11], others: [13, 10, 12] });
  });
});

describe('bracketSet', () => {
  const b = (tierIndex: number) => ({ tierIndex }) as BracketSpec;
  it('Gold and Silver are upper, the rest lower', () => {
    expect(bracketSet(b(0))).toBe('upper');
    expect(bracketSet(b(1))).toBe('upper');
    expect(bracketSet(b(2))).toBe('lower');
  });
});

describe('validateBracketPlan', () => {
  const input = (brackets: BracketSpec[], n = 8, tableCount = 26): EventInput => ({
    tableCount, categories: [cat], teams: teamsOf(n), groups: [], tableOf: {}, brackets, grandChampionship: false,
  });
  const spec = (tierIndex: number, firstSeed: number, size: number): BracketSpec =>
    ({ id: `c:${tierIndex}`, categoryId: 'c', tierIndex, tierName: 'x', firstSeed, size });

  it('accepts the suggested plan', () => {
    expect(validateBracketPlan(input(suggestBracketPlan([cat], teamsOf(8))))).toEqual([]);
  });
  it('rejects sizes that do not cover the category', () => {
    expect(validateBracketPlan(input([spec(0, 1, 4)]))).not.toEqual([]);
  });
  it('rejects non-contiguous seeds', () => {
    expect(validateBracketPlan(input([spec(0, 1, 4), spec(1, 6, 4)]))).not.toEqual([]);
  });
  it('rejects sizes outside 4–7 when the category has 4+ teams', () => {
    expect(validateBracketPlan(input([spec(0, 1, 3), spec(1, 4, 5)]))).not.toEqual([]);
  });
  it('rejects a bracket larger than the table count', () => {
    expect(validateBracketPlan(input([spec(0, 1, 4), spec(1, 5, 4)], 8, 3))).not.toEqual([]);
  });
  describe('Grand Championship table count', () => {
    const grand = (tableCount: number, grandChampionship: boolean): EventInput => {
      const ids = ['a', 'b', 'c', 'd', 'e'];
      const categories = ids.map((id) => ({ id, name: id.toUpperCase() }));
      const teams = ids.flatMap((id) => teamsOf(4, id));
      return { tableCount, categories, teams, groups: [], tableOf: {}, brackets: suggestBracketPlan(categories, teams), grandChampionship };
    };
    const msg = 'Grand Championship: 5 category winners but only 4 tables';
    it('rejects more category winners than tables', () => {
      expect(validateBracketPlan(grand(4, true))).toContain(msg);
    });
    it('does not complain when the Grand Championship is off', () => {
      expect(validateBracketPlan(grand(4, false))).not.toContain(msg);
    });
    it('does not complain when there are enough tables', () => {
      expect(validateBracketPlan(grand(5, true))).not.toContain(msg);
    });
  });
});
