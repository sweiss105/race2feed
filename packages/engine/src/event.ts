import { formatOf, type BracketSpec, type EventInput, type EventProgress, type RaceRole, type SavedRace } from './types';
import { rankRace, type RaceRanking } from './race';
import { rankSeeding } from './seeding';
import { buildHeats, buildPlacement } from './brackets';
import { hasThirdPlace, knockoutDraw, knockoutRaceName, type KnockoutMatch } from './knockout';
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
  /**
   * Rank within category by the format's seeding rule; null until the first round after seeding is reached.
   * Seeding only: null until every seeding round is locked with no result missing.
   */
  seedRank: Record<string, number> | null;
  /**
   * categoryId → teamId per place (index 0 = 1st); null = undecided.
   * Seeding only: the category's teams in seed order, all null until seedRank is known.
   * Knockout: a bracket's places are all decided together, once its final, its third-place race and every
   * earlier race are settled: the final's order, the third-place race's order, then the teams knocked out in
   * each earlier stage (latest first) by their official time in that stage.
   */
  standings: Record<string, (string | null)[]>;
  /** categoryId → the category's winner (standings[categoryId][0]); null while undecided or without teams. */
  categoryWinners: Record<string, string | null>;
  grandChampion: string | null;
  /** bracketId → team ids in seed order; null until the first bracket round is reached, and always in seeding only */
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
  const format = formatOf(input);
  /** Seeding only: no brackets, the seeding order is the result. */
  const seedingOnly = format.brackets === 'none';
  const categoryName = new Map(input.categories.map((c) => [c.id, c.name]));
  const bracketById = new Map(input.brackets.map((b) => [b.id, b]));
  const bracketLabel = (b: BracketSpec) => `${categoryName.get(b.categoryId) ?? b.categoryId} ${b.tierName}`;

  const rounds: RoundView[] = [];
  const blockers: string[] = [];
  const missing: DerivedEvent['missing'] = [];
  const teamName = new Map(input.teams.map((t) => [t.id, t.name]));
  /** Final rankings of every race in a locked, tie-free round. */
  const settled = new Map<string, RaceRanking>();
  /** bracketId → race ids that decide it (heats, final, winners/others; knockout: third place, and ko[stage][index]). */
  const raceIdsOf = new Map<string, {
    heats: string[]; final?: string; winners?: string; others?: string; third?: string; ko?: Record<number, Record<number, string>>;
  }>();
  const raceById = new Map<string, RaceView>();
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
    if (spec.kind !== 'seeding' && !seedingOnly && members === null) {
      seedRank = computeSeedRank();
      members = progress.bracketMembers ? new Map(Object.entries(progress.bracketMembers)) : computeMembers(seedRank);
    }
    if (spec.kind !== 'seeding' && seedingOnly) seedRank ??= settledSeedRank();

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

  if (seedingOnly) seedRank ??= settledSeedRank();
  // Knockout with no round after seeding (no bracket has two teams, and no Grand Championship): the brackets are
  // drawn once every seeding round is finished and settled, so a bracket of one team has its winner.
  if (format.brackets === 'knockout' && members === null && open && seedingRounds.length > 0) {
    seedRank = computeSeedRank();
    members = progress.bracketMembers ? new Map(Object.entries(progress.bracketMembers)) : computeMembers(seedRank);
  }
  const standings = computeStandings();
  return {
    rounds,
    seedRank,
    standings,
    categoryWinners: Object.fromEntries(input.categories.map((c) => [c.id, standings[c.id]?.[0] ?? null])),
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
    raceById.set(race.id, race);
    if (race.role === 'grand') grandRaceId = race.id;
    if (!race.bracketId) return;
    const ids = raceIdsOf.get(race.bracketId) ?? { heats: [] };
    raceIdsOf.set(race.bracketId, ids);
    if (race.role === 'heat') ids.heats.push(race.id);
    else if (race.role === 'final' || race.role === 'winners' || race.role === 'others' || race.role === 'third') ids[race.role] = race.id;
    else if (race.role === 'ko') {
      // A knockout race is known by its stage and number, the end of its id: …:ko{stage}-{index}.
      const m = /:ko(\d+)-(\d+)$/.exec(race.id);
      if (m) ((ids.ko ??= {})[Number(m[1])] ??= {})[Number(m[2])] = race.id;
    }
  }

  /**
   * A knockout bracket's races in `stage`. Entrants come from the draw (knockoutDraw) of the bracket's teams in
   * seed order: the first stage races the seeds drawn together; a later match races the teams that came out of
   * its two feeding matches, each the winner of a settled race or the team that had a bye. The final stage is
   * the final and, when both semi-finals were raced, the third-place race between their losers.
   */
  function knockoutDrafts(r: string, bracket: BracketSpec, seeded: string[], stage: number): Draft[] {
    const draw = knockoutDraw(seeded.length);
    const stages = draw.length;
    const matches = (draw[stages - stage] ?? []).filter((m) => m.index !== null);
    const ids = raceIdsOf.get(bracket.id);
    const seedOf = new Map(seeded.map((id, i) => [id, i]));
    const present = (list: (string | null | undefined)[]) => list.filter((id): id is string => typeof id === 'string');
    /** The team that came out of a match in `place` (0 = it won and goes on, 1 = it lost); a bye has only a winner. */
    const from = (m: KnockoutMatch, place: 0 | 1): string | null => {
      if (m.index === null) {
        const seed = m.seeds?.find((s) => s !== null);
        return place === 0 && seed ? seeded[seed - 1] ?? null : null;
      }
      const raceId = ids?.ko?.[m.stage]?.[m.index];
      return (raceId ? settled.get(raceId)?.order[place] : null) ?? null;
    };
    const feeders = (m: KnockoutMatch) => (draw[stages - m.stage - 1] ?? []).slice(2 * m.position - 2, 2 * m.position);
    const entrants = (m: KnockoutMatch) =>
      present(m.seeds ? m.seeds.map((s) => (s === null ? null : seeded[s - 1])) : feeders(m).map((f) => from(f, 0)));
    const draft = (suffix: string, name: string, role: RaceRole, teams: string[]): Draft => ({
      id: `${r}:${bracket.id}:${suffix}`,
      label: `${bracketLabel(bracket)} · ${name}`,
      bracketId: bracket.id,
      role,
      teams,
      fallbackOrder: [...teams].sort((a, b) => seedOf.get(a)! - seedOf.get(b)!),
    });
    if (stage > 1) {
      return matches.map((m) => draft(`ko${stage}-${m.index}`, knockoutRaceName(stage, stages - stage + 1, m.index!, matches.length), 'ko', entrants(m)));
    }
    return matches.flatMap((final) => [
      draft('final', 'Final', 'final', entrants(final)),
      ...(hasThirdPlace(seeded.length) ? [draft('third', 'Third place', 'third', present(feeders(final).map((f) => from(f, 1))))] : []),
    ]);
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
        if (seedingOnly) return input.teams.filter((t) => t.categoryId === c.id && seedRank?.[t.id] === 1).map((t) => t.id);
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
      if (spec.kind === 'knockout') return knockoutDrafts(r, bracket, seeded, spec.stage);
      if (spec.kind === 'finals') {
        return [{ ...base, id: `${r}:${bracketId}:final`, label: `${bracketLabel(bracket)} · Final`, role: 'final', teams: seeded }];
      }
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
    const run = (n: number) => {
      const out: Record<string, EventProgress['results'][number][string] | undefined> = {};
      for (const spec of seedingRounds.filter((s) => s.run === n)) {
        const group = input.groups.find((g) => g.id === spec.groupId);
        for (const teamId of group?.teamIds ?? []) out[teamId] = progress.results[spec.round]?.[teamId];
      }
      return out;
    };
    return rankSeeding(input.teams, Array.from({ length: format.seedingRuns }, (_, i) => run(i + 1)), format.seedingRank);
  }

  /**
   * Seeding only: the seed rank once every seeding round is locked and none of them is missing a result
   * (a seeding race has one team, so it cannot tie); null before that. Seeding rounds come first in the plan,
   * so by the first later round, and after the last round, `missing` already covers all of them.
   */
  function settledSeedRank(): Record<string, number> | null {
    const done = seedingRounds.length > 0
      && seedingRounds.every((s) => s.round <= progress.finishedRounds && !missing.some((m) => m.round === s.round));
    return done ? computeSeedRank() : null;
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
    if (format.brackets === 'knockout') return knockoutOrder(bracketId);
    const ids = raceIdsOf.get(bracketId);
    if (!ids) return null;
    if (ids.final) return settled.get(ids.final)?.order ?? null;
    const winners = ids.winners ? settled.get(ids.winners) : undefined;
    const others = ids.others ? settled.get(ids.others) : undefined;
    return winners && others ? [...winners.order, ...others.order] : null;
  }

  /**
   * A knockout bracket's final order, or null while any of its races is not settled: the final's order (1st,
   * 2nd), the third-place race's order (3rd, 4th), then for each earlier stage, the latest first, the teams
   * that raced in it and not in the stage after it, by their official time in that stage (finishers first,
   * then DNF, then DNS; equal at the hundredth by seed). Who went on is read from the races as they were opened,
   * so every team is placed exactly once even after a late correction. A bracket of one team is won by default.
   */
  function knockoutOrder(bracketId: string): string[] | null {
    const seeded = members?.get(bracketId) ?? [];
    if (seeded.length < 2) return seeded.length ? [...seeded] : null;
    const ids = raceIdsOf.get(bracketId);
    const race = (id: string | undefined) => (id && settled.has(id) ? raceById.get(id) : undefined);
    const final = race(ids?.final);
    const third = race(ids?.third);
    if (!final || (hasThirdPlace(seeded.length) && !third)) return null;
    const order = [...settled.get(final.id)!.order, ...(third ? settled.get(third.id)!.order : [])];
    let wentOn = new Set(order);
    const draw = knockoutDraw(seeded.length);
    for (let stage = 2; stage <= draw.length; stage++) {
      const races = draw[draw.length - stage]!.flatMap((m) => (m.index === null ? [] : [race(ids?.ko?.[stage]?.[m.index])]));
      if (races.some((x) => !x)) return null;
      const raced = (races as RaceView[]).flatMap((x) => x.entrants.map(({ teamId }) => ({ teamId, result: progress.results[x.round]?.[teamId] })));
      order.push(...rankRace(raced.filter((x) => !wentOn.has(x.teamId)), { fallbackOrder: seeded }).order);
      wentOn = new Set(raced.map((x) => x.teamId));
    }
    return order;
  }

  function bracketWinner(bracketId: string): string | null {
    return bracketOrder(bracketId)?.[0] ?? null;
  }

  function computeStandings(): Record<string, (string | null)[]> {
    const standings: Record<string, (string | null)[]> = {};
    for (const c of input.categories) {
      const n = input.teams.filter((t) => t.categoryId === c.id).length;
      const places: (string | null)[] = Array.from({ length: n }, () => null);
      if (seedingOnly) {
        const rank = seedRank;
        if (rank) input.teams.filter((t) => t.categoryId === c.id).forEach((t) => (places[rank[t.id]! - 1] = t.id));
        standings[c.id] = places;
        continue;
      }
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
