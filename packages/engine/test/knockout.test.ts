import { describe, it, expect } from 'vitest';
import type { EntryResult, EventInput, EventProgress, SavedRace, TournamentFormat } from '../src/types';
import { knockoutDraw, knockoutRaceName, knockoutRaces, knockoutStages, seedSlots, stageName } from '../src/knockout';
import { buildRoundPlan } from '../src/schedule';
import { deriveEvent, type DerivedEvent, type RaceView } from '../src/event';
import { suggestBracketPlan, validateBracketPlan } from '../src/brackets';
import { fin, dns, makeEvent, previousEvent } from './helpers/events';

const dnf: EntryResult = { status: 'dnf', rawMs: null, penaltiesMs: 0 };

/** A knockout event: categories as [id, teamCount], brackets as Suggest builds them for knockout. */
function ko(cats: [string, number][], tableCount: number, grandChampionship = false, format: TournamentFormat = {}): EventInput {
  const base = makeEvent(cats, tableCount, grandChampionship);
  return {
    ...base,
    format: { brackets: 'knockout', ...format },
    brackets: suggestBracketPlan(base.categories, base.teams, undefined, 'knockout'),
  };
}

/** One category 'a' of n teams in a single knockout bracket (Suggest would split 12 and more). */
function one(n: number, tableCount: number): EventInput {
  const input = ko([['a', n]], tableCount);
  return { ...input, brackets: [{ id: 'a:0', categoryId: 'a', tierIndex: 0, tierName: 'Gold', firstSeed: 1, size: n }] };
}

const toSaved = (races: RaceView[]): SavedRace[] => races.map((r) => ({
  id: r.id, label: r.label, ...(r.bracketId ? { bracketId: r.bracketId } : {}), role: r.role,
  teams: r.entrants.map((x) => x.teamId), tables: r.entrants.map((x) => x.table), fallbackOrder: r.fallbackOrder,
}));

type Result = (teamId: string, race: RaceView) => EntryResult;
/** Every team runs 100 s plus its number (and half a second per category after the first): the better seed always wins. */
const bySeed: Result = (teamId) => fin(100 + Number(teamId.slice(1)) + (teamId.charCodeAt(0) - 97) * 0.5);

/**
 * Races round after round like the server does: the next round's races are saved as its line-up (and the bracket
 * members with the first bracket round), every entrant gets `result`, the round is finished. Stops at the first
 * round that is not ready, or after `upTo`.
 */
function play(input: EventInput, result: Result = bySeed, upTo = Infinity, from?: EventProgress): { progress: EventProgress; ev: DerivedEvent } {
  let progress: EventProgress = from ?? { finishedRounds: 0, results: {}, tieDecisions: {}, lineups: {} };
  for (;;) {
    const ev = deriveEvent(input, progress);
    const next = ev.rounds[progress.finishedRounds];
    if (!next || next.status !== 'ready' || next.spec.round > upTo) return { progress, ev };
    const round = next.spec.round;
    progress = {
      ...progress,
      finishedRounds: round,
      results: { ...progress.results, [round]: Object.fromEntries(next.races.flatMap((r) => r.entrants.map((x) => [x.teamId, result(x.teamId, r)]))) },
      lineups: { ...progress.lineups, [round]: toSaved(next.races) },
      ...(next.spec.kind !== 'seeding' && !progress.bracketMembers && ev.bracketMembers ? { bracketMembers: ev.bracketMembers } : {}),
    };
  }
}

/** The knockout rounds as [stage, [race id without the round, label after the bracket, role, entrants]]. */
const shape = (ev: DerivedEvent) => ev.rounds.flatMap((r) => (r.spec.kind === 'knockout' ? [[
  r.spec.stage,
  r.races.map((race) => [race.id.replace(/^r\d+:/, ''), race.label.replace(/^A Gold · /, ''), race.role, race.entrants.map((x) => x.teamId).join(' v ')]),
]] : []));

describe('knockout arithmetic', () => {
  it('seedSlots: 1 meets the lowest seed, and 1 and 2 are in opposite halves', () => {
    expect(seedSlots(2)).toEqual([1, 2]);
    expect(seedSlots(4)).toEqual([1, 4, 2, 3]);
    expect(seedSlots(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
    expect(seedSlots(16)).toEqual([1, 16, 8, 9, 4, 13, 5, 12, 2, 15, 7, 10, 3, 14, 6, 11]);
  });

  it('knockoutStages for 2–17', () => {
    expect(Array.from({ length: 16 }, (_, i) => knockoutStages(i + 2)))
      .toEqual([1, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 5]);
    expect([knockoutStages(0), knockoutStages(1)]).toEqual([0, 0]);
  });

  it('stage and race names', () => {
    expect([stageName(1, 4), stageName(2, 3), stageName(3, 2), stageName(4, 1)]).toEqual(['Final', 'Semi-final', 'Quarter-final', 'Round of 16']);
    expect([stageName(5, 1), stageName(6, 1), stageName(5, 2)]).toEqual(['Round 1', 'Round 1', 'Round 2']);
    expect(knockoutRaceName(2, 2, 1, 2)).toBe('Semi-final 1');
    expect(knockoutRaceName(3, 1, 3, 4)).toBe('Quarter-final 3');
    expect(knockoutRaceName(4, 1, 5, 8)).toBe('Round of 16 · 5');
    expect(knockoutRaceName(5, 1, 5, 16)).toBe('Round 1 · 5');
    // A stage with one race has no number.
    expect([knockoutRaceName(2, 1, 1, 1), knockoutRaceName(3, 1, 1, 1), knockoutRaceName(4, 1, 1, 1), knockoutRaceName(5, 1, 1, 1)])
      .toEqual(['Semi-final', 'Quarter-final', 'Round of 16', 'Round 1']);
  });

  it.each([2, 3, 4, 5, 6, 7, 8, 9, 12, 13, 16, 17, 20])('the draw of %i teams: byes go to the top seeds, in the first stage only', (n) => {
    const draw = knockoutDraw(n);
    const stages = knockoutStages(n);
    expect(draw.map((s) => s[0]!.stage)).toEqual(Array.from({ length: stages }, (_, i) => stages - i));
    expect(draw.map((s) => s.length)).toEqual(Array.from({ length: stages }, (_, i) => 2 ** (stages - 1 - i)));
    const first = draw[0]!;
    // Every seed is placed exactly once.
    expect(first.flatMap((m) => m.seeds ?? []).filter((s) => s !== null).sort((a, b) => a! - b!)).toEqual(Array.from({ length: n }, (_, i) => i + 1));
    const byes = first.filter((m) => m.index === null).map((m) => m.seeds!.find((s) => s !== null)).sort((a, b) => a! - b!);
    expect(byes).toEqual(Array.from({ length: 2 ** stages - n }, (_, i) => i + 1));
    // The races of a stage are numbered 1… from the top; later stages have no bye and no seeds of their own.
    expect(first.flatMap((m) => (m.index === null ? [] : [m.index]))).toEqual(Array.from({ length: n - 2 ** (stages - 1) }, (_, i) => i + 1));
    for (const stage of draw.slice(1)) {
      expect(stage.map((m) => [m.position, m.index, m.seeds])).toEqual(stage.map((_, i) => [i + 1, i + 1, null]));
    }
    // Races per stage, with the third-place race counted in the final stage.
    const races = (stage: number) => draw[stages - stage]!.filter((m) => m.index !== null).length + (stage === 1 && n >= 4 ? 1 : 0);
    expect(Array.from({ length: stages + 2 }, (_, s) => knockoutRaces(n, s))).toEqual([0, ...Array.from({ length: stages }, (_, i) => races(i + 1)), 0]);
  });

  it('a bracket of one or none has no draw', () => {
    expect([knockoutDraw(0), knockoutDraw(1)]).toEqual([[], []]);
    expect([knockoutRaces(1, 1), knockoutRaces(0, 1)]).toEqual([0, 0]);
  });
});

describe('knockout walk-throughs, seed order holding (Review Focus 5)', () => {
  // One category 'a' on 12 tables, one seeding group: rounds 1–2 seeding, then the knockout rounds.
  const cases: [number, unknown[]][] = [
    [2, [
      [1, [['a:0:final', 'Final', 'final', 'a0 v a1']]],
    ]],
    [3, [
      [2, [['a:0:ko2-1', 'Semi-final', 'ko', 'a1 v a2']]],
      [1, [['a:0:final', 'Final', 'final', 'a0 v a1']]],
    ]],
    [4, [
      [2, [['a:0:ko2-1', 'Semi-final 1', 'ko', 'a0 v a3'], ['a:0:ko2-2', 'Semi-final 2', 'ko', 'a1 v a2']]],
      [1, [['a:0:final', 'Final', 'final', 'a0 v a1'], ['a:0:third', 'Third place', 'third', 'a3 v a2']]],
    ]],
    [5, [
      [3, [['a:0:ko3-1', 'Quarter-final', 'ko', 'a3 v a4']]],
      [2, [['a:0:ko2-1', 'Semi-final 1', 'ko', 'a0 v a3'], ['a:0:ko2-2', 'Semi-final 2', 'ko', 'a1 v a2']]],
      [1, [['a:0:final', 'Final', 'final', 'a0 v a1'], ['a:0:third', 'Third place', 'third', 'a3 v a2']]],
    ]],
    [6, [
      [3, [['a:0:ko3-1', 'Quarter-final 1', 'ko', 'a3 v a4'], ['a:0:ko3-2', 'Quarter-final 2', 'ko', 'a2 v a5']]],
      [2, [['a:0:ko2-1', 'Semi-final 1', 'ko', 'a0 v a3'], ['a:0:ko2-2', 'Semi-final 2', 'ko', 'a1 v a2']]],
      [1, [['a:0:final', 'Final', 'final', 'a0 v a1'], ['a:0:third', 'Third place', 'third', 'a3 v a2']]],
    ]],
    [7, [
      [3, [['a:0:ko3-1', 'Quarter-final 1', 'ko', 'a3 v a4'], ['a:0:ko3-2', 'Quarter-final 2', 'ko', 'a1 v a6'], ['a:0:ko3-3', 'Quarter-final 3', 'ko', 'a2 v a5']]],
      [2, [['a:0:ko2-1', 'Semi-final 1', 'ko', 'a0 v a3'], ['a:0:ko2-2', 'Semi-final 2', 'ko', 'a1 v a2']]],
      [1, [['a:0:final', 'Final', 'final', 'a0 v a1'], ['a:0:third', 'Third place', 'third', 'a3 v a2']]],
    ]],
    [8, [
      [3, [
        ['a:0:ko3-1', 'Quarter-final 1', 'ko', 'a0 v a7'], ['a:0:ko3-2', 'Quarter-final 2', 'ko', 'a3 v a4'],
        ['a:0:ko3-3', 'Quarter-final 3', 'ko', 'a1 v a6'], ['a:0:ko3-4', 'Quarter-final 4', 'ko', 'a2 v a5'],
      ]],
      [2, [['a:0:ko2-1', 'Semi-final 1', 'ko', 'a0 v a3'], ['a:0:ko2-2', 'Semi-final 2', 'ko', 'a1 v a2']]],
      [1, [['a:0:final', 'Final', 'final', 'a0 v a1'], ['a:0:third', 'Third place', 'third', 'a3 v a2']]],
    ]],
    [9, [
      [4, [['a:0:ko4-1', 'Round of 16', 'ko', 'a7 v a8']]],
      [3, [
        ['a:0:ko3-1', 'Quarter-final 1', 'ko', 'a0 v a7'], ['a:0:ko3-2', 'Quarter-final 2', 'ko', 'a3 v a4'],
        ['a:0:ko3-3', 'Quarter-final 3', 'ko', 'a1 v a6'], ['a:0:ko3-4', 'Quarter-final 4', 'ko', 'a2 v a5'],
      ]],
      [2, [['a:0:ko2-1', 'Semi-final 1', 'ko', 'a0 v a3'], ['a:0:ko2-2', 'Semi-final 2', 'ko', 'a1 v a2']]],
      [1, [['a:0:final', 'Final', 'final', 'a0 v a1'], ['a:0:third', 'Third place', 'third', 'a3 v a2']]],
    ]],
    [12, [
      [4, [
        ['a:0:ko4-1', 'Round of 16 · 1', 'ko', 'a7 v a8'], ['a:0:ko4-2', 'Round of 16 · 2', 'ko', 'a4 v a11'],
        ['a:0:ko4-3', 'Round of 16 · 3', 'ko', 'a6 v a9'], ['a:0:ko4-4', 'Round of 16 · 4', 'ko', 'a5 v a10'],
      ]],
      [3, [
        ['a:0:ko3-1', 'Quarter-final 1', 'ko', 'a0 v a7'], ['a:0:ko3-2', 'Quarter-final 2', 'ko', 'a3 v a4'],
        ['a:0:ko3-3', 'Quarter-final 3', 'ko', 'a1 v a6'], ['a:0:ko3-4', 'Quarter-final 4', 'ko', 'a2 v a5'],
      ]],
      [2, [['a:0:ko2-1', 'Semi-final 1', 'ko', 'a0 v a3'], ['a:0:ko2-2', 'Semi-final 2', 'ko', 'a1 v a2']]],
      [1, [['a:0:final', 'Final', 'final', 'a0 v a1'], ['a:0:third', 'Third place', 'third', 'a3 v a2']]],
    ]],
  ];

  it.each(cases)('%i teams', (n, expected) => {
    const input = one(n, 12);
    expect(validateBracketPlan(input)).toEqual([]);
    const stages = (expected as [number, unknown][]).map(([stage]) => stage);
    expect(buildRoundPlan(input).map((r) => (r.kind === 'knockout' ? [r.round, r.stage, r.bracketIds] : r.kind)))
      .toEqual(['seeding', 'seeding', ...stages.map((stage, i) => [3 + i, stage, ['a:0']])]);

    const { ev, progress } = play(input);
    expect(shape(ev)).toEqual(expected);
    expect(ev.rounds.every((r) => r.status === 'locked' && r.races.length > 0)).toBe(true);
    expect(progress.finishedRounds).toBe(2 + stages.length);
    expect(ev.blockers).toEqual([]);
    expect(ev.missing).toEqual([]);

    // Every race: two teams, a bracket, tables from 1 in order, and the entrants in seed order as the fallback.
    for (const round of ev.rounds.slice(2)) {
      expect(round.races.flatMap((r) => r.entrants.map((x) => x.table))).toEqual(round.races.flatMap((r) => r.entrants).map((_, i) => i + 1));
      for (const race of round.races) {
        expect(race.id.startsWith(`r${round.spec.round}:`)).toBe(true);
        expect(race.label.startsWith('A Gold · ')).toBe(true);
        expect(race.bracketId).toBe('a:0');
        expect(race.entrants.length).toBe(2);
        expect(race.fallbackOrder).toEqual(race.entrants.map((x) => x.teamId).sort((x, y) => Number(x.slice(1)) - Number(y.slice(1))));
      }
    }
    // With seed order holding in every race the final is 1 v 2 and the final order is the seed order.
    const all = Array.from({ length: n }, (_, i) => `a${i}`);
    expect(ev.standings).toEqual({ a: all });
    expect(ev.categoryWinners).toEqual({ a: 'a0' });
    expect(ev.bracketMembers).toEqual({ 'a:0': all });
    // A third-place race for four teams or more only.
    expect(ev.rounds.flatMap((r) => r.races).filter((r) => r.role === 'third').length).toBe(n >= 4 ? 1 : 0);
    // Nothing saved gives the same event.
    expect(deriveEvent(input, { finishedRounds: progress.finishedRounds, results: progress.results, tieDecisions: {} })).toEqual(ev);
  });

  it.each([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 16, 17])('%i teams with upsets everywhere: every team is placed exactly once', (n) => {
    const input = one(n, 20);
    // The worse seed wins every race; some losers do not finish.
    const upset: Result = (teamId, race) => {
      if (race.role === 'seed') return bySeed(teamId, race);
      const i = Number(teamId.slice(1));
      const worst = Math.max(...race.entrants.map((x) => Number(x.teamId.slice(1))));
      return i === worst ? fin(100 - i) : i % 3 === 0 ? dnf : fin(300 + i);
    };
    const { ev, progress } = play(input, upset);
    expect(progress.finishedRounds).toBe(2 + knockoutStages(n));
    expect(ev.blockers).toEqual([]);
    const places = ev.standings.a!;
    expect([...places].sort()).toEqual(input.teams.map((t) => t.id).sort());
    const final = ev.rounds.at(-1)!.races.find((r) => r.role === 'final')!;
    expect(places.slice(0, 2)).toEqual(final.ranking.order);
    const third = ev.rounds.at(-1)!.races.find((r) => r.role === 'third');
    expect(Boolean(third)).toBe(n >= 4);
    if (third) expect(places.slice(2, 4)).toEqual(third.ranking.order);
    // Each stage's entrants are the teams that did not lose before it.
    const raced = new Map<string, number>();
    for (const r of ev.rounds.slice(2)) for (const race of r.races) for (const x of race.entrants) raced.set(x.teamId, (raced.get(x.teamId) ?? 0) + 1);
    expect([...raced.keys()].sort()).toEqual(input.teams.map((t) => t.id).sort());
  });

  it('a 3-team bracket: the top seed has a bye, no third-place race, the semi-final loser is third', () => {
    const input = ko([['a', 3]], 4);
    const mid = play(input, bySeed, 2).ev;
    // The bye team has no race in the semi-final round and is not waited for.
    expect(mid.rounds[2]!.races.flatMap((r) => r.entrants.map((x) => x.teamId))).toEqual(['a1', 'a2']);
    const semi = play(input, (id, race) => (race.role === 'ko' && id === 'a1' ? fin(500) : bySeed(id, race)), 3);
    expect(semi.ev.missing).toEqual([]);
    expect(semi.ev.rounds[3]!.status).toBe('ready');
    expect(semi.ev.rounds[3]!.races.map((r) => [r.id, r.entrants.map((x) => x.teamId)])).toEqual([['r4:a:0:final', ['a0', 'a2']]]);
    expect(semi.ev.standings).toEqual({ a: [null, null, null] });
    const done = play(input, (id, race) => (race.role === 'final' && id === 'a0' ? fin(500) : bySeed(id, race)), Infinity, semi.progress).ev;
    expect(done.standings).toEqual({ a: ['a2', 'a0', 'a1'] });
  });
});

describe('knockout placings', () => {
  it('teams knocked out before the semi-finals are placed by their time in that round, DNF then DNS last, equal times by seed', () => {
    const input = ko([['a', 8]], 8);
    // Quarter-finals (round 3): a0 v a7, a3 v a4, a1 v a6, a2 v a5. The better seed wins each.
    const quarter: Record<string, EntryResult> = { a7: fin(150), a4: dnf, a6: fin(140), a5: dns };
    const { ev } = play(input, (id, race) => (race.round === 3 && quarter[id] ? quarter[id]! : bySeed(id, race)));
    expect(ev.standings.a).toEqual(['a0', 'a1', 'a2', 'a3', 'a6', 'a7', 'a4', 'a5']);

    // Equal at the hundredth in different races: seed order, and nobody has to decide anything.
    const equal: Record<string, EntryResult> = { a7: fin(150.001), a4: fin(150.009), a6: fin(150.004), a5: fin(149) };
    const tied = play(input, (id, race) => (race.round === 3 && equal[id] ? equal[id]! : bySeed(id, race))).ev;
    expect(tied.blockers).toEqual([]);
    expect(tied.standings.a).toEqual(['a0', 'a1', 'a2', 'a3', 'a5', 'a4', 'a6', 'a7']);
  });

  it('12 teams: the first stage\'s losers are 9th–12th, the quarter-final losers 5th–8th, each by time in its own round', () => {
    const input = one(12, 12);
    // Round 3 (round of 16): a7 v a8, a4 v a11, a6 v a9, a5 v a10. Round 4 (quarter-finals): a0 v a7, a3 v a4, a1 v a6, a2 v a5.
    const times: Record<number, Record<string, EntryResult>> = {
      3: { a8: fin(130), a11: fin(110), a9: dnf, a10: fin(120) },
      4: { a7: fin(105), a4: fin(140), a6: fin(102), a5: fin(103) },
    };
    const { ev } = play(input, (id, race) => times[race.round]?.[id] ?? (race.role === 'seed' ? bySeed(id, race) : fin(90 + Number(id.slice(1)))));
    expect(ev.standings.a).toEqual(['a0', 'a1', 'a2', 'a3', 'a6', 'a5', 'a7', 'a4', 'a11', 'a10', 'a8', 'a9']);
  });

  it('a team that does not finish an early round is out, and the other goes through', () => {
    const input = ko([['a', 6]], 6);
    // Round 3: a3 v a4 and a2 v a5. a3 does not finish; a2 does not start.
    const early: Record<string, EntryResult> = { a3: dnf, a2: dns };
    const { ev } = play(input, (id, race) => (race.round === 3 && early[id] ? early[id]! : bySeed(id, race)));
    expect(ev.rounds[3]!.races.map((r) => r.entrants.map((x) => x.teamId))).toEqual([['a0', 'a4'], ['a1', 'a5']]);
    expect(ev.rounds[4]!.races.map((r) => [r.role, r.entrants.map((x) => x.teamId)])).toEqual([['final', ['a0', 'a1']], ['third', ['a4', 'a5']]]);
    expect(ev.standings.a).toEqual(['a0', 'a1', 'a4', 'a5', 'a3', 'a2']);
  });

  it('the third-place race decides third and fourth, whatever the semi-final times were', () => {
    const input = ko([['a', 4]], 4);
    const { ev } = play(input, (id, race) => {
      if (race.role === 'ko') return fin({ a0: 100, a3: 101, a1: 100, a2: 200 }[id]!);
      if (race.role === 'third') return fin({ a3: 160, a2: 150 }[id]!);
      if (race.role === 'final') return fin({ a0: 130, a1: 120 }[id]!);
      return bySeed(id, race);
    });
    expect(ev.standings.a).toEqual(['a1', 'a0', 'a2', 'a3']);
    expect(ev.categoryWinners).toEqual({ a: 'a1' });
  });

  it('places stay undecided until the final and the third-place race are finished', () => {
    const input = ko([['a', 6]], 6);
    for (const upTo of [2, 3, 4]) expect(play(input, bySeed, upTo).ev.standings.a).toEqual([null, null, null, null, null, null]);
    // A tie in the third-place race leaves the whole bracket undecided.
    const tie = play(input, (id, race) => (race.role === 'third' ? fin(150) : bySeed(id, race))).ev;
    expect(tie.blockers).toEqual(['Round 5: tie in r5:a:0:third']);
    expect(tie.standings.a).toEqual([null, null, null, null, null, null]);
    expect(tie.categoryWinners).toEqual({ a: null });
  });
});

describe('knockout ties and missing results', () => {
  const input = ko([['a', 8]], 8);
  // Round 3 quarter-finals: a0 v a7 finish in the same hundredth.
  const tied: Result = (id, race) => (race.round === 3 && (id === 'a0' || id === 'a7') ? fin(id === 'a0' ? 120.001 : 120.009) : bySeed(id, race));

  it('a tie in a quarter-final blocks the semi-final round until race control decides it', () => {
    const { ev, progress } = play(input, tied);
    expect(progress.finishedRounds).toBe(3);
    expect(ev.blockers).toEqual(['Round 3: tie in r3:a:0:ko3-1']);
    expect(ev.rounds[3]).toMatchObject({ status: 'blocked', races: [] });
    expect(ev.rounds[4]).toMatchObject({ status: 'blocked', races: [] });

    const decided = { ...progress, tieDecisions: { 'r3:a:0:ko3-1': ['a7', 'a0'] } };
    const next = deriveEvent(input, decided);
    expect(next.blockers).toEqual([]);
    expect(next.rounds[3]!.status).toBe('ready');
    expect(next.rounds[3]!.races.map((r) => r.entrants.map((x) => x.teamId))).toEqual([['a7', 'a3'], ['a1', 'a2']]);
    // a0 lost the quarter-final by decision and is placed with the other quarter-final losers, by time.
    const done = play(input, bySeed, Infinity, decided).ev;
    expect(done.standings.a).toEqual(['a1', 'a3', 'a2', 'a7', 'a4', 'a5', 'a6', 'a0']);
  });

  it('a cleared result in a quarter-final blocks the semi-final round, and names only teams that raced', () => {
    const { progress } = play(input, bySeed, 3);
    const { a4: _cleared, ...rest } = progress.results[3]!;
    const ev = deriveEvent(input, { ...progress, results: { ...progress.results, 3: rest } });
    expect(ev.missing).toEqual([{ round: 3, teamIds: ['a4'] }]);
    expect(ev.blockers).toEqual(['Round 3: a4 has no result. Enter a time, DNF or DNS.']);
    expect(ev.rounds[3]!.status).toBe('blocked');
  });

  it('a team with a bye is never waited for', () => {
    const nine = ko([['a', 9]], 10);
    const { ev, progress } = play(nine, bySeed, 3);
    expect(ev.rounds[2]!.races.flatMap((r) => r.entrants.map((x) => x.teamId))).toEqual(['a7', 'a8']);
    expect(Object.keys(progress.results[3]!)).toEqual(['a7', 'a8']);
    expect(ev.missing).toEqual([]);
    expect(ev.rounds[3]!.status).toBe('ready');
  });
});

describe('knockout rounds', () => {
  it('brackets of 8 and 4 share rounds, and both finals are in the last knockout round', () => {
    const input = ko([['a', 8], ['b', 4]], 12, true);
    expect(buildRoundPlan(input)).toEqual([
      { round: 1, kind: 'seeding', groupId: 'A', run: 1 },
      { round: 2, kind: 'seeding', groupId: 'A', run: 2 },
      { round: 3, kind: 'knockout', stage: 3, bracketIds: ['a:0'] },
      { round: 4, kind: 'knockout', stage: 2, bracketIds: ['a:0', 'b:0'] },
      { round: 5, kind: 'knockout', stage: 1, bracketIds: ['a:0', 'b:0'] },
      { round: 6, kind: 'grand' },
    ]);
    const { ev } = play(input);
    expect(ev.rounds[2]!.races.map((r) => r.bracketId)).toEqual(['a:0', 'a:0', 'a:0', 'a:0']);
    expect(ev.rounds[3]!.races.map((r) => [r.id, r.label])).toEqual([
      ['r4:a:0:ko2-1', 'A Gold · Semi-final 1'], ['r4:a:0:ko2-2', 'A Gold · Semi-final 2'],
      ['r4:b:0:ko2-1', 'B Gold · Semi-final 1'], ['r4:b:0:ko2-2', 'B Gold · Semi-final 2'],
    ]);
    expect(ev.rounds[4]!.races.map((r) => [r.id, r.label])).toEqual([
      ['r5:a:0:final', 'A Gold · Final'], ['r5:a:0:third', 'A Gold · Third place'],
      ['r5:b:0:final', 'B Gold · Final'], ['r5:b:0:third', 'B Gold · Third place'],
    ]);
    expect(ev.rounds[4]!.races.flatMap((r) => r.entrants.map((x) => x.table))).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(ev.standings).toEqual({ a: ['a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7'], b: ['b0', 'b1', 'b2', 'b3'] });
  });

  it('the Grand Championship takes each top bracket\'s knockout winner', () => {
    const input = ko([['a', 8], ['b', 4]], 12, true);
    const { ev } = play(input, (id, race) => (race.role === 'final' && race.bracketId === 'a:0' && id === 'a0' ? fin(900) : bySeed(id, race)));
    expect(ev.categoryWinners).toEqual({ a: 'a1', b: 'b0' });
    const grand = ev.rounds[5]!.races[0]!;
    expect([grand.id, grand.role, grand.entrants.map((x) => x.teamId)]).toEqual(['r6:grand', 'grand', ['a1', 'b0']]);
    expect(ev.grandChampion).toBe('b0');
  });

  it('a category of 16 is two brackets of 8 that race stage by stage, the top bracket first', () => {
    const input = ko([['a', 16]], 16);
    expect(input.brackets.map((b) => [b.id, b.tierName, b.firstSeed, b.size])).toEqual([['a:0', 'Gold', 1, 8], ['a:1', 'Silver', 9, 8]]);
    expect(buildRoundPlan(input).slice(2)).toEqual([
      { round: 3, kind: 'knockout', stage: 3, bracketIds: ['a:0', 'a:1'] },
      { round: 4, kind: 'knockout', stage: 2, bracketIds: ['a:0', 'a:1'] },
      { round: 5, kind: 'knockout', stage: 1, bracketIds: ['a:0', 'a:1'] },
    ]);
    const { ev } = play(input);
    expect(ev.rounds[2]!.races[4]!.entrants.map((x) => x.teamId)).toEqual(['a8', 'a15']);
    expect(ev.standings.a).toEqual(Array.from({ length: 16 }, (_, i) => `a${i}`));
  });

  it('a stage that does not fit the tables is split into rounds, whole brackets together', () => {
    // Two categories of 8 on 8 tables: two seeding groups, so rounds 1–4 are seeding.
    const input = ko([['a', 8], ['b', 8]], 8);
    expect(buildRoundPlan(input).slice(4)).toEqual([
      { round: 5, kind: 'knockout', stage: 3, bracketIds: ['a:0'] },
      { round: 6, kind: 'knockout', stage: 3, bracketIds: ['b:0'] },
      { round: 7, kind: 'knockout', stage: 2, bracketIds: ['a:0', 'b:0'] },
      { round: 8, kind: 'knockout', stage: 1, bracketIds: ['a:0', 'b:0'] },
    ]);
    // The final stage counts the final and the third-place race: four teams a bracket.
    const three = ko([['a', 4], ['b', 4], ['c', 4]], 8);
    expect(buildRoundPlan(three).slice(4)).toEqual([
      { round: 5, kind: 'knockout', stage: 2, bracketIds: ['a:0', 'b:0'] },
      { round: 6, kind: 'knockout', stage: 2, bracketIds: ['c:0'] },
      { round: 7, kind: 'knockout', stage: 1, bracketIds: ['a:0', 'b:0'] },
      { round: 8, kind: 'knockout', stage: 1, bracketIds: ['c:0'] },
    ]);
    // Chunks count the teams racing in the stage, not the bracket sizes: a bracket of 3 races two teams in each
    // stage, a bracket of 2 only in the last, and a bracket of 5 races two, then four, then four.
    const small = ko([['a', 3], ['b', 3], ['c', 2], ['d', 5]], 8);
    expect(buildRoundPlan(small).slice(4)).toEqual([
      { round: 5, kind: 'knockout', stage: 3, bracketIds: ['d:0'] },
      { round: 6, kind: 'knockout', stage: 2, bracketIds: ['a:0', 'b:0', 'd:0'] },
      { round: 7, kind: 'knockout', stage: 1, bracketIds: ['a:0', 'b:0', 'c:0'] },
      { round: 8, kind: 'knockout', stage: 1, bracketIds: ['d:0'] },
    ]);
    const { ev } = play(small);
    expect(ev.rounds.every((r) => r.status === 'locked' && r.races.length > 0)).toBe(true);
    expect(ev.rounds[6]!.races.map((r) => r.id)).toEqual(['r7:a:0:final', 'r7:b:0:final', 'r7:c:0:final']);
    expect(ev.rounds[7]!.races.map((r) => r.id)).toEqual(['r8:d:0:final', 'r8:d:0:third']);
    expect(ev.standings).toEqual({ a: ['a0', 'a1', 'a2'], b: ['b0', 'b1', 'b2'], c: ['c0', 'c1'], d: ['d0', 'd1', 'd2', 'd3', 'd4'] });
  });

  it('seeding runs and the rank rule apply to a knockout event', () => {
    const input = ko([['a', 4]], 4, false, { seedingRuns: 1 });
    expect(buildRoundPlan(input).map((r) => r.kind)).toEqual(['seeding', 'knockout', 'knockout']);
    const { ev } = play(input, (id, race) => (race.role === 'seed' ? fin(200 - Number(id.slice(1))) : bySeed(id, race)));
    expect(ev.bracketMembers).toEqual({ 'a:0': ['a3', 'a2', 'a1', 'a0'] });
    expect(ev.rounds[1]!.races.map((r) => r.entrants.map((x) => x.teamId))).toEqual([['a3', 'a0'], ['a2', 'a1']]);
  });
});

describe('knockout with saved line-ups', () => {
  const input = ko([['a', 8]], 8);

  it('a late correction to a quarter-final leaves the played semi-final as it was', () => {
    // Rounds 3 (quarter-finals) and 4 (semi-finals) are raced: a0 beat a7 and then raced a3.
    const { progress, ev: before } = play(input, bySeed, 4);
    expect(before.rounds[3]!.races.map((r) => r.entrants.map((x) => x.teamId))).toEqual([['a0', 'a3'], ['a1', 'a2']]);
    // The correction: a7 now has the better quarter-final time.
    const corrected: EventProgress = { ...progress, results: { ...progress.results, 3: { ...progress.results[3]!, a7: fin(50) } } };
    const ev = deriveEvent(input, corrected);
    expect(ev.rounds[2]!.races[0]!.ranking.order).toEqual(['a7', 'a0']);
    expect(ev.rounds[3]!.races).toEqual(before.rounds[3]!.races);
    expect(ev.blockers).toEqual([]);
    // The final is built from the semi-finals that were raced.
    expect(ev.rounds[4]!.status).toBe('ready');
    expect(ev.rounds[4]!.races.map((r) => r.entrants.map((x) => x.teamId))).toEqual([['a0', 'a1'], ['a3', 'a2']]);
    // Placed once each: a0 went on, so a7 is placed with the teams that did not reach the semi-finals.
    const done = play(input, bySeed, Infinity, corrected).ev;
    expect(done.standings.a).toEqual(['a0', 'a1', 'a2', 'a3', 'a7', 'a4', 'a5', 'a6']);
    // Without the saved line-ups the same results would rebuild the semi-final with a7.
    const rebuilt = deriveEvent(input, { finishedRounds: 3, results: corrected.results, tieDecisions: {} });
    expect(rebuilt.rounds[3]!.races[0]!.entrants.map((x) => x.teamId)).toEqual(['a7', 'a3']);
  });

  it('a seeding correction after the first knockout round opened keeps the bracket members and the draw', () => {
    const { progress } = play(input, bySeed, 3);
    const corrected: EventProgress = { ...progress, results: { ...progress.results, 1: { ...progress.results[1]!, a7: fin(1) } } };
    const ev = deriveEvent(input, corrected);
    expect(ev.seedRank!.a7).toBe(1);
    expect(ev.bracketMembers).toEqual(progress.bracketMembers);
    expect(ev.rounds[3]!.races.map((r) => r.entrants.map((x) => x.teamId))).toEqual([['a0', 'a3'], ['a1', 'a2']]);
  });

  it('a tie that appears in a quarter-final after the semi-final was opened keeps the semi-final and blocks the final', () => {
    const { progress } = play(input, bySeed, 4);
    const tied: EventProgress = { ...progress, results: { ...progress.results, 3: { ...progress.results[3]!, a7: progress.results[3]!.a0! } } };
    const ev = deriveEvent(input, tied);
    expect(ev.blockers).toEqual(['Round 3: tie in r3:a:0:ko3-1']);
    expect(ev.rounds[3]!.races.map((r) => r.entrants.map((x) => x.teamId))).toEqual([['a0', 'a3'], ['a1', 'a2']]);
    expect(ev.rounds[4]).toMatchObject({ status: 'blocked', races: [] });
  });
});

describe('knockout brackets: suggestion and validation', () => {
  const cat = { id: 'c', name: 'Cat' };
  const teamsOf = (n: number, categoryId = 'c') =>
    Array.from({ length: n }, (_, i) => ({ id: `${categoryId}${i}`, name: `T${i}`, categoryId, order: i }));
  const sizes = (n: number) => suggestBracketPlan([cat], teamsOf(n), undefined, 'knockout').map((b) => b.size);
  const input = (n: number, bracketSizes: number[], tableCount = 26, brackets: TournamentFormat['brackets'] = 'knockout'): EventInput => {
    let firstSeed = 1;
    return {
      tableCount, categories: [cat], teams: teamsOf(n), groups: [], tableOf: {}, grandChampionship: false, format: { brackets },
      brackets: bracketSizes.map((size, tierIndex) => {
        const spec = { id: `c:${tierIndex}`, categoryId: 'c', tierIndex, tierName: ['Gold', 'Silver', 'Bronze'][tierIndex] ?? 'x', firstSeed, size };
        firstSeed += size;
        return spec;
      }),
    };
  };

  it('suggests brackets of 8 by seed, folding a remainder under 4 into the last', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(sizes)).toEqual([[1], [2], [3], [4], [5], [6], [7]]);
    expect([8, 9, 10, 11, 12, 13, 15, 16, 19, 20, 24, 27].map(sizes))
      .toEqual([[8], [9], [10], [11], [8, 4], [8, 5], [8, 7], [8, 8], [8, 11], [8, 8, 4], [8, 8, 8], [8, 8, 11]]);
    expect(sizes(0)).toEqual([]);
    expect(suggestBracketPlan([cat], teamsOf(20), undefined, 'knockout').map((b) => [b.id, b.tierName, b.tierIndex, b.firstSeed, b.size])).toEqual([
      ['c:0', 'Gold', 0, 1, 8], ['c:1', 'Silver', 1, 9, 8], ['c:2', 'Bronze', 2, 17, 4],
    ]);
    // The other formats are suggested as before.
    expect(suggestBracketPlan([cat], teamsOf(12)).map((b) => b.size)).toEqual([4, 4, 4]);
    expect(suggestBracketPlan([cat], teamsOf(12), undefined, 'finals').map((b) => b.size)).toEqual([4, 4, 4]);
  });

  it('accepts any size from 2 up to the number of tables', () => {
    for (const n of [2, 3, 4, 5, 8, 9, 12, 16]) expect(validateBracketPlan(input(n, [n], 16))).toEqual([]);
    expect(validateBracketPlan(input(11, [8, 3]))).toEqual([]);
    expect(validateBracketPlan(input(4, [2, 2]))).toEqual([]);
    expect(validateBracketPlan(input(12, [12], 8))).toEqual(['Cat Gold: larger than the 8 tables']);
    expect(validateBracketPlan(input(9, [8, 1]))).toEqual(['Cat Silver: size must be 2 or more']);
    // The other checks stay.
    expect(validateBracketPlan(input(9, [8]))).toEqual(['Cat: brackets hold 8 teams but the category has 9']);
    expect(validateBracketPlan({ ...input(8, [4, 4]), brackets: input(8, [4, 4]).brackets.map((b) => (b.tierIndex ? { ...b, firstSeed: 6 } : b)) }))
      .toEqual(['Cat Silver: seeds must start at 5']);
  });

  it('a category with one team is a bracket of one', () => {
    expect(validateBracketPlan(input(1, [1]))).toEqual([]);
  });

  it('what Suggest builds is valid for every count, given the tables', () => {
    for (let n = 1; n <= 40; n++) {
      const plan = suggestBracketPlan([cat], teamsOf(n), undefined, 'knockout');
      expect(validateBracketPlan({ ...input(n, []), brackets: plan })).toEqual([]);
    }
  });

  it('the standard and finals-only formats keep the 4–7 rule', () => {
    expect(validateBracketPlan(input(8, [8], 26, 'placement'))).toEqual(['Cat Gold: size must be 4–7']);
    expect(validateBracketPlan(input(8, [8], 26, 'finals'))).toEqual(['Cat Gold: size must be 4–7']);
    expect(validateBracketPlan(input(5, [2, 3], 26, 'placement'))).toEqual(['Cat Gold: size must be 4–7', 'Cat Silver: size must be 4–7']);
    expect(validateBracketPlan({ ...input(8, [8]), format: undefined })).toEqual(['Cat Gold: size must be 4–7']);
  });

  it('brackets made for knockout do not fit the standard format, and Suggest repairs them (Review Focus 4)', () => {
    const knockout = { ...input(11, []), brackets: suggestBracketPlan([cat], teamsOf(11), undefined, 'knockout') };
    expect(knockout.brackets.map((b) => b.size)).toEqual([11]);
    expect(validateBracketPlan(knockout)).toEqual([]);
    const back: EventInput = { ...knockout, format: { brackets: 'placement' } };
    expect(validateBracketPlan(back)).toEqual(['Cat Gold: size must be 4–7']);
    const repaired = { ...back, brackets: suggestBracketPlan(back.categories, back.teams, undefined, 'placement') };
    expect(repaired.brackets.map((b) => b.size)).toEqual([4, 7]);
    expect(validateBracketPlan(repaired)).toEqual([]);
    // And the other way: brackets of 4 are fine for knockout; Suggest makes it one bracket of 11.
    expect(validateBracketPlan({ ...repaired, format: { brackets: 'knockout' } })).toEqual([]);
  });
});

describe('knockout with a category of one team', () => {
  it('the bracket of one needs no race and wins by default once the brackets are drawn', () => {
    const input = ko([['a', 4], ['b', 1]], 6, true);
    expect(input.brackets.map((b) => [b.id, b.size])).toEqual([['a:0', 4], ['b:0', 1]]);
    expect(validateBracketPlan(input)).toEqual([]);
    expect(buildRoundPlan(input).map((r) => (r.kind === 'knockout' ? [r.stage, r.bracketIds] : r.kind)))
      .toEqual(['seeding', 'seeding', [2, ['a:0']], [1, ['a:0']], 'grand']);
    // Still seeding: nothing is decided.
    expect(play(input, bySeed, 1).ev.categoryWinners).toEqual({ a: null, b: null });
    // The first knockout round is reached: b0 has won its bracket and has no race to wait for.
    const drawn = play(input, bySeed, 2).ev;
    expect(drawn.standings).toEqual({ a: [null, null, null, null], b: ['b0'] });
    expect(drawn.rounds[2]!.races.every((r) => r.bracketId === 'a:0')).toBe(true);
    const { ev } = play(input);
    expect(ev.missing).toEqual([]);
    expect(ev.rounds[4]!.races[0]!.entrants.map((x) => x.teamId)).toEqual(['a0', 'b0']);
    expect(ev.grandChampion).toBe('a0');
    expect(ev.standings).toEqual({ a: ['a0', 'a1', 'a2', 'a3'], b: ['b0'] });
  });

  it('two categories of one team: only the Grand Championship is raced', () => {
    const input = ko([['a', 1], ['b', 1]], 2, true);
    expect(buildRoundPlan(input).map((r) => r.kind)).toEqual(['seeding', 'seeding', 'grand']);
    const { ev } = play(input);
    expect(ev.categoryWinners).toEqual({ a: 'a0', b: 'b0' });
    expect(ev.grandChampion).toBe('a0');
  });

  it('one team in the whole event: no round after seeding, and it is the winner once seeding is finished', () => {
    const input = ko([['a', 1]], 2, true);
    expect(buildRoundPlan(input).map((r) => r.kind)).toEqual(['seeding', 'seeding']);
    expect(play(input, bySeed, 1).ev.categoryWinners).toEqual({ a: null });
    const { ev, progress } = play(input);
    expect(ev.categoryWinners).toEqual({ a: 'a0' });
    expect(ev.standings).toEqual({ a: ['a0'] });
    // Not while a seeding result is missing.
    const cleared = deriveEvent(input, { ...progress, results: { ...progress.results, 2: {} } });
    expect(cleared.categoryWinners).toEqual({ a: null });
    expect(cleared.missing).toEqual([{ round: 2, teamIds: ['a0'] }]);
  });
});

describe('knockout leaves the other formats alone', () => {
  it('the previous event derives the same, and its plan has no knockout round', () => {
    const { input, results } = previousEvent();
    const plan = buildRoundPlan(input);
    expect(plan.map((r) => r.kind)).toEqual(['seeding', 'seeding', 'seeding', 'seeding', 'heats', 'heats', 'placement', 'placement', 'grand']);
    const ev = deriveEvent(input, { finishedRounds: 9, results, tieDecisions: {} });
    expect(ev.rounds.flatMap((r) => r.races.map((x) => x.role)).filter((role) => role === 'ko' || role === 'third')).toEqual([]);
    expect(ev.grandChampion).not.toBeNull();
  });

  it('a knockout plan never has an empty round, whatever the bracket sizes', () => {
    for (const sizes of [[2], [3], [5, 2], [9, 3, 2], [16, 5, 3], [1, 1, 12]]) {
      const input = ko(sizes.map((n, i) => [String.fromCharCode(97 + i), n]), 26);
      const { ev } = play(input);
      expect(ev.rounds.length).toBe(buildRoundPlan(input).length);
      expect(ev.rounds.every((r) => r.status === 'locked' && r.races.length > 0 && r.races.every((x) => x.entrants.length >= 1))).toBe(true);
      // Every bracket's final is in the last knockout stage.
      const last = ev.rounds.filter((r) => r.spec.kind === 'knockout' && r.spec.stage === 1);
      expect(last.flatMap((r) => r.races).filter((r) => r.role === 'final').map((r) => r.bracketId).sort())
        .toEqual(input.brackets.filter((b) => b.size >= 2).map((b) => b.id).sort());
      for (const c of input.categories) expect([...ev.standings[c.id]!].sort()).toEqual(input.teams.filter((t) => t.categoryId === c.id).map((t) => t.id).sort());
    }
  });
});
