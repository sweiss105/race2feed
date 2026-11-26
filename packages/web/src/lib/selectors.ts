import { hundredths, seedingScore } from '@race2feed/engine';
import type { PublicEntrant, PublicView } from './types';

type Team = PublicView['teams'][number];

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Case- and accent-insensitive substring search; names starting with the query come first. */
export function teamSearch(teams: Team[], query: string): Team[] {
  const q = fold(query);
  if (!q) return [];
  const hits = teams.filter((t) => fold(t.name).includes(q));
  const score = (t: Team) => (fold(t.name).startsWith(q) ? 0 : fold(t.name).split(/\s+/).some((w) => w.startsWith(q)) ? 1 : 2);
  return hits.sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name)).slice(0, 8);
}

export const teamName = (state: PublicView, id: string) => state.teams.find((t) => t.id === id)?.name ?? '';

export type NextRace =
  | { round: number; table: number; label: string; opponents: string[]; status: 'upcoming' | 'racing' | 'done' }
  | { waitingFor: number }
  | null;

/** The team's race in the open round, or which round to wait for. Null when the event is over. */
export function nextRaceFor(state: PublicView, teamId: string): NextRace {
  const { current, phase } = state.round;
  if (current > 0 && (phase === 'open' || phase === 'running')) {
    for (const race of state.rounds[current - 1]?.races ?? []) {
      const me = race.entrants.find((x) => x.teamId === teamId);
      if (!me) continue;
      const done = phase === 'running' && me.status !== 'pending';
      return {
        round: current,
        table: me.table,
        label: race.label,
        opponents: race.entrants.filter((x) => x.teamId !== teamId).map((x) => teamName(state, x.teamId)),
        status: phase === 'open' ? 'upcoming' : done ? 'done' : 'racing',
      };
    }
  }
  return current < state.rounds.length ? { waitingFor: current + 1 } : null;
}

export function scheduleRows(state: PublicView): { table: number; teamId: string; name: string; label: string; ready: boolean }[] {
  const races = state.rounds[state.round.current - 1]?.races ?? [];
  return races
    .flatMap((race) => race.entrants.map((x) => ({ table: x.table, teamId: x.teamId, name: teamName(state, x.teamId), label: race.label, ready: x.ready })))
    .sort((a, b) => a.table - b.table);
}

/** Rows in each of the projector's two team-list columns (filled down the first column, then the second). */
export const rowsPerColumn = (teams: number): number => Math.max(1, Math.ceil(teams / 2));

/** The heading over the value teams are ranked on in seeding. With one run that value is simply the time. */
export function seedHeading(format: PublicView['format']): string {
  if (format.seedingRuns === 1) return 'Time';
  return format.seedingRank === 'best' ? 'Best run' : format.seedingRank === 'dropSlowest' ? 'Best two' : 'Total';
}

/** "Run 1", "Run 2", …: one per seeding run of the format. */
export const runHeadings = (format: PublicView['format']): string[] => Array.from({ length: format.seedingRuns }, (_, i) => `Run ${i + 1}`);

/**
 * Every team's official time per seeding run, read from the rounds themselves, so it follows the small live
 * update of an open or running round (which carries the round's races but not the snapshot's seedRuns).
 * The plan runs every group's run 1, then every group's run 2, …, so the i-th seeding round is run
 * floor(i / groups). null: not raced yet, cleared, DNF or DNS.
 */
export function seedRunsOf(state: PublicView): Record<string, (number | null)[]> {
  const count = state.format.seedingRuns;
  const runs: Record<string, (number | null)[]> = Object.fromEntries(state.teams.map((t) => [t.id, Array.from({ length: count }, () => null)]));
  const seeding = state.rounds.filter((r) => r.kind === 'seeding');
  const groups = Math.max(1, seeding.length / count);
  seeding.forEach((r, i) => {
    const run = Math.floor(i / groups);
    for (const x of r.races.flatMap((race) => race.entrants)) {
      if (runs[x.teamId] && run < count) runs[x.teamId]![run] = x.officialMs;
    }
  });
  return runs;
}

/**
 * Which runs count towards the score. Only "drop the slowest" leaves one out: the slowest, where a run without
 * a time is the slowest of all (so nothing finished is left out while a run is missing). Equal times keep the earlier run.
 */
function countedRuns(runs: (number | null)[], rule: PublicView['format']['seedingRank']): boolean[] {
  if (rule !== 'dropSlowest') return runs.map((ms) => ms !== null);
  const fastest = runs.map((ms, i) => ({ ms, i })).filter((x): x is { ms: number; i: number } => x.ms !== null)
    .sort((a, b) => hundredths(a.ms) - hundredths(b.ms) || a.i - b.i)
    .slice(0, Math.max(1, runs.length - 1));
  return runs.map((_, i) => fastest.some((x) => x.i === i));
}

export interface SeedingLine {
  /** The server's rank within the category; null until seeding is decided. */
  rank: number | null;
  /** Official ms per seeding run, in run order. */
  runs: (number | null)[];
  /** Per run: whether it counts towards the score (a run without a time never does). */
  counted: boolean[];
  /** The value the team is ranked on (the engine's seedingScore under the event's rule); null with nothing to count. */
  scoreMs: number | null;
}

const lineOf = (state: PublicView, teamId: string, runs: (number | null)[]): SeedingLine => ({
  rank: state.seedRank?.[teamId] ?? null,
  runs,
  counted: countedRuns(runs, state.format.seedingRank),
  scoreMs: seedingScore(runs, state.format.seedingRank),
});

/** One team's seeding: the one place every page reads runs and scores from, always by the server's rule. */
export function seedingLine(state: PublicView, teamId: string): SeedingLine {
  return lineOf(state, teamId, seedRunsOf(state)[teamId] ?? Array.from({ length: state.format.seedingRuns }, () => null));
}

export interface SeedingTable { categoryId: string; categoryName: string; rows: (SeedingLine & { teamId: string; name: string; rank: number })[] }

/**
 * Seeding results by category: teams with something to rank on, in the server's seed order once it exists,
 * and by live score until then (rank is then the position in that list).
 */
export function seedingTable(state: PublicView): SeedingTable[] {
  const runs = seedRunsOf(state);
  return state.categories.map((c) => ({
    categoryId: c.id,
    categoryName: c.name,
    rows: state.teams.filter((t) => t.categoryId === c.id)
      .map((t) => ({ teamId: t.id, name: t.name, ...lineOf(state, t.id, runs[t.id] ?? []) }))
      .filter((r) => r.scoreMs !== null)
      .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0) || a.scoreMs! - b.scoreMs!)
      .map((r, i) => ({ ...r, rank: r.rank ?? i + 1 })),
  }));
}

/** Seeding only: the seeding order is the result, and no place is known until every seeding round is settled. */
export const seedingOnly = (state: PublicView): boolean => state.format.brackets === 'none';
export const standingsDecided = (state: PublicView): boolean =>
  Object.values(state.standings).some((places) => places.length > 0) && Object.values(state.standings).every((places) => places.every((id) => id !== null));
export const SEEDING_DECIDES = 'Standings are decided by seeding';

/** Every race the team has been in, oldest first. */
export function teamResults(state: PublicView, teamId: string) {
  return state.rounds.flatMap((r) => r.races
    .filter((race) => race.entrants.some((x) => x.teamId === teamId))
    .map((race) => ({ round: r.round, label: race.label, race, me: race.entrants.find((x) => x.teamId === teamId)! })));
}

export const tierOf = (index: number) => (index >= 0 && index <= 4 ? `tier-${index}` : 'tier-x');

export type { PublicEntrant };

export interface Winner { key: string; title: string; teamId: string | null; name: string | null; subtitle: string | null }

/** The Grand Champion when the event has a grand round, otherwise each category's winner (its top seed in seeding only). */
export function champions(state: PublicView): Winner[] {
  const named = (id: string | null | undefined) => (id ? state.teams.find((t) => t.id === id) ?? null : null);
  if (state.rounds.some((r) => r.kind === 'grand')) {
    const team = named(state.grandChampion);
    const category = state.categories.find((c) => c.id === team?.categoryId);
    // How the champion got to the Grand Championship: as its category's top seed, or by winning its top bracket.
    const top = state.brackets.find((b) => b.categoryId === category?.id && b.tierIndex === 0);
    const subtitle = !category ? null : seedingOnly(state) ? `${category.name} top seed` : `${category.name} ${top?.tierName ?? 'Gold'} Bracket winner`;
    return [{ key: 'grand', title: 'Grand Champion', teamId: team?.id ?? null, name: team?.name ?? null, subtitle }];
  }
  return state.categories.map((c) => {
    const team = named(state.categoryWinners?.[c.id] ?? state.standings[c.id]?.[0]);
    return { key: c.id, title: `${c.name} champion`, teamId: team?.id ?? null, name: team?.name ?? null, subtitle: null };
  });
}

/** "Table 3" or "Tables 3 & 4". */
export const stationLabel = (tables: number[]) => (tables.length === 1 ? `Table ${tables[0]}` : `Tables ${tables.join(' & ')}`);
