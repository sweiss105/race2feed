import { deriveEvent, formatOf, officialMs, seedingScore, type DerivedEvent, type EntryResult, type EventInput, type EventProgress } from '@race2feed/engine';
import type { LiveEvent } from './model';

type Fact = { at: number; result: Omit<EntryResult, 'penaltiesMs'> | null };

const key = (round: number, teamId: string) => `${round}\u0000${teamId}`;

/** Every finish tap and console entry per round and team, in stored order. */
function collectFacts(e: LiveEvent): Map<string, Fact[]> {
  const facts = new Map<string, Fact[]>();
  const push = (k: string, f: Fact) => facts.set(k, [...(facts.get(k) ?? []), f]);
  for (const tap of e.taps) {
    if (tap.removedAt !== null || tap.kind !== 'finish' || !Number.isFinite(tap.elapsedMs)) continue;
    push(key(tap.round, tap.teamId), { at: tap.createdAt, result: { status: 'finished', rawMs: tap.elapsedMs as number } });
  }
  for (const o of e.overrides) {
    const k = key(o.round, o.teamId);
    if (o.set.kind === 'clear') push(k, { at: o.at, result: null });
    else if (o.set.kind === 'status') push(k, { at: o.at, result: { status: o.set.status, rawMs: null } });
    else if (Number.isFinite(o.set.rawMs)) push(k, { at: o.at, result: { status: 'finished', rawMs: o.set.rawMs } });
  }
  return facts;
}

/** The fact that decides: the latest one. */
const latest = (list: Fact[]): Fact | undefined => [...list].sort((a, b) => a.at - b.at).at(-1);

/** When each team's current result was recorded (its deciding finish tap or console entry): round → teamId → time. */
export function recordedAt(e: LiveEvent): Record<number, Record<string, number>> {
  const out: Record<number, Record<string, number>> = {};
  for (const [k, list] of collectFacts(e)) {
    const last = latest(list);
    if (!last?.result) continue;
    const [roundText, teamId] = k.split('\u0000') as [string, string];
    (out[Number(roundText)] ??= {})[teamId] = last.at;
  }
  return out;
}

/**
 * Results per round and team. The latest fact (finish tap or override) decides
 * the status; penalties are the sum of the team's active penalty taps.
 */
export function buildProgress(e: LiveEvent): EventProgress {
  const facts = collectFacts(e);
  const penalties = new Map<string, number>();
  for (const tap of e.taps) {
    if (tap.removedAt !== null || tap.kind !== 'penalty') continue;
    const k = key(tap.round, tap.teamId);
    penalties.set(k, (penalties.get(k) ?? 0) + (tap.amountMs ?? 0));
  }

  // An approved DQ penalty disqualifies the team from that race, whatever its time.
  const dq = new Set<string>();
  for (const tap of e.taps) {
    if (tap.kind === 'penalty' && tap.removedAt === null && tap.review?.status === 'approved' && tap.review.dq) dq.add(key(tap.round, tap.teamId));
  }

  const results: EventProgress['results'] = {};
  for (const k of dq) if (!facts.has(k)) facts.set(k, []);
  for (const [k, list] of facts) {
    if (dq.has(k)) {
      const [roundText, teamId] = k.split('\u0000') as [string, string];
      (results[Number(roundText)] ??= {})[teamId] = { status: 'dnf', rawMs: null, penaltiesMs: penalties.get(k) ?? 0 };
      continue;
    }
    const last = latest(list);
    if (!last?.result) continue;
    const [roundText, teamId] = k.split('\u0000') as [string, string];
    const round = Number(roundText);
    (results[round] ??= {})[teamId] = { ...last.result, penaltiesMs: penalties.get(k) ?? 0 };
  }
  return {
    finishedRounds: e.finishedRounds,
    results,
    tieDecisions: e.tieDecisions,
    ...(e.lineups ? { lineups: e.lineups } : {}),
    ...(e.bracketMembers ? { bracketMembers: e.bracketMembers } : {}),
  };
}

export function derive(e: LiveEvent): DerivedEvent {
  return deriveEvent(e.setup, buildProgress(e));
}

export function teamsInRound(d: DerivedEvent, round: number): { teamId: string; table: number }[] {
  return d.rounds[round - 1]?.races.flatMap((r) => r.entrants) ?? [];
}

/** Each team's summed official time over the seeding rounds that have results so far. */
export function seedTotals(d: DerivedEvent, results: Record<number, Record<string, EntryResult>>): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const r of d.rounds) {
    if (r.spec.kind !== 'seeding') continue;
    for (const [teamId, result] of Object.entries(results[r.spec.round] ?? {})) {
      const ms = officialMs(result);
      if (ms !== null) totals[teamId] = (totals[teamId] ?? 0) + ms;
    }
  }
  return totals;
}

/**
 * Each team's official time per seeding run, in run order: one entry per run of the format, null where the team
 * has no time (not raced yet, cleared, DNF or DNS). Every team of the event has an entry.
 */
export function seedRuns(setup: EventInput, d: DerivedEvent, results: Record<number, Record<string, EntryResult>>): Record<string, (number | null)[]> {
  const count = formatOf(setup).seedingRuns;
  const runs: Record<string, (number | null)[]> = Object.fromEntries(setup.teams.map((t) => [t.id, Array.from({ length: count }, () => null)]));
  for (const { spec } of d.rounds) {
    if (spec.kind !== 'seeding') continue;
    for (const teamId of setup.groups.find((g) => g.id === spec.groupId)?.teamIds ?? []) {
      const result = results[spec.round]?.[teamId];
      if (runs[teamId] && result) runs[teamId]![spec.run - 1] = officialMs(result);
    }
  }
  return runs;
}

/** The value each team is ranked on in seeding under the event's rule (the engine's seedingScore); null with nothing to count. */
export function seedScores(setup: EventInput, runs: Record<string, (number | null)[]>): Record<string, number | null> {
  const rule = formatOf(setup).seedingRank;
  return Object.fromEntries(Object.entries(runs).map(([teamId, times]) => [teamId, seedingScore(times, rule)]));
}
