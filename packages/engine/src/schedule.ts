import { formatOf, type BracketSpec, type EventInput } from './types';
import { bracketSet, grandCategories } from './brackets';

export type RoundSpec =
  | { round: number; kind: 'seeding'; groupId: string; run: 1 | 2 | 3 }
  | { round: number; kind: 'heats' | 'placement'; set: 'upper' | 'lower'; bracketIds: string[] }
  /** Finals-only format: every bracket in the round races once, all its teams in one race. */
  | { round: number; kind: 'finals'; set: 'upper' | 'lower'; bracketIds: string[] }
  | { round: number; kind: 'grand' };

type Unnumbered<T> = T extends unknown ? Omit<T, 'round'> : never;

/** Greedy chunks of whole brackets whose team totals fit the tables. */
function chunk(brackets: BracketSpec[], tableCount: number): BracketSpec[][] {
  const chunks: BracketSpec[][] = [];
  let current: BracketSpec[] = [];
  let used = 0;
  for (const b of brackets) {
    if (current.length && used + b.size > tableCount) {
      chunks.push(current);
      current = [];
      used = 0;
    }
    current.push(b);
    used += b.size;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

/**
 * The event's rounds in order: every seeding group once per seeding run (all of run 1, then run 2, …), then the
 * bracket rounds of the format (heats then placement; one finals round per chunk; none for seeding only), then
 * the Grand Championship when it is on and at least two categories send a winner.
 */
export function buildRoundPlan(input: EventInput): RoundSpec[] {
  const format = formatOf(input);
  if (format.brackets === 'knockout') throw new Error('knockout is not built yet');
  const catIndex = new Map(input.categories.map((c, i) => [c.id, i]));
  const ordered = [...input.brackets].sort(
    (a, b) => (catIndex.get(a.categoryId) ?? 0) - (catIndex.get(b.categoryId) ?? 0) || a.tierIndex - b.tierIndex,
  );
  const rounds: Unnumbered<RoundSpec>[] = [];

  for (const run of ([1, 2, 3] as const).slice(0, format.seedingRuns)) {
    for (const g of input.groups) rounds.push({ kind: 'seeding', groupId: g.id, run });
  }

  // Seeding only races no brackets, whatever the setup still holds.
  const sets = format.brackets === 'none' ? [] : (['lower', 'upper'] as const).map((set) => ({
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
