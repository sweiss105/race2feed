import { describe, it, expect } from 'vitest';
import { buildBracketCards, buildBracketDiagram } from '../../src/lib/bracketModel';
import { previousEventDone, previousEvent, viewOf } from '../support/state';

describe('buildBracketCards', () => {
  const cards = buildBracketCards(viewOf(previousEventDone()));
  const hs = cards.find((c) => c.categoryName === 'High School')!;

  it('groups brackets by category (in CSV order) and tier', () => {
    expect(cards.map((c) => c.categoryName)).toEqual(['High School', 'Corporate', 'Community']);
    expect(hs.brackets.map((b) => b.tierName)).toEqual(['Gold', 'Silver', 'Bronze']);
  });

  it('lists each stage of a bracket with its races', () => {
    const bronze = hs.brackets[2]!;
    expect(bronze.stages.map((s) => s.title)).toEqual(['Round 5 · First race', 'Round 7 · Placement', 'Final places']);
    expect(bronze.stages[0]!.races.length).toBe(3);
    expect(bronze.stages[1]!.races.map((r) => r.entrants.length)).toEqual([3, 3]);
  });

  it('final places come from the standings', () => {
    const gold = hs.brackets[0]!;
    const places = gold.stages.at(-1)!.races[0]!.entrants;
    expect(places.map((p) => [p.place, p.name])).toEqual([
      [1, 'Riverbend Middle School'], [2, 'Central Football Team'], [3, 'Cedar Falls High School #2'], [4, 'Northwind'],
    ]);
  });

  it('shows no stages before brackets start', () => {
    const before = buildBracketCards(viewOf(previousEvent()));
    expect(before.every((c) => c.brackets.every((b) => b.stages.length === 0))).toBe(true);
  });
});

describe('buildBracketDiagram', () => {
  it('makes one column per stage', () => {
    const card = buildBracketCards(viewOf(previousEventDone()))[0]!.brackets[0]!;
    const d = buildBracketDiagram(card);
    expect(d.columns.map((c) => c.title)).toEqual(['Round 6 · First race', 'Round 8 · Placement', 'Final places']);
    expect(d.columns[0]!.groups.length).toBe(2);
  });
});

import { lockedWith, runRounds, openNext } from '../support/state';

describe('finals only', () => {
  const sec = (...s: number[]) => Object.fromEntries(s.map((v, i) => [`T${i + 1}`, v * 1000]));
  it('shows a bracket as one race, the Final, with the finishing order and no placement stage', () => {
    const e = runRounds(lockedWith({ seedingRuns: 1, brackets: 'finals' }), [sec(100, 110, 120, 130), sec(140, 110, 120, 130)]);
    const [gold] = buildBracketCards(viewOf(e))[0]!.brackets;
    expect(gold!.stages.map((s) => s.title)).toEqual(['Round 2 · Final']);
    expect(gold!.stages[0]!.races.map((r) => r.label)).toEqual(['Final']);
    expect(gold!.stages[0]!.races[0]!.entrants.map((x) => [x.name, x.place])).toEqual([['T1', 4], ['T2', 1], ['T3', 2], ['T4', 3]]);
    expect(buildBracketDiagram(gold!).columns.map((c) => c.title)).toEqual(['Round 2 · Final']);
  });
  it('shows the open final before it is raced', () => {
    const e = openNext(runRounds(lockedWith({ seedingRuns: 1, brackets: 'finals' }), [sec(100, 110, 120, 130)]));
    const [gold] = buildBracketCards(viewOf(e))[0]!.brackets;
    expect(gold!.stages.map((s) => s.title)).toEqual(['Round 2 · Final']);
    expect(gold!.stages[0]!.races[0]!.entrants.map((x) => x.place)).toEqual([null, null, null, null]);
  });
  it('seeding only has no bracket cards at all', () => {
    const e = runRounds(lockedWith({ seedingRuns: 1, brackets: 'none' }), [sec(100, 110, 120, 130)]);
    expect(buildBracketCards(viewOf(e)).flatMap((c) => c.brackets)).toEqual([]);
  });
});
