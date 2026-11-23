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

export function scheduleRows(state: PublicView): { table: number; teamId: string; name: string; label: string }[] {
  const races = state.rounds[state.round.current - 1]?.races ?? [];
  return races
    .flatMap((race) => race.entrants.map((x) => ({ table: x.table, teamId: x.teamId, name: teamName(state, x.teamId), label: race.label })))
    .sort((a, b) => a.table - b.table);
}

export function seedingRow(state: PublicView, teamId: string): { rank: number | null; totalMs: number | null; runs: (number | null)[] } {
  const runs = state.rounds
    .filter((r) => r.kind === 'seeding')
    .flatMap((r) => r.races.flatMap((race) => race.entrants.filter((x) => x.teamId === teamId)))
    .map((x) => x.officialMs);
  return { rank: state.seedRank?.[teamId] ?? null, totalMs: state.seedTotalsMs[teamId] ?? null, runs };
}

/** Every race the team has been in, oldest first. */
export function teamResults(state: PublicView, teamId: string) {
  return state.rounds.flatMap((r) => r.races
    .filter((race) => race.entrants.some((x) => x.teamId === teamId))
    .map((race) => ({ round: r.round, label: race.label, race, me: race.entrants.find((x) => x.teamId === teamId)! })));
}

export const tierOf = (index: number) => (index >= 0 && index <= 4 ? `tier-${index}` : 'tier-x');

export type { PublicEntrant };
