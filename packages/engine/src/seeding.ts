import type { EntryResult, Team } from './types';
import { officialMs } from './race';
import { hundredths } from './time';

/**
 * Rank within category by: finished runs (desc), total official time,
 * best single run (both at displayed hundredths), then team order.
 */
export function rankSeeding(
  teams: Team[],
  run1: Record<string, EntryResult | undefined>,
  run2: Record<string, EntryResult | undefined>,
): Record<string, number> {
  const keyed = teams.map((team) => {
    const times = [run1[team.id], run2[team.id]]
      .map((r) => (r ? officialMs(r) : null))
      .filter((ms): ms is number => ms !== null);
    return {
      team,
      finished: times.length,
      total: hundredths(times.reduce((sum, ms) => sum + ms, 0)),
      best: times.length ? hundredths(Math.min(...times)) : Infinity,
    };
  });

  const rank: Record<string, number> = {};
  const byCategory = new Map<string, typeof keyed>();
  for (const k of keyed) {
    const list = byCategory.get(k.team.categoryId) ?? [];
    list.push(k);
    byCategory.set(k.team.categoryId, list);
  }
  for (const list of byCategory.values()) {
    list.sort(
      (a, b) =>
        b.finished - a.finished || a.total - b.total || a.best - b.best || a.team.order - b.team.order,
    );
    list.forEach((k, i) => (rank[k.team.id] = i + 1));
  }
  return rank;
}
