import type { BracketSpec, EventInput, EventProgress } from './types';
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
  entrants: { teamId: string; table: number }[];
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
  blockers: string[];
}

/** A race before tables are assigned. */
interface Draft {
  id: string;
  label: string;
  bracketId?: string;
  teams: string[];
  fallbackOrder: string[];
}

export function deriveEvent(input: EventInput, progress: EventProgress): DerivedEvent {
  const plan = buildRoundPlan(input);
  const categoryName = new Map(input.categories.map((c) => [c.id, c.name]));
  const bracketById = new Map(input.brackets.map((b) => [b.id, b]));
  const bracketLabel = (b: BracketSpec) => `${categoryName.get(b.categoryId) ?? b.categoryId} ${b.tierName}`;

  const rounds: RoundView[] = [];
  const blockers: string[] = [];
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
    if (!open) {
      rounds.push({ spec, status: 'blocked', races: [] });
      continue;
    }
    if (spec.kind !== 'seeding' && members === null) {
      seedRank = computeSeedRank();
      members = computeMembers(seedRank);
    }

    const drafts = draftRaces(spec);
    const results = progress.results[spec.round] ?? {};
    const laid = spec.kind === 'seeding'
      ? drafts.map((d) => ({ race: d, tables: d.teams.map((id) => input.tableOf[id] ?? 0) }))
      : layoutTables(drafts.map((d) => d.teams)).map(({ race, tables }) => ({
          race: drafts.find((d) => d.teams === race)!,
          tables,
        }));

    const races: RaceView[] = laid.map(({ race, tables }) => ({
      id: race.id,
      round: spec.round,
      label: race.label,
      ...(race.bracketId ? { bracketId: race.bracketId } : {}),
      entrants: race.teams.map((teamId, i) => ({ teamId, table: tables[i]! })),
      ranking: rankRace(
        race.teams.map((teamId) => ({ teamId, result: results[teamId] })),
        { fallbackOrder: race.fallbackOrder, tieOrder: progress.tieDecisions[race.id] },
      ),
    }));

    const locked = spec.round <= progress.finishedRounds;
    rounds.push({ spec, status: locked ? 'locked' : 'ready', races });
    if (!locked) {
      open = false;
      continue;
    }
    for (const race of races) {
      if (race.ranking.ties.length) {
        blockers.push(`Round ${spec.round}: tie in ${race.id}`);
        open = false;
      } else {
        settled.set(race.id, race.ranking);
      }
    }
  }

  return { rounds, seedRank, standings: computeStandings(), grandChampion: computeChampion(), blockers };

  function draftRaces(spec: RoundSpec): Draft[] {
    const r = `r${spec.round}`;
    if (spec.kind === 'seeding') {
      const group = input.groups.find((g) => g.id === spec.groupId);
      return (group?.teamIds ?? []).map((teamId) => ({
        id: `${r}:seed:${teamId}`,
        label: `Group ${spec.groupId} · Run ${spec.run}`,
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
      grandRaceId = `${r}:grand`;
      return [{ id: grandRaceId, label: 'Grand Championship', teams, fallbackOrder: teams }];
    }
    return spec.bracketIds.flatMap((bracketId) => {
      const bracket = bracketById.get(bracketId)!;
      const seeded = members!.get(bracketId) ?? [];
      const ids = raceIdsOf.get(bracketId) ?? { heats: [] };
      raceIdsOf.set(bracketId, ids);
      const base = { bracketId, fallbackOrder: seeded };
      if (spec.kind === 'heats') {
        if (seeded.length < 4) {
          ids.final = `${r}:${bracketId}:final`;
          return [{ ...base, id: ids.final, label: `${bracketLabel(bracket)} · Race`, teams: seeded }];
        }
        return buildHeats(seeded).map((teams, i) => {
          const id = `${r}:${bracketId}:heat${i + 1}`;
          ids.heats.push(id);
          return { ...base, id, label: `${bracketLabel(bracket)} · Heat ${i + 1}`, teams };
        });
      }
      const rankedHeats = ids.heats.map((id) => settled.get(id)!.order);
      const { winners, others } = buildPlacement(rankedHeats);
      ids.winners = `${r}:${bracketId}:winners`;
      ids.others = `${r}:${bracketId}:others`;
      return [
        { ...base, id: ids.winners, label: `${bracketLabel(bracket)} · Winners race`, teams: winners },
        { ...base, id: ids.others, label: `${bracketLabel(bracket)} · Others race`, teams: others },
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
