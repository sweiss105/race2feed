import type { EntryResult, EventInput, EventProgress, Team } from '../../src/types';
import { suggestBracketPlan } from '../../src/brackets';
import { suggestSeedingGroups } from '../../src/groups';

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
