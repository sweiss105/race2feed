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

import { lockedWith, runRounds, openNext, start } from '../support/state';

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

import { buildBracketTrees, type BracketTree, type TreeMatch } from '../../src/lib/bracketModel';
import { ctlViewOf, knockoutSeeded, runRound, secs, teamId } from '../support/state';

describe('buildBracketTrees (knockout)', () => {
  const slot = (m: TreeMatch) => m.slots.map((x) => (x.kind === 'team' ? `${x.seed} ${x.text}${x.winner ? '*' : ''}` : x.text));
  const shape = (t: BracketTree) => t.columns.map((c) => [c.title, c.matches.map((m) => [m.name, slot(m)])]);
  const tree = (e: Parameters<typeof viewOf>[0]) => buildBracketTrees(viewOf(e))[0]!;

  it('has no trees before the first bracket round opens, nor in another format', () => {
    expect(buildBracketTrees(viewOf(knockoutSeeded(4)))).toEqual([]);
    expect(buildBracketTrees(viewOf(previousEventDone()))).toEqual([]);
  });

  it('race control has the tree as soon as the brackets are drawn', () => {
    expect(shape(buildBracketTrees(ctlViewOf(knockoutSeeded(4)))[0]!)[0]).toEqual(
      ['Semi-finals', [['Semi-final 1', ['1 T1', '4 T4']], ['Semi-final 2', ['2 T2', '3 T3']]]],
    );
  });

  it('four teams: semi-finals, the final and the third-place race, with placeholders until each is opened', () => {
    let e = openNext(knockoutSeeded(4));
    let t = tree(e);
    expect([t.categoryName, t.tierName, t.size, t.solo]).toEqual(['T', 'Gold', 4, null]);
    expect(shape(t)).toEqual([
      ['Semi-finals', [['Semi-final 1', ['1 T1', '4 T4']], ['Semi-final 2', ['2 T2', '3 T3']]]],
      ['Final', [['Final', ['Winner of Semi-final 1', 'Winner of Semi-final 2']]]],
    ]);
    expect([t.third!.name, slot(t.third!)]).toEqual(['Third place', ['Loser of Semi-final 1', 'Loser of Semi-final 2']]);
    expect(t.columns[1]!.matches[0]!.slots.map((x) => x.kind)).toEqual(['pending', 'pending']);

    // The semi-finals raced: T4 beats T1, T2 beats T3. Winners are marked; the final waits for its round to open.
    e = runRound(knockoutSeeded(4), { T1: 90_000, T4: 80_000, T2: 81_000, T3: 95_000 });
    t = tree(e);
    expect(shape(t)[0]).toEqual(['Semi-finals', [['Semi-final 1', ['1 T1', '4 T4*']], ['Semi-final 2', ['2 T2*', '3 T3']]]]);
    expect(t.columns[0]!.matches[0]!.slots.map((x) => x.entrant?.officialMs)).toEqual([90_000, 80_000]);
    expect(slot(t.columns[1]!.matches[0]!)).toEqual(['Winner of Semi-final 1', 'Winner of Semi-final 2']);

    // The final round open: the entrants are in the slots their semi-final feeds.
    t = tree(openNext(e));
    expect(slot(t.columns[1]!.matches[0]!)).toEqual(['4 T4', '2 T2']);
    expect(slot(t.third!)).toEqual(['1 T1', '3 T3']);

    // Raced to the end.
    t = tree(runRound(e, { T4: 80_000, T2: 79_000, T1: 85_000, T3: 86_000 }));
    expect(slot(t.columns[1]!.matches[0]!)).toEqual(['4 T4', '2 T2*']);
    expect(slot(t.third!)).toEqual(['1 T1*', '3 T3']);
  });

  it('five teams: the top three seeds have a bye and are already in the semi-finals', () => {
    const t = tree(openNext(knockoutSeeded(5)));
    expect(shape(t)).toEqual([
      ['Quarter-final', [['', ['1 T1', 'Bye']], ['Quarter-final', ['4 T4', '5 T5']], ['', ['2 T2', 'Bye']], ['', ['3 T3', 'Bye']]]],
      ['Semi-finals', [['Semi-final 1', ['1 T1', 'Winner of Quarter-final']], ['Semi-final 2', ['2 T2', '3 T3']]]],
      ['Final', [['Final', ['Winner of Semi-final 1', 'Winner of Semi-final 2']]]],
    ]);
    expect(t.columns[0]!.matches.map((m) => m.bye)).toEqual([true, false, true, true]);
    expect(t.columns[0]!.matches[0]!.slots.map((x) => x.kind)).toEqual(['team', 'bye']);
    expect(t.third!.name).toBe('Third place');
  });

  it('three teams: no third-place race', () => {
    const t = tree(openNext(knockoutSeeded(3)));
    expect(shape(t)).toEqual([
      ['Semi-final', [['', ['1 T1', 'Bye']], ['Semi-final', ['2 T2', '3 T3']]]],
      ['Final', [['Final', ['1 T1', 'Winner of Semi-final']]]],
    ]);
    expect(t.third).toBeNull();
  });

  it('eight teams: quarter-finals in draw order, 1 and 2 on opposite sides', () => {
    let e = runRound(knockoutSeeded(8), secs(8));
    let t = tree(e);
    expect(shape(t)[0]).toEqual(['Quarter-finals', [
      ['Quarter-final 1', ['1 T1*', '8 T8']], ['Quarter-final 2', ['4 T4*', '5 T5']],
      ['Quarter-final 3', ['2 T2*', '7 T7']], ['Quarter-final 4', ['3 T3*', '6 T6']],
    ]]);
    expect(shape(t)[1]).toEqual(['Semi-finals', [
      ['Semi-final 1', ['Winner of Quarter-final 1', 'Winner of Quarter-final 2']],
      ['Semi-final 2', ['Winner of Quarter-final 3', 'Winner of Quarter-final 4']],
    ]]);
    // Race control sees the next round's entrants once it is ready.
    expect(shape(buildBracketTrees(ctlViewOf(e))[0]!)[1]).toEqual(['Semi-finals', [
      ['Semi-final 1', ['1 T1', '4 T4']], ['Semi-final 2', ['2 T2', '3 T3']],
    ]]);
    e = runRound(runRound(e, secs(8)), secs(8));
    t = tree(e);
    expect(slot(t.columns[2]!.matches[0]!)).toEqual(['1 T1*', '2 T2']);
    expect(slot(t.third!)).toEqual(['4 T4', '3 T3*']);
  });

  it('sixteen teams: the first stage is the Round of 16', () => {
    const t = tree(openNext(knockoutSeeded(16)));
    expect(t.columns.map((c) => [c.title, c.matches.length])).toEqual([['Round of 16', 8], ['Quarter-finals', 4], ['Semi-finals', 2], ['Final', 1]]);
    expect(t.columns[0]!.matches[4]!.name).toBe('Round of 16 · 5');
    expect(slot(t.columns[1]!.matches[0]!)).toEqual(['Winner of Round of 16 · 1', 'Winner of Round of 16 · 2']);
  });

  it('nobody is marked the winner while a team is still racing; a DNF loses', () => {
    let e = start(openNext(knockoutSeeded(2)));
    const set = (name: string, set: { kind: 'time'; rawMs: number } | { kind: 'status'; status: 'dnf' }) =>
      ({ ...e, overrides: [...e.overrides, { round: e.round.current, teamId: teamId(e, name), at: 1_000_500, set }] });
    e = set('T2', { kind: 'time', rawMs: 99_000 });
    expect(slot(tree(e).columns[0]!.matches[0]!)).toEqual(['1 T1', '2 T2']);
    e = set('T1', { kind: 'status', status: 'dnf' });
    expect(slot(tree(e).columns[0]!.matches[0]!)).toEqual(['1 T1', '2 T2*']);
  });

  it('a bracket of one team has no race', () => {
    const e = openNext(runRound(lockedWith({ seedingRuns: 1, brackets: 'knockout' }, { counts: { T: 1, B: 2 } }), { 'T 1': 100_000, 'B 1': 101_000, 'B 2': 102_000 }));
    const trees = buildBracketTrees(viewOf(e));
    expect(trees.map((t) => [t.categoryName, t.size, t.solo?.text ?? null, t.columns.length])).toEqual([['T', 1, 'T 1', 0], ['B', 2, null, 1]]);
  });

  it('trees come in category then tier order, with seeds counted within the category', () => {
    const times = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`T ${i + 1}`, (100 + i) * 1000]));
    const e = openNext(runRounds(lockedWith({ seedingRuns: 1, brackets: 'knockout' }, { counts: { T: 10 }, tables: 8 }), [times, times]));
    const trees = buildBracketTrees(viewOf(e));
    expect(trees.map((t) => [t.tierName, t.size])).toEqual([['Gold', 8], ['Silver', 2]]);
    expect(slot(trees[1]!.columns[0]!.matches[0]!)).toEqual(['9 T 9', '10 T 10']);
  });
});
