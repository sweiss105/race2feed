import type { BracketSpec, EventInput } from './types';
import { bracketSet, grandCategories } from './brackets';

export type RoundSpec =
  | { round: number; kind: 'seeding'; groupId: string; run: 1 | 2 }
  | { round: number; kind: 'heats' | 'placement'; set: 'upper' | 'lower'; bracketIds: string[] }
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

export function buildRoundPlan(input: EventInput): RoundSpec[] {
  const catIndex = new Map(input.categories.map((c, i) => [c.id, i]));
  const ordered = [...input.brackets].sort(
    (a, b) => (catIndex.get(a.categoryId) ?? 0) - (catIndex.get(b.categoryId) ?? 0) || a.tierIndex - b.tierIndex,
  );
  const rounds: Unnumbered<RoundSpec>[] = [];

  for (const run of [1, 2] as const) {
    for (const g of input.groups) rounds.push({ kind: 'seeding', groupId: g.id, run });
  }

  const sets = (['lower', 'upper'] as const).map((set) => ({
    set,
    chunks: chunk(ordered.filter((b) => bracketSet(b) === set), input.tableCount),
  }));
  for (const { set, chunks } of sets) {
    for (const c of chunks) rounds.push({ kind: 'heats', set, bracketIds: c.map((b) => b.id) });
  }
  for (const { set, chunks } of sets) {
    for (const c of chunks) {
      const bracketIds = c.filter((b) => b.size >= 4).map((b) => b.id);
      if (bracketIds.length) rounds.push({ kind: 'placement', set, bracketIds });
    }
  }

  // A Grand Championship needs at least two category winners to race.
  if (input.grandChampionship && grandCategories(input).length >= 2) rounds.push({ kind: 'grand' });

  return rounds.map((r, i) => ({ ...r, round: i + 1 }) as RoundSpec);
}
