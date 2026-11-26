import type { BracketSpec, EventInput, EventProgress, RaceRole, SavedRace } from './types';
import { rankRace, type RaceRanking } from './race';
import { rankSeeding } from './seeding';
import { buildHeats, buildPlacement } from './brackets';
import { buildRoundPlan, type RoundSpec } from './schedule';
import { layoutTables } from './layout';

export interface RaceView {
  id: string;
  round: number;
  label: string;
  bracketId?: string;
  role: RaceRole;
  entrants: { teamId: string; table: number }[];
  fallbackOrder: string[];
  ranking: RaceRanking;
}

export interface RoundView {
  spec: RoundSpec;
  status: 'locked' | 'ready' | 'blocked';
  races: RaceView[];
}

export interface DerivedEvent {
  rounds: RoundView[];
  /** null until every seeding round is locked */
  seedRank: Record<string, number> | null;
  /** categoryId → teamId per place (index 0 = 1st); null = undecided */
  standings: Record<string, (string | null)[]>;
  grandChampion: string | null;
  /** bracketId → team ids in seed order; null until the first non-seeding round is reached */
  bracketMembers: Record<string, string[]> | null;
  /** Why later rounds cannot open, in plain words: undecided ties and finished rounds missing a result. */
  blockers: string[];
  /** Finished rounds in which a team has no result (it was cleared); such a round decides nothing until it has one. */
  missing: { round: number; teamIds: string[] }[];
}

/** "A", "A and B", "A, B and C". */
const listNames = (names: string[]) =>
  names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;

/** A race before tables are assigned. */
type Draft = Omit<SavedRace, 'tables'>;

export function deriveEvent(input: EventInput, progress: EventProgress): DerivedEvent {
  const plan = buildRoundPlan(input);
  const categoryName = new Map(input.categories.map((c) => [c.id, c.name]));
  const bracketById = new Map(input.brackets.map((b) => [b.id, b]));
  const bracketLabel = (b: BracketSpec) => `${categoryName.get(b.categoryId) ?? b.categoryId} ${b.tierName}`;

  const rounds: RoundView[] = [];
  const blockers: string[] = [];
  const missing: DerivedEvent['missing'] = [];
  const teamName = new Map(input.teams.map((t) => [t.id, t.name]));
  /** Final rankings of every race in a locked, tie-free round. */
  const settled = new Map<string, RaceRanking>();
  /** bracketId → race ids that decide it (heats, final, winners/others). */
  const raceIdsOf = new Map<string, { heats: string[]; final?: string; winners?: string; others?: string }>();
  let seedRank: Record<string, number> | null = null;
  let members: Map<string, string[]> | null = null; // bracketId → team ids in seed order
  let grandRaceId: string | null = null;
  let open = true;

  const seedingRounds = plan.filter((r): r is Extract<RoundSpec, { kind: 'seeding' }> => r.kind === 'seeding');

  for (const spec of plan) {
    const saved = progress.lineups?.[spec.round];
    // An opened round keeps its races even after an undecided tie earlier on; only unopened rounds wait.
    if (!open && !saved) {
      rounds.push({ spec, status: 'blocked', races: [] });
      continue;
    }
    if (spec.kind !== 'seeding' && members === null) {
      seedRank = computeSeedRank();
      members = progress.bracketMembers ? new Map(Object.entries(progress.bracketMembers)) : computeMembers(seedRank);
    }

    const results = progress.results[spec.round] ?? {};
    const laid: { race: Draft; tables: number[] }[] = saved
      ? saved.map((race) => ({ race, tables: race.tables }))
      : layRaces(spec, draftRaces(spec));

    const races: RaceView[] = laid.map(({ race, tables }) => ({
      id: race.id,
      round: spec.round,
      label: race.label,
      ...(race.bracketId ? { bracketId: race.bracketId } : {}),
      role: race.role,
      entrants: race.teams.map((teamId, i) => ({ teamId, table: tables[i]! })),
      fallbackOrder: race.fallbackOrder,
      ranking: rankRace(
        race.teams.map((teamId) => ({ teamId, result: results[teamId] })),
        { fallbackOrder: race.fallbackOrder, tieOrder: progress.tieDecisions[race.id] },
      ),
    }));
    races.forEach(recordRace);

    const locked = spec.round <= progress.finishedRounds;
    rounds.push({ spec, status: locked ? 'locked' : 'ready', races });
    if (!locked) {
      open = false;
      continue;
    }
    // A finished round is settled only when every entrant has a result (a cleared one leaves a team without).
    const noResult = (teamId: string) => (results[teamId]?.status ?? 'pending') === 'pending';
    const waiting = races.flatMap((race) => race.entrants.map((x) => x.teamId).filter(noResult));
    if (waiting.length) {
      missing.push({ round: spec.round, teamIds: waiting });
      blockers.push(`Round ${spec.round}: ${listNames(waiting.map((id) => teamName.get(id) ?? id))} ${waiting.length === 1 ? 'has' : 'have'} no result. Enter a time, DNF or DNS.`);
      open = false;
    }
    for (const race of races) {
      if (race.ranking.ties.length) {
        blockers.push(`Round ${spec.round}: tie in ${race.id}`);
        open = false;
      } else if (!race.entrants.some((x) => noResult(x.teamId))) {
        settled.set(race.id, race.ranking);
      }
    }
  }

  return {
    rounds,
    seedRank,
    standings: computeStandings(),
    grandChampion: computeChampion(),
    bracketMembers: members ? Object.fromEntries(members) : null,
    blockers,
    missing,
  };

  function layRaces(spec: RoundSpec, drafts: Draft[]): { race: Draft; tables: number[] }[] {
    if (spec.kind === 'seeding') return drafts.map((d) => ({ race: d, tables: d.teams.map((id) => input.tableOf[id] ?? 0) }));
    return layoutTables(drafts.map((d) => d.teams), input.tablesPerStation ?? 2).map(({ race, tables }) => ({
      race: drafts.find((d) => d.teams === race)!,
      tables,
    }));
  }

  /** Notes which races decide each bracket, and the grand race, by role. */
  function recordRace(race: RaceView) {
    if (race.role === 'grand') grandRaceId = race.id;
    if (!race.bracketId) return;
    const ids = raceIdsOf.get(race.bracketId) ?? { heats: [] };
    raceIdsOf.set(race.bracketId, ids);
    if (race.role === 'heat') ids.heats.push(race.id);
    else if (race.role === 'final' || race.role === 'winners' || race.role === 'others') ids[race.role] = race.id;
  }

  function draftRaces(spec: RoundSpec): Draft[] {
    const r = `r${spec.round}`;
    if (spec.kind === 'seeding') {
      const group = input.groups.find((g) => g.id === spec.groupId);
      return (group?.teamIds ?? []).map((teamId) => ({
        id: `${r}:seed:${teamId}`,
        label: `Group ${spec.groupId} · Run ${spec.run}`,
        role: 'seed' as const,
        teams: [teamId],
        fallbackOrder: [teamId],
      }));
    }
    if (spec.kind === 'grand') {
      const teams = input.categories.flatMap((c) => {
        const top = input.brackets.find((b) => b.categoryId === c.id && b.tierIndex === 0);
        const winner = top ? bracketWinner(top.id) : null;
        return winner ? [winner] : [];
      });
      return [{ id: `${r}:grand`, label: 'Grand Championship', role: 'grand', teams, fallbackOrder: teams }];
    }
    return spec.bracketIds.flatMap((bracketId): Draft[] => {
      const bracket = bracketById.get(bracketId)!;
      const seeded = members!.get(bracketId) ?? [];
      const base = { bracketId, fallbackOrder: seeded };
      if (spec.kind === 'heats') {
        if (seeded.length < 4) {
          return [{ ...base, id: `${r}:${bracketId}:final`, label: `${bracketLabel(bracket)} · Race`, role: 'final', teams: seeded }];
        }
        return buildHeats(seeded).map((teams, i) => ({
          ...base,
          id: `${r}:${bracketId}:heat${i + 1}`,
          label: `${bracketLabel(bracket)} · Heat ${i + 1}`,
          role: 'heat',
          teams,
        }));
      }
      const rankedHeats = (raceIdsOf.get(bracketId)?.heats ?? []).map((id) => settled.get(id)!.order);
      const { winners, others } = buildPlacement(rankedHeats);
      return [
        { ...base, id: `${r}:${bracketId}:winners`, label: `${bracketLabel(bracket)} · Winners race`, role: 'winners', teams: winners },
        { ...base, id: `${r}:${bracketId}:others`, label: `${bracketLabel(bracket)} · Others race`, role: 'others', teams: others },
      ];
    });
  }

  function computeSeedRank(): Record<string, number> {
    const run = (n: 1 | 2) => {
      const out: Record<string, EventProgress['results'][number][string] | undefined> = {};
      for (const spec of seedingRounds.filter((s) => s.run === n)) {
        const group = input.groups.find((g) => g.id === spec.groupId);
        for (const teamId of group?.teamIds ?? []) out[teamId] = progress.results[spec.round]?.[teamId];
      }
      return out;
    };
    return rankSeeding(input.teams, run(1), run(2));
  }

  function computeMembers(rank: Record<string, number>): Map<string, string[]> {
    const map = new Map<string, string[]>();
    for (const b of input.brackets) {
      const ordered = input.teams
        .filter((t) => t.categoryId === b.categoryId)
        .sort((x, y) => (rank[x.id] ?? 0) - (rank[y.id] ?? 0))
        .map((t) => t.id);
      map.set(b.id, ordered.slice(b.firstSeed - 1, b.firstSeed - 1 + b.size));
    }
    return map;
  }

  /** The bracket's final order, or null while undecided. */
  function bracketOrder(bracketId: string): string[] | null {
    const ids = raceIdsOf.get(bracketId);
    if (!ids) return null;
    if (ids.final) return settled.get(ids.final)?.order ?? null;
    const winners = ids.winners ? settled.get(ids.winners) : undefined;
    const others = ids.others ? settled.get(ids.others) : undefined;
    return winners && others ? [...winners.order, ...others.order] : null;
  }

  function bracketWinner(bracketId: string): string | null {
    return bracketOrder(bracketId)?.[0] ?? null;
  }

  function computeStandings(): Record<string, (string | null)[]> {
    const standings: Record<string, (string | null)[]> = {};
    for (const c of input.categories) {
      const n = input.teams.filter((t) => t.categoryId === c.id).length;
      const places: (string | null)[] = Array.from({ length: n }, () => null);
      for (const b of input.brackets.filter((x) => x.categoryId === c.id)) {
        bracketOrder(b.id)?.forEach((teamId, i) => (places[b.firstSeed - 1 + i] = teamId));
      }
      standings[c.id] = places;
    }
    return standings;
  }

  function computeChampion(): string | null {
    return grandRaceId ? settled.get(grandRaceId)?.order[0] ?? null : null;
  }
}
