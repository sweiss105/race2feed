import { describe, it, expect } from 'vitest';
import { formatOf, validateFormat, type EntryResult, type EventInput, type SeedingRankRule, type Team, type TournamentFormat } from '../src/types';
import { buildRoundPlan } from '../src/schedule';
import { rankSeeding, seedingScore } from '../src/seeding';
import { deriveEvent } from '../src/event';
import { grandCategories, suggestBracketPlan, validateBracketPlan } from '../src/brackets';
import { fin, makeEvent, previousEvent, progress, seedInOrder } from './helpers/events';

const dnf: EntryResult = { status: 'dnf', rawMs: null, penaltiesMs: 0 };
const withFormat = (input: EventInput, format: TournamentFormat): EventInput =>
  ({ ...input, format, ...(format.brackets === 'none' ? { brackets: [] } : {}) });

describe('formatOf and validateFormat', () => {
  it('a missing format is today\'s format', () => {
    expect(formatOf({})).toEqual({ seedingRuns: 2, seedingRank: 'total', brackets: 'placement' });
    expect(formatOf({ format: {} })).toEqual({ seedingRuns: 2, seedingRank: 'total', brackets: 'placement' });
    expect(formatOf({ format: { seedingRuns: 3 } })).toEqual({ seedingRuns: 3, seedingRank: 'total', brackets: 'placement' });
    expect(formatOf({ format: { seedingRank: 'best', brackets: 'none' } })).toEqual({ seedingRuns: 2, seedingRank: 'best', brackets: 'none' });
  });

  it('refuses best run with one run and drop the slowest with fewer than three', () => {
    expect(validateFormat({ seedingRuns: 1, seedingRank: 'best' })).toEqual(['Best run needs at least two seeding rounds.']);
    expect(validateFormat({ seedingRuns: 2, seedingRank: 'dropSlowest' })).toEqual(['Drop the slowest needs three seeding rounds.']);
    expect(validateFormat({ seedingRank: 'dropSlowest' })).toEqual(['Drop the slowest needs three seeding rounds.']);
    expect(validateFormat({ seedingRuns: 1, seedingRank: 'dropSlowest' })).toEqual(['Drop the slowest needs three seeding rounds.']);
  });

  it('accepts every other combination', () => {
    expect(validateFormat(undefined)).toEqual([]);
    expect(validateFormat({})).toEqual([]);
    for (const seedingRuns of [1, 2, 3] as const) {
      for (const brackets of ['placement', 'finals', 'none', 'knockout'] as const) {
        expect(validateFormat({ seedingRuns, seedingRank: 'total', brackets })).toEqual([]);
      }
    }
    expect(validateFormat({ seedingRuns: 2, seedingRank: 'best' })).toEqual([]);
    expect(validateFormat({ seedingRuns: 3, seedingRank: 'best' })).toEqual([]);
    expect(validateFormat({ seedingRuns: 3, seedingRank: 'dropSlowest' })).toEqual([]);
  });

  it('refuses values it does not know', () => {
    expect(validateFormat({ seedingRuns: 4 as never })).toEqual(['Seeding rounds must be 1, 2 or 3.']);
    expect(validateFormat({ seedingRank: 'fastest' as never })).toEqual(['That seeding rank is not one of the choices.']);
    expect(validateFormat({ brackets: 'swiss' as never })).toEqual(['That bracket format is not one of the choices.']);
    expect(validateFormat('finals' as never)).toEqual(['The format is not valid.']);
  });
});

describe('buildRoundPlan with a format', () => {
  // 14 + 16 teams on 26 tables in two seeding groups; brackets 4,4,6 and 4,4,4,4.
  const base = (() => {
    const input = makeEvent([['a', 14], ['b', 16]], 26, true);
    expect(input.groups.map((g) => g.id)).toEqual(['A', 'B']);
    return input;
  })();
  const seeding = (input: EventInput) =>
    buildRoundPlan(input).flatMap((r) => (r.kind === 'seeding' ? [`${r.groupId}${r.run}`] : []));

  it('runs every group once per seeding run, all of run 1 first', () => {
    expect(seeding(withFormat(base, { seedingRuns: 1 }))).toEqual(['A1', 'B1']);
    expect(seeding(withFormat(base, { seedingRuns: 2 }))).toEqual(['A1', 'B1', 'A2', 'B2']);
    expect(seeding(withFormat(base, { seedingRuns: 3 }))).toEqual(['A1', 'B1', 'A2', 'B2', 'A3', 'B3']);
    expect(buildRoundPlan(withFormat(base, { seedingRuns: 3 })).map((r) => r.round)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it('finals only: one finals round per chunk of brackets, no placement rounds', () => {
    const standard = buildRoundPlan(base);
    const finals = buildRoundPlan(withFormat(base, { brackets: 'finals' }));
    expect(finals.map((r) => r.kind)).toEqual(['seeding', 'seeding', 'seeding', 'seeding', 'finals', 'finals', 'grand']);
    const chunks = (plan: typeof standard, kind: string) =>
      plan.flatMap((r) => (r.kind === kind && 'bracketIds' in r ? [[r.set, r.bracketIds]] : []));
    expect(chunks(finals, 'finals')).toEqual(chunks(standard, 'heats'));
    // Fewer tables: the same chunking as the heats.
    const tight = { ...base, tableCount: 12 };
    expect(chunks(buildRoundPlan(withFormat(tight, { brackets: 'finals' })), 'finals')).toEqual(chunks(buildRoundPlan(tight), 'heats'));
    expect(chunks(buildRoundPlan(tight), 'heats').length).toBeGreaterThan(2);
  });

  it('seeding only: seeding rounds, and the grand round when two categories have teams', () => {
    expect(buildRoundPlan(withFormat(base, { brackets: 'none' })).map((r) => r.kind))
      .toEqual(['seeding', 'seeding', 'seeding', 'seeding', 'grand']);
    expect(buildRoundPlan(withFormat({ ...base, grandChampionship: false }, { brackets: 'none' })).map((r) => r.kind))
      .toEqual(['seeding', 'seeding', 'seeding', 'seeding']);
    // Brackets left in the setup are not raced.
    expect(buildRoundPlan({ ...base, format: { brackets: 'none', seedingRuns: 1 } }).map((r) => r.kind)).toEqual(['seeding', 'seeding', 'grand']);
  });

  it('seeding only with one category that has teams: no grand round', () => {
    const one = withFormat(makeEvent([['a', 5]], 8, true), { brackets: 'none' });
    expect(buildRoundPlan(one).map((r) => r.kind)).toEqual(['seeding', 'seeding']);
    // A second category is listed but has no teams.
    const empty = { ...one, categories: [...one.categories, { id: 'b', name: 'B' }] };
    expect(grandCategories(empty)).toEqual(['a']);
    expect(buildRoundPlan(empty).map((r) => r.kind)).toEqual(['seeding', 'seeding']);
  });

  it('knockout is not built yet', () => {
    expect(() => buildRoundPlan(withFormat(base, { brackets: 'knockout' }))).toThrow('knockout is not built yet');
  });
});

describe('brackets with a format', () => {
  const input = makeEvent([['a', 5], ['b', 4]], 10, true);

  it('seeding only: no brackets suggested, none required, any present is a problem', () => {
    expect(suggestBracketPlan(input.categories, input.teams, undefined, 'none')).toEqual([]);
    expect(suggestBracketPlan(input.categories, input.teams, undefined, 'finals')).toEqual(suggestBracketPlan(input.categories, input.teams));
    expect(suggestBracketPlan(input.categories, input.teams, undefined, 'placement')).toEqual(input.brackets);
    expect(validateBracketPlan(withFormat(input, { brackets: 'none' }))).toEqual([]);
    expect(validateBracketPlan({ ...input, format: { brackets: 'none' } }))
      .toEqual(['Seeding only uses no brackets. Remove them, or suggest groups and brackets again.']);
    expect(validateBracketPlan(withFormat(input, { brackets: 'finals' }))).toEqual([]);
    expect(validateBracketPlan({ ...input, brackets: [], format: { brackets: 'finals' } }).length).toBeGreaterThan(0);
  });

  it('seeding only: the Grand Championship still has to fit the tables', () => {
    const three = withFormat(makeEvent([['a', 1], ['b', 1], ['c', 1]], 2, true), { brackets: 'none' });
    expect(grandCategories(three)).toEqual(['a', 'b', 'c']);
    expect(validateBracketPlan(three)).toEqual(['Grand Championship: 3 category winners but only 2 tables']);
  });
});

describe('seeding rank rules', () => {
  const teams: Team[] = ['A', 'B', 'C', 'D'].map((id, order) => ({ id, name: id, categoryId: 'c', order }));
  /** times[team] = one entry per run: seconds, 'dnf', or undefined (no result). */
  type Cell = number | 'dnf' | undefined;
  const runsOf = (times: Record<string, Cell[]>, count: number) =>
    Array.from({ length: count }, (_, i) => Object.fromEntries(
      Object.entries(times).flatMap(([id, list]) => (list[i] === undefined ? [] : [[id, list[i] === 'dnf' ? dnf : fin(list[i] as number)]])),
    ));
  const order = (times: Record<string, Cell[]>, count: number, rule?: SeedingRankRule) => {
    const rank = rankSeeding(teams, runsOf(times, count), rule);
    return [...teams].sort((a, b) => rank[a.id]! - rank[b.id]!).map((t) => t.id).join('');
  };

  it.each<[string, SeedingRankRule, number, Record<string, Cell[]>, string]>([
    // total
    ['total, 1 run: lower time wins', 'total', 1, { A: [70], B: [60], C: [80], D: [65] }, 'BDAC'],
    ['total, 1 run: a finished run beats none, DNF and no result alike in team order', 'total', 1, { A: ['dnf'], B: [], C: [90], D: [80] }, 'DCAB'],
    ['total, 1 run: equal at the hundredth falls to team order', 'total', 1, { A: [60.009], B: [60.001], C: [59], D: [60.011] }, 'CABD'],
    ['total, 2 runs: two finished beat one regardless of time', 'total', 2, { A: [10, 'dnf'], B: [300, 300], C: [10], D: [200, 200] }, 'DBAC'],
    ['total, 2 runs: equal total falls to the better single run', 'total', 2, { A: [100, 100], B: [90, 110], C: [80, 120], D: [100, 100.004] }, 'CBAD'],
    ['total, 3 runs: lower total; three finished beat two', 'total', 3, { A: [60, 60, 60], B: [50, 50, 79], C: [10, 10, 'dnf'], D: [60, 60, 58] }, 'DBAC'],
    ['total, 3 runs: equal total and best run fall to team order', 'total', 3, { A: [50, 60, 70], B: [50, 70, 60], C: [50, 65, 65], D: [49, 61, 70] }, 'DABC'],
    // best
    ['best, 2 runs: one fast run and a DNF beat two slower runs', 'best', 2, { A: [70, 71], B: [60, 'dnf'], C: [65, 200], D: [69, 69] }, 'BCDA'],
    ['best, 2 runs: no finished run ranks last', 'best', 2, { A: ['dnf', 'dnf'], B: [], C: [300, 'dnf'], D: ['dnf', 299] }, 'DCAB'],
    ['best, 2 runs: equal best at the hundredth falls to the lower total of finished runs, then team order', 'best', 2, { A: [60.001, 90], B: [60.009, 80], C: [60.005], D: [60, 80.004] }, 'CBDA'],
    ['best, 3 runs: only the fastest run counts', 'best', 3, { A: [100, 100, 61], B: [62, 62, 62], C: [300, 60, 300], D: ['dnf', 'dnf', 63] }, 'CABD'],
    // dropSlowest
    ['dropSlowest, 3 runs: best two; a DNF is the dropped run; fewer counted runs rank lower', 'dropSlowest', 3,
      { A: [60, 62, 'dnf'], B: [60, 61, 90], C: [50, 'dnf', 'dnf'], D: ['dnf', 'dnf', 'dnf'] }, 'BACD'],
    ['dropSlowest, 3 runs: equal counted total falls to the better single run, then team order', 'dropSlowest', 3,
      { A: [60, 62, 300], B: [61, 61, 61], C: [59, 63, 'dnf'], D: [60, 62.004, 200] }, 'CADB'],
    ['dropSlowest, 3 runs: a run with no result yet counts as the dropped one', 'dropSlowest', 3,
      { A: [70, 70], B: [60, 60, 200], C: [65], D: [69, 70, 71] }, 'BDAC'],
  ])('%s', (_name, rule, count, times, expected) => {
    expect(order(times, count, rule)).toBe(expected);
  });

  it('the rule defaults to total, and ranks are per category', () => {
    expect(order({ A: [10, 'dnf'], B: [300, 300], C: [10], D: [200, 200] }, 2)).toBe('DBAC');
    const mixed: Team[] = [{ ...teams[0]!, categoryId: 'x' }, ...teams.slice(1)];
    expect(rankSeeding(mixed, runsOf({ A: [90, 90], B: [50, 60], C: [50, 50], D: [70, 70] }, 2), 'best')).toEqual({ A: 1, C: 1, B: 2, D: 3 });
  });

  it('penalties count in the run time under every rule', () => {
    const slow: EntryResult = { status: 'finished', rawMs: 60_000, penaltiesMs: 10_000 };
    for (const rule of ['total', 'best', 'dropSlowest'] as const) {
      const runs = [{ A: slow, B: fin(65) }, { A: slow, B: fin(65) }, { A: slow, B: fin(65) }];
      expect(rankSeeding(teams.slice(0, 2), runs, rule)).toEqual({ B: 1, A: 2 });
    }
  });

  it('seedingScore: the time a team is ranked on, at the hundredth', () => {
    expect(seedingScore([60_000, 61_000, 90_000], 'total')).toBe(211_000);
    expect(seedingScore([60_000, null, 90_000], 'total')).toBe(150_000);
    expect(seedingScore([60_004, 61_009], 'total')).toBe(121_010);
    expect(seedingScore([60_000], 'total')).toBe(60_000);
    expect(seedingScore([null, null], 'total')).toBeNull();
    expect(seedingScore([], 'total')).toBeNull();

    expect(seedingScore([60_000, 61_000, 90_000], 'best')).toBe(60_000);
    expect(seedingScore([null, 61_009], 'best')).toBe(61_000);
    expect(seedingScore([null, null, null], 'best')).toBeNull();

    expect(seedingScore([60_000, 61_000, 90_000], 'dropSlowest')).toBe(121_000);
    expect(seedingScore([60_000, 62_000, null], 'dropSlowest')).toBe(122_000);
    expect(seedingScore([50_000, null, null], 'dropSlowest')).toBe(50_000);
    expect(seedingScore([90_000, 60_004, 61_009], 'dropSlowest')).toBe(121_010);
    expect(seedingScore([null, null, null], 'dropSlowest')).toBeNull();
  });
});

describe('finals only', () => {
  // a: 7 teams (one bracket of 7), b: 1 team, on 8 tables, one seeding group.
  // Rounds: 1–2 seeding, 3 finals (both brackets), 4 grand.
  const input = withFormat(makeEvent([['a', 7], ['b', 1]], 8, true), { brackets: 'finals' });
  const seeded = seedInOrder(input, [1, 2]);
  const final = { 3: { a0: fin(205), a1: fin(200), a2: fin(210), a3: fin(215), a4: fin(220), a5: fin(225), a6: fin(230), b0: fin(300) } };

  it('each bracket races once, all its teams together', () => {
    expect(buildRoundPlan(input).map((r) => r.kind)).toEqual(['seeding', 'seeding', 'finals', 'grand']);
    const ev = deriveEvent(input, progress(2, seeded));
    const races = ev.rounds[2]!.races;
    expect(races.map((r) => [r.id, r.label, r.role, r.bracketId])).toEqual([
      ['r3:a:0:final', 'A Gold · Final', 'final', 'a:0'],
      ['r3:b:0:final', 'B Gold · Final', 'final', 'b:0'],
    ]);
    expect(races[0]!.entrants.map((x) => x.teamId).sort()).toEqual(['a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6']);
    expect(races[0]!.fallbackOrder).toEqual(['a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6']);
    expect(races[1]!.entrants.map((x) => x.teamId)).toEqual(['b0']);
    expect(races.flatMap((r) => r.entrants.map((x) => x.table)).sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(ev.bracketMembers).toEqual({ 'a:0': ['a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6'], 'b:0': ['b0'] });
    expect(ev.standings).toEqual({ a: [null, null, null, null, null, null, null], b: [null] });
    expect(ev.categoryWinners).toEqual({ a: null, b: null });
  });

  it('the finishing order is the standings, and the grand round takes the two winners', () => {
    const ev = deriveEvent(input, progress(3, { ...seeded, ...final }));
    expect(ev.standings).toEqual({ a: ['a1', 'a0', 'a2', 'a3', 'a4', 'a5', 'a6'], b: ['b0'] });
    expect(ev.categoryWinners).toEqual({ a: 'a1', b: 'b0' });
    expect(ev.rounds[3]!.status).toBe('ready');
    expect(ev.rounds[3]!.races[0]!.entrants.map((x) => x.teamId)).toEqual(['a1', 'b0']);
    expect(ev.grandChampion).toBeNull();
    const done = deriveEvent(input, progress(4, { ...seeded, ...final, 4: { a1: fin(200), b0: fin(190) } }));
    expect(done.grandChampion).toBe('b0');
    expect(done.blockers).toEqual([]);
  });

  it('a tie in the final blocks the grand round until decided', () => {
    const tied = { 3: { ...final[3], a0: fin(200.004) } };
    const ev = deriveEvent(input, progress(3, { ...seeded, ...tied }));
    expect(ev.blockers).toEqual(['Round 3: tie in r3:a:0:final']);
    expect(ev.rounds[3]!.status).toBe('blocked');
    expect(ev.standings.a).toEqual([null, null, null, null, null, null, null]);
  });

  it('in the placement format a small bracket keeps its label', () => {
    const standard = makeEvent([['a', 4], ['b', 3]], 8, true);
    const ev = deriveEvent(standard, progress(2, seedInOrder(standard, [1, 2])));
    expect(ev.rounds[2]!.races.find((r) => r.bracketId === 'b:0')!.label).toBe('B Gold · Race');
  });
});

describe('seeding only', () => {
  // a: 3 teams, b: 2 teams on 5 tables, one seeding group. Rounds: 1–2 seeding, 3 grand.
  const two = withFormat(makeEvent([['a', 3], ['b', 2]], 5, true), { brackets: 'none' });
  // Seed order: a2, a0, a1 and b1, b0.
  const run = { a0: fin(110), a1: fin(120), a2: fin(100), b0: fin(210), b1: fin(200) };

  it('standings are null until the last seeding round is finished, then seed order', () => {
    expect(buildRoundPlan(two).map((r) => r.kind)).toEqual(['seeding', 'seeding', 'grand']);
    const mid = deriveEvent(two, progress(1, { 1: run, 2: run }));
    expect(mid.seedRank).toBeNull();
    expect(mid.standings).toEqual({ a: [null, null, null], b: [null, null] });
    expect(mid.categoryWinners).toEqual({ a: null, b: null });
    expect(mid.rounds[2]!.status).toBe('blocked');

    const ev = deriveEvent(two, progress(2, { 1: run, 2: run }));
    expect(ev.seedRank).toEqual({ a2: 1, a0: 2, a1: 3, b1: 1, b0: 2 });
    expect(ev.standings).toEqual({ a: ['a2', 'a0', 'a1'], b: ['b1', 'b0'] });
    expect(ev.categoryWinners).toEqual({ a: 'a2', b: 'b1' });
    expect(ev.bracketMembers).toBeNull();
    expect(ev.blockers).toEqual([]);
  });

  it('the grand round races each category\'s top seed, and its winner is the champion', () => {
    const ev = deriveEvent(two, progress(2, { 1: run, 2: run }));
    const grand = ev.rounds[2]!;
    expect(grand.status).toBe('ready');
    expect(grand.races.map((r) => [r.id, r.label, r.role])).toEqual([['r3:grand', 'Grand Championship', 'grand']]);
    expect(grand.races[0]!.entrants).toEqual([{ teamId: 'a2', table: 1 }, { teamId: 'b1', table: 2 }]);
    expect(ev.grandChampion).toBeNull();
    const done = deriveEvent(two, progress(3, { 1: run, 2: run, 3: { a2: fin(100), b1: fin(90) } }));
    expect(done.grandChampion).toBe('b1');
    expect(done.standings).toEqual({ a: ['a2', 'a0', 'a1'], b: ['b1', 'b0'] });
  });

  it('one category: no grand round, and the top seed is the category winner', () => {
    const one = withFormat(makeEvent([['a', 3]], 4, true), { brackets: 'none', seedingRuns: 1 });
    expect(buildRoundPlan(one).map((r) => r.kind)).toEqual(['seeding']);
    const before = deriveEvent(one, progress(0));
    expect(before.categoryWinners).toEqual({ a: null });
    const ev = deriveEvent(one, progress(1, { 1: { a0: fin(110), a1: fin(105), a2: fin(120) } }));
    expect(ev.rounds.map((r) => r.status)).toEqual(['locked']);
    expect(ev.standings).toEqual({ a: ['a1', 'a0', 'a2'] });
    expect(ev.categoryWinners).toEqual({ a: 'a1' });
    expect(ev.grandChampion).toBeNull();
    expect(ev.bracketMembers).toBeNull();
  });

  it('a cleared seeding result leaves the standings null and blocks', () => {
    const { a1: _cleared, ...rest } = run;
    const ev = deriveEvent(two, progress(2, { 1: rest, 2: run }));
    expect(ev.missing).toEqual([{ round: 1, teamIds: ['a1'] }]);
    expect(ev.blockers).toEqual(['Round 1: a1 has no result. Enter a time, DNF or DNS.']);
    expect(ev.seedRank).toBeNull();
    expect(ev.standings).toEqual({ a: [null, null, null], b: [null, null] });
    expect(ev.categoryWinners).toEqual({ a: null, b: null });
    expect(ev.rounds[2]!.status).toBe('blocked');
  });

  it('a seeding result cleared after the grand round opened: the saved race stays, the standings wait', () => {
    const opened = deriveEvent(two, progress(2, { 1: run, 2: run }));
    const lineups = { 3: opened.rounds[2]!.races.map((r) => ({
      id: r.id, label: r.label, role: r.role, teams: r.entrants.map((x) => x.teamId), tables: r.entrants.map((x) => x.table), fallbackOrder: r.fallbackOrder,
    })) };
    const { a2: _cleared, ...rest } = run;
    const ev = deriveEvent(two, { ...progress(2, { 1: rest, 2: run }), lineups });
    expect(ev.rounds[2]!.races[0]!.entrants.map((x) => x.teamId)).toEqual(['a2', 'b1']);
    expect(ev.standings).toEqual({ a: [null, null, null], b: [null, null] });
  });

  it('ranks seeding by the chosen rule over three runs', () => {
    const three = withFormat(makeEvent([['a', 3]], 4, false), { brackets: 'none', seedingRuns: 3, seedingRank: 'dropSlowest' });
    const results = {
      1: { a0: fin(60), a1: fin(60), a2: fin(50) },
      2: { a0: fin(62), a1: fin(61), a2: dnf },
      3: { a0: dnf, a1: fin(90), a2: dnf },
    };
    expect(deriveEvent(three, progress(3, results)).standings).toEqual({ a: ['a1', 'a0', 'a2'] });
    expect(deriveEvent({ ...three, format: { ...three.format, seedingRank: 'best' } }, progress(3, results)).standings).toEqual({ a: ['a2', 'a0', 'a1'] });
    expect(deriveEvent({ ...three, format: { ...three.format, seedingRank: 'total' } }, progress(3, results)).standings).toEqual({ a: ['a1', 'a0', 'a2'] });
  });
});

describe('seeding runs in the placement format', () => {
  it('one run: brackets are seeded from it and the event runs to the standings', () => {
    const input = withFormat(makeEvent([['c', 4]], 4, false), { seedingRuns: 1 });
    const results = {
      1: { c0: fin(100), c1: fin(101), c2: fin(102), c3: fin(103) },
      2: { c0: fin(200), c3: fin(210), c1: fin(200), c2: fin(210) },
      3: { c0: fin(200), c1: fin(190), c3: fin(200), c2: fin(190) },
    };
    const ev = deriveEvent(input, progress(3, results));
    expect(ev.rounds.map((r) => r.spec.kind)).toEqual(['seeding', 'heats', 'placement']);
    expect(ev.rounds[0]!.races[0]!.label).toBe('Group A · Run 1');
    expect(ev.seedRank).toEqual({ c0: 1, c1: 2, c2: 3, c3: 4 });
    expect(ev.standings).toEqual({ c: ['c1', 'c0', 'c2', 'c3'] });
    expect(ev.categoryWinners).toEqual({ c: 'c1' });
  });

  it('three runs: the third run counts and is labelled', () => {
    const input = withFormat(makeEvent([['c', 4]], 4, false), { seedingRuns: 3 });
    const same = { c0: fin(100), c1: fin(100), c2: fin(100), c3: fin(100) };
    const ev = deriveEvent(input, progress(3, { 1: same, 2: same, 3: { c0: fin(104), c1: fin(103), c2: fin(102), c3: fin(101) } }));
    expect(ev.rounds.map((r) => r.spec.kind)).toEqual(['seeding', 'seeding', 'seeding', 'heats', 'placement']);
    expect(ev.rounds[2]!.races[0]!.label).toBe('Group A · Run 3');
    expect(ev.seedRank).toEqual({ c3: 1, c2: 2, c1: 3, c0: 4 });
    expect(ev.rounds[3]!.races.map((r) => r.entrants.map((x) => x.teamId))).toEqual([['c3', 'c0'], ['c2', 'c1']]);
  });
});

describe('an event stored before formats existed (Review Focus 1)', () => {
  const { input, results } = previousEvent();
  it.each([0, 1, 3, 4, 5, 7, 8, 9])('derives identically with no format, an empty one and the defaults spelled out (%i rounds finished)', (finishedRounds) => {
    const p = { finishedRounds, results, tieDecisions: {} };
    const plain = deriveEvent(input, p);
    expect('format' in input).toBe(false);
    expect(deriveEvent({ ...input, format: {} }, p)).toEqual(plain);
    expect(deriveEvent({ ...input, format: { seedingRuns: 2, seedingRank: 'total', brackets: 'placement' } }, p)).toEqual(plain);
    expect(Object.keys(plain.categoryWinners)).toEqual(input.categories.map((c) => c.id));
    expect(buildRoundPlan({ ...input, format: {} })).toEqual(buildRoundPlan(input));
  });

  it('category winners are the top brackets\' winners once decided', () => {
    const ev = deriveEvent(input, { finishedRounds: 9, results, tieDecisions: {} });
    expect(ev.categoryWinners).toEqual(Object.fromEntries(input.categories.map((c) => [c.id, ev.standings[c.id]![0]])));
    expect(Object.values(ev.categoryWinners).every((id) => typeof id === 'string')).toBe(true);
    expect(deriveEvent(input, { finishedRounds: 6, results, tieDecisions: {} }).categoryWinners)
      .toEqual(Object.fromEntries(input.categories.map((c) => [c.id, null])));
  });
});
