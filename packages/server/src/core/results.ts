import { deriveEvent, type DerivedEvent, type EntryResult, type EventProgress } from '@race2feed/engine';
import type { LiveEvent } from './model';

type Fact = { at: number; result: Omit<EntryResult, 'penaltiesMs'> | null };

/**
 * Results per round and team. The latest fact (finish tap or override) decides
 * the status; penalties are the sum of the team's active penalty taps.
 */
export function buildProgress(e: LiveEvent): EventProgress {
  const facts = new Map<string, Fact[]>();
  const penalties = new Map<string, number>();
  const key = (round: number, teamId: string) => `${round}\u0000${teamId}`;
  const push = (k: string, f: Fact) => facts.set(k, [...(facts.get(k) ?? []), f]);

  for (const tap of e.taps) {
    if (tap.removedAt !== null) continue;
    const k = key(tap.round, tap.teamId);
    if (tap.kind === 'penalty') penalties.set(k, (penalties.get(k) ?? 0) + (tap.amountMs ?? 0));
    else if (Number.isFinite(tap.elapsedMs)) push(k, { at: tap.createdAt, result: { status: 'finished', rawMs: tap.elapsedMs as number } });
  }
  for (const o of e.overrides) {
    const k = key(o.round, o.teamId);
    if (o.set.kind === 'clear') push(k, { at: o.at, result: null });
    else if (o.set.kind === 'status') push(k, { at: o.at, result: { status: o.set.status, rawMs: null } });
    else if (Number.isFinite(o.set.rawMs)) push(k, { at: o.at, result: { status: 'finished', rawMs: o.set.rawMs } });
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
    const last = [...list].sort((a, b) => a.at - b.at).at(-1)!;
    if (!last.result) continue;
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
