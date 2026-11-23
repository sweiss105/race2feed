import fixture from '../fixtures/previous-event.json';
import type { EntryResult, EventInput, EventProgress, Team } from '../../src/types';
import { suggestBracketPlan } from '../../src/brackets';
import { suggestSeedingGroups } from '../../src/groups';
import { parseClockTime } from '../../src/time';

export const fin = (seconds: number, penaltySeconds = 0): EntryResult =>
  ({ status: 'finished', rawMs: Math.round(seconds * 1000), penaltiesMs: penaltySeconds * 1000 });
export const dns: EntryResult = { status: 'dns', rawMs: null, penaltiesMs: 0 };

/** Categories given as [id, teamCount]; team ids are `${categoryId}${index}`. */
export function makeEvent(cats: [string, number][], tableCount: number, grandChampionship: boolean): EventInput {
  const categories = cats.map(([id]) => ({ id, name: id.toUpperCase() }));
  const teams: Team[] = [];
  for (const [id, n] of cats) {
    for (let i = 0; i < n; i++) teams.push({ id: `${id}${i}`, name: `${id}${i}`, categoryId: id, order: teams.length });
  }
  const { groups, tableOf } = suggestSeedingGroups(categories, teams, tableCount);
  return { tableCount, categories, teams, groups, tableOf, brackets: suggestBracketPlan(categories, teams), grandChampionship };
}

export const progress = (finishedRounds: number, results: EventProgress['results'] = {}, tieDecisions: EventProgress['tieDecisions'] = {}): EventProgress =>
  ({ finishedRounds, results, tieDecisions });

/** Seeding results so that team index order is seed order (index 0 fastest). */
export function seedInOrder(input: EventInput, rounds: number[]): EventProgress['results'] {
  const results: EventProgress['results'] = {};
  for (const r of rounds) {
    results[r] = {};
    input.teams.forEach((t, i) => (results[r]![t.id] = fin(100 + i)));
  }
  return results;
}

/**
 * The previous event's input and results. Team ids are `t${index}` in fixture order.
 * Rounds 1–4: A run 1, B run 1, A run 2, B run 2. Rounds 5–9: synthetic times from recorded places.
 */
export function previousEvent(): { input: EventInput; results: EventProgress['results'] } {
  const finished = (rawMs: number): EntryResult => ({ status: 'finished', rawMs, penaltiesMs: 0 });
  const teams: Team[] = fixture.teams.map((t, i) => ({ id: `t${i}`, name: t.name, categoryId: t.category, order: i }));
  const idOf = new Map(teams.map((t) => [t.name, t.id]));
  const categories = fixture.categories.map((name) => ({ id: name, name }));
  const input: EventInput = {
    tableCount: fixture.tableCount,
    categories,
    teams,
    groups: ['A', 'B'].map((g) => ({
      id: g,
      teamIds: fixture.teams
        .map((t, i) => ({ t, id: `t${i}` }))
        .filter(({ t }) => t.group === g)
        .sort((a, b) => a.t.table - b.t.table)
        .map(({ id }) => id),
    })),
    tableOf: Object.fromEntries(fixture.teams.map((t, i) => [`t${i}`, t.table])),
    brackets: suggestBracketPlan(categories, teams),
    grandChampionship: true,
  };

  const results: EventProgress['results'] = {};
  const seedingRound = { A: [1, 3], B: [2, 4] } as const;
  fixture.teams.forEach((t, i) => {
    const [r1, r2] = seedingRound[t.group as 'A' | 'B'];
    (results[r1] ??= {})[`t${i}`] = finished(parseClockTime(t.run1));
    (results[r2] ??= {})[`t${i}`] = finished(parseClockTime(t.run2));
  });
  for (const { round, rows } of fixture.bracketRounds) {
    results[round] = Object.fromEntries(rows.map((row) => [idOf.get(row.team)!, finished(200_000 + row.place * 5_000)]));
  }
  return { input, results };
}
