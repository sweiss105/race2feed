import { formatOf, type BracketSpec, type EventInput } from './types';
import { bracketSet, grandCategories } from './brackets';
import { knockoutRaces, knockoutStages } from './knockout';

export type RoundSpec =
  | { round: number; kind: 'seeding'; groupId: string; run: 1 | 2 | 3 }
  | { round: number; kind: 'heats' | 'placement'; set: 'upper' | 'lower'; bracketIds: string[] }
  /** Finals-only format: every bracket in the round races once, all its teams in one race. */
  | { round: number; kind: 'finals'; set: 'upper' | 'lower'; bracketIds: string[] }
  /**
   * Knockout format: the brackets that race in `stage` (1 = the final stage, with the final and the third-place
   * race; 2 = semi-finals; 3 = quarter-finals; …). A bracket with a bye for all its teams, or with fewer stages,
   * is not in the round.
   */
  | { round: number; kind: 'knockout'; stage: number; bracketIds: string[] }
  | { round: number; kind: 'grand' };

type Unnumbered<T> = T extends unknown ? Omit<T, 'round'> : never;

/** Greedy chunks of whole brackets whose team totals (`teams`: how many of a bracket's teams race) fit the tables. */
function chunk(brackets: BracketSpec[], tableCount: number, teams: (b: BracketSpec) => number = (b) => b.size): BracketSpec[][] {
  const chunks: BracketSpec[][] = [];
  let current: BracketSpec[] = [];
  let used = 0;
  for (const b of brackets) {
    if (current.length && used + teams(b) > tableCount) {
      chunks.push(current);
      current = [];
      used = 0;
    }
    current.push(b);
    used += teams(b);
  }
  if (current.length) chunks.push(current);
  return chunks;
}

/**
 * The event's rounds in order: every seeding group once per seeding run (all of run 1, then run 2, …), then the
 * bracket rounds of the format (heats then placement; one finals round per chunk; the knockout stages; none for
 * seeding only), then the Grand Championship when it is on and at least two categories send a winner.
 *
 * Knockout: one round per stage per table-sized chunk, from the earliest stage of the largest bracket down to
 * the final stage, so every bracket's final is in the last stage and a smaller bracket starts later. A stage's
 * chunks hold, in bracket order, the brackets that race in it, counted by the teams racing (two a race; the
 * final stage counts the final and the third-place race). A stage in which no bracket races has no round.
 */
export function buildRoundPlan(input: EventInput): RoundSpec[] {
  const format = formatOf(input);
  const catIndex = new Map(input.categories.map((c, i) => [c.id, i]));
  const ordered = [...input.brackets].sort(
    (a, b) => (catIndex.get(a.categoryId) ?? 0) - (catIndex.get(b.categoryId) ?? 0) || a.tierIndex - b.tierIndex,
  );
  const rounds: Unnumbered<RoundSpec>[] = [];

  for (const run of ([1, 2, 3] as const).slice(0, format.seedingRuns)) {
    for (const g of input.groups) rounds.push({ kind: 'seeding', groupId: g.id, run });
  }

  if (format.brackets === 'knockout') {
    for (let stage = Math.max(0, ...ordered.map((b) => knockoutStages(b.size))); stage >= 1; stage--) {
      const racing = ordered.filter((b) => knockoutRaces(b.size, stage) > 0);
      for (const c of chunk(racing, input.tableCount, (b) => 2 * knockoutRaces(b.size, stage))) {
        rounds.push({ kind: 'knockout', stage, bracketIds: c.map((b) => b.id) });
      }
    }
  }

  // Seeding only races no brackets, whatever the setup still holds.
  const sets = format.brackets === 'none' || format.brackets === 'knockout' ? [] : (['lower', 'upper'] as const).map((set) => ({
    set,
    chunks: chunk(ordered.filter((b) => bracketSet(b) === set), input.tableCount),
  }));
  for (const { set, chunks } of sets) {
    for (const c of chunks) rounds.push({ kind: format.brackets === 'finals' ? 'finals' : 'heats', set, bracketIds: c.map((b) => b.id) });
  }
  if (format.brackets === 'placement') {
    for (const { set, chunks } of sets) {
      for (const c of chunks) {
        const bracketIds = c.filter((b) => b.size >= 4).map((b) => b.id);
        if (bracketIds.length) rounds.push({ kind: 'placement', set, bracketIds });
      }
    }
  }

  // A Grand Championship needs at least two category winners to race.
  if (input.grandChampionship && grandCategories(input).length >= 2) rounds.push({ kind: 'grand' });

  return rounds.map((r, i) => ({ ...r, round: i + 1 }) as RoundSpec);
}
