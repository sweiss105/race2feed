import { officialMs, stationOfTable, tablesOfStation, type DerivedEvent, type EntryResult } from '@race2feed/engine';
import { perStation, type LiveEvent, type ProjectorScreen } from './model';
import { buildProgress, teamsInRound } from './results';
import { reasonsOf, reviewOf } from './reasons';
import { pendingPenalties } from './lifecycle';

interface PenaltyInfo { notes: string[]; pending: boolean; dq: string | null }

/** Per round and team: approved reason names, whether any penalty awaits review, and a DQ reason. */
function penaltyIndex(e: LiveEvent): Map<string, PenaltyInfo> {
  const index = new Map<string, PenaltyInfo>();
  for (const t of e.taps) {
    if (t.kind !== 'penalty' || t.removedAt !== null) continue;
    const k = `${t.round}:${t.teamId}`;
    const info = index.get(k) ?? { notes: [], pending: false, dq: null };
    const review = reviewOf(t);
    if (review.status === 'pending') info.pending = true;
    else if (review.status === 'approved') {
      if (review.dq) info.dq = review.reasonName ?? 'Disqualified';
      else if (review.reasonName) info.notes.push(review.reasonName);
    }
    index.set(k, info);
  }
  return index;
}

export function projectorScreen(e: LiveEvent, d: DerivedEvent): ProjectorScreen {
  if (e.projectorPin) return e.projectorPin;
  if (e.championShown || e.endedAt) return 'champion';
  switch (e.round.phase) {
    case 'idle': return 'welcome';
    case 'open': return 'tables';
    case 'running': return 'clock';
    case 'finished': {
      const kind = d.rounds[e.round.current - 1]?.spec.kind;
      if (kind === 'seeding') return 'seeding-results';
      // The champion is announced only once no penalty can still change the result.
      if (kind === 'grand') return pendingPenalties(e).length === 0 ? 'champion' : 'brackets';
      return 'brackets';
    }
  }
}

const roundState = (e: LiveEvent) => ({ ...e.round, autoFinishAt: e.round.autoFinishAt ?? null });

function racesOf(d: DerivedEvent, round: number, results: Record<string, EntryResult>, pens: Map<string, PenaltyInfo>) {
  return (d.rounds[round - 1]?.races ?? []).map((race) => ({
    id: race.id,
    label: race.label,
    ...(race.bracketId ? { bracketId: race.bracketId } : {}),
    entrants: race.entrants.map(({ teamId, table }) => {
      const r = results[teamId];
      return {
        teamId,
        table,
        status: r?.status ?? 'pending',
        rawMs: r?.rawMs ?? null,
        penaltiesMs: r?.penaltiesMs ?? 0,
        officialMs: r ? officialMs(r) : null,
        place: r ? race.ranking.order.indexOf(teamId) + 1 : null,
        penaltyNotes: pens.get(`${round}:${teamId}`)?.notes ?? [],
        penaltyPending: pens.get(`${round}:${teamId}`)?.pending ?? false,
        dq: pens.get(`${round}:${teamId}`)?.dq ?? null,
      };
    }),
  }));
}

/** Each team's summed official time over the seeding rounds that have results so far. */
function seedTotals(d: DerivedEvent, results: Record<number, Record<string, EntryResult>>): Record<string, number> {
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

/** Matchups are published when a round is opened, not before (spec §4); race control sees them early. */
export function publicView(e: LiveEvent, d: DerivedEvent, opts: { includeUnopened?: boolean } = {}) {
  const progress = buildProgress(e);
  const pens = penaltyIndex(e);
  return {
    event: { id: e.id, name: e.name, date: e.date },
    categories: e.setup.categories,
    brackets: e.setup.brackets,
    teams: e.setup.teams.map(({ id, name, categoryId }) => ({ id, name, categoryId })),
    round: roundState(e),
    rounds: d.rounds.map((r) => ({
      round: r.spec.round,
      kind: r.spec.kind,
      status: r.status,
      races: opts.includeUnopened || r.spec.round <= e.round.current
        ? racesOf(d, r.spec.round, progress.results[r.spec.round] ?? {}, pens)
        : [],
    })),
    seedRank: d.seedRank,
    seedTotalsMs: seedTotals(d, progress.results),
    standings: d.standings,
    grandChampion: d.grandChampion,
    bagTotal: e.bagTotal,
    championShown: Boolean(e.championShown || e.endedAt),
    ended: Boolean(e.endedAt),
    projector: projectorScreen(e, d),
  };
}

/** The small live update sent to participant phones while a round is open or running. */
export function publicRoundUpdate(e: LiveEvent, d: DerivedEvent) {
  const all = buildProgress(e).results;
  return {
    round: roundState(e),
    projector: projectorScreen(e, d),
    races: racesOf(d, e.round.current, all[e.round.current] ?? {}, penaltyIndex(e)),
    seedTotalsMs: seedTotals(d, all),
  };
}

function outstanding(e: LiveEvent, d: DerivedEvent) {
  if (e.round.current === 0 || e.round.phase === 'finished' || e.round.phase === 'idle') return [];
  const results = buildProgress(e).results[e.round.current] ?? {};
  return teamsInRound(d, e.round.current).filter((t) => !results[t.teamId]);
}

export function refereeView(e: LiveEvent, d: DerivedEvent, station: number) {
  const tables = tablesOfStation(station, e.setup.tableCount, perStation(e));
  const results = buildProgress(e).results[e.round.current] ?? {};
  const name = new Map(e.setup.teams.map((t) => [t.id, t.name]));
  const pens = penaltyIndex(e);
  const teams = teamsInRound(d, e.round.current)
    .filter((t) => stationOfTable(t.table, perStation(e)) === station)
    .sort((a, b) => a.table - b.table)
    .map(({ teamId, table }) => ({
      teamId,
      name: name.get(teamId) ?? teamId,
      table,
      result: results[teamId] ?? null,
      dq: pens.get(`${e.round.current}:${teamId}`)?.dq ?? null,
      penaltyPending: pens.get(`${e.round.current}:${teamId}`)?.pending ?? false,
      taps: e.taps
        .filter((t) => t.round === e.round.current && t.teamId === teamId)
        .map((t) => {
          const review = reviewOf(t);
          return {
            id: t.id, clientTapId: t.clientTapId ?? null, kind: t.kind, source: t.source, createdAt: t.createdAt, removedAt: t.removedAt,
            review: { status: review.status, refereeReasonId: review.refereeReasonId ?? null, refereeNote: review.refereeNote ?? null },
          };
        }),
    }));
  const s = e.stations[station] ?? { ready: false, excluded: true };
  return {
    round: roundState(e),
    settings: { ...e.settings },
    reasons: reasonsOf(e),
    station: { number: station, tables, ready: s.ready, excluded: s.excluded },
    teams,
  };
}

export function controlView(e: LiveEvent, d: DerivedEvent, extras: { devices: unknown[]; audit: unknown[] }) {
  return {
    ...publicView(e, d, { includeUnopened: true }),
    stations: e.stations,
    settings: e.settings,
    setupLocked: e.setupLocked,
    projectorPin: e.projectorPin,
    setup: e.setup,
    taps: e.taps,
    penaltyReasons: reasonsOf(e),
    penaltyReviews: e.taps
      .filter((t) => t.kind === 'penalty' && t.source === 'referee' && !(t.removedAt !== null && reviewOf(t).status === 'pending'))
      .map((t) => {
        const r = reviewOf(t);
        return {
          tapId: t.id, round: t.round, teamId: t.teamId, status: r.status, amountMs: t.amountMs ?? 0,
          refereeReasonId: r.refereeReasonId ?? null, refereeNote: r.refereeNote ?? null, reasonId: r.reasonId ?? null, createdAt: t.createdAt,
          reasonName: r.reasonName ?? null, dq: Boolean(r.dq), removed: t.removedAt !== null,
        };
      })
      .reverse(),
    overrides: e.overrides,
    outstanding: outstanding(e, d),
    ties: d.rounds.flatMap((r) => r.races.filter((x) => x.ranking.ties.length).map((x) => ({ raceId: x.id, teams: x.ranking.ties }))),
    blockers: d.blockers,
    devices: extras.devices,
    audit: extras.audit,
  };
}

export function companionView(e: LiveEvent, d: DerivedEvent) {
  const active = Object.values(e.stations).filter((s) => !s.excluded);
  return {
    state: e.round.phase,
    round: e.round.current,
    startedAt: e.round.startedAt,
    autoFinishAt: e.round.autoFinishAt ?? null,
    readyCount: active.filter((s) => s.ready).length,
    stationCount: active.length,
    outstanding: outstanding(e, d).length,
    penaltiesEnabled: e.settings.penaltiesEnabled,
    projector: projectorScreen(e, d),
  };
}
