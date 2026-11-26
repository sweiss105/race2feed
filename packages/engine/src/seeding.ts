import type { EntryResult, SeedingRankRule, Team } from './types';
import { officialMs } from './race';
import { hundredths } from './time';

/**
 * What a team is ranked on. times: one entry per seeding run, in run order (null = not finished: DNF, DNS or no
 * result). Everything is taken at the displayed hundredth.
 * - total: every finished run counts.
 * - best: only the fastest finished run counts.
 * - dropSlowest: the slowest run is ignored, and a run that was not finished is that slowest run; so with 3 runs
 *   the best two finished runs count, or the only one when two were not finished.
 * counted: how many runs count. score: their total. best: the fastest finished run. total: all finished runs.
 */
function seedingKey(times: (number | null)[], rule: SeedingRankRule) {
  const finished = times.filter((ms): ms is number => ms !== null).sort((a, b) => a - b);
  const keep = rule === 'total' ? finished.length : rule === 'best' ? 1 : Math.max(1, times.length - 1);
  const counted = finished.slice(0, keep);
  const sum = (list: number[]) => hundredths(list.reduce((total, ms) => total + ms, 0));
  return {
    counted: counted.length,
    score: sum(counted),
    best: finished.length ? hundredths(finished[0]!) : Infinity,
    total: sum(finished),
  };
}

/**
 * The time a team is ranked on under the rule, in ms cut to the hundredth: the total of its finished runs
 * ('total'), its best run ('best'), or the total of its counted runs ('dropSlowest'). null with nothing to count.
 */
export function seedingScore(times: (number | null)[], rule: SeedingRankRule): number | null {
  const key = seedingKey(times, rule);
  return key.counted ? key.score * 10 : null;
}

const cmp = (a: number, b: number) => (a === b ? 0 : a < b ? -1 : 1);

/**
 * Rank within category, 1-based. runs: one record per seeding run, in order (length 1–3). All times are official
 * times compared at the displayed hundredth.
 * - total (default): more finished runs, then the lower total, then the better single run, then team order.
 * - best: the lower best run (a team with no finished run is last), then the lower total of finished runs, then team order.
 * - dropSlowest: more counted runs, then the lower total of the counted runs, then the better single run, then team order.
 */
export function rankSeeding(
  teams: Team[],
  runs: Record<string, EntryResult | undefined>[],
  rule: SeedingRankRule = 'total',
): Record<string, number> {
  const keyed = teams.map((team) => ({
    team,
    ...seedingKey(runs.map((run) => { const r = run[team.id]; return r ? officialMs(r) : null; }), rule),
  }));

  const rank: Record<string, number> = {};
  const byCategory = new Map<string, typeof keyed>();
  for (const k of keyed) {
    const list = byCategory.get(k.team.categoryId) ?? [];
    list.push(k);
    byCategory.set(k.team.categoryId, list);
  }
  for (const list of byCategory.values()) {
    list.sort((a, b) => (rule === 'best'
      ? cmp(a.best, b.best) || cmp(a.total, b.total)
      : cmp(b.counted, a.counted) || cmp(a.score, b.score) || cmp(a.best, b.best)) || a.team.order - b.team.order);
    list.forEach((k, i) => (rank[k.team.id] = i + 1));
  }
  return rank;
}
