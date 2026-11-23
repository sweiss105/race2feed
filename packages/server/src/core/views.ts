import { officialMs, stationOfTable, tablesOfStation, type DerivedEvent, type EntryResult } from '@race2feed/engine';
import type { LiveEvent, ProjectorScreen } from './model';
import { buildProgress, teamsInRound } from './results';

export function projectorScreen(e: LiveEvent, d: DerivedEvent): ProjectorScreen {
  if (e.projectorPin) return e.projectorPin;
  switch (e.round.phase) {
    case 'idle': return 'welcome';
    case 'open': return 'tables';
    case 'running': return 'clock';
    case 'finished': {
      const kind = d.rounds[e.round.current - 1]?.spec.kind;
      if (kind === 'seeding') return 'seeding-results';
      if (kind === 'grand') return 'champion';
      return 'brackets';
    }
  }
}

const roundState = (e: LiveEvent) => ({ ...e.round });

function racesOf(d: DerivedEvent, round: number, results: Record<string, EntryResult>) {
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
      };
    }),
  }));
}

/** Matchups are published when a round is opened, not before (spec §4); race control sees them early. */
export function publicView(e: LiveEvent, d: DerivedEvent, opts: { includeUnopened?: boolean } = {}) {
  const progress = buildProgress(e);
  const seedTotalsMs: Record<string, number> = {};
  for (const r of d.rounds) {
    if (r.spec.kind !== 'seeding') continue;
    for (const [teamId, result] of Object.entries(progress.results[r.spec.round] ?? {})) {
      const ms = officialMs(result);
      if (ms !== null) seedTotalsMs[teamId] = (seedTotalsMs[teamId] ?? 0) + ms;
    }
  }
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
        ? racesOf(d, r.spec.round, progress.results[r.spec.round] ?? {})
        : [],
    })),
    seedRank: d.seedRank,
    seedTotalsMs,
    standings: d.standings,
    grandChampion: d.grandChampion,
    bagTotal: e.bagTotal,
    projector: projectorScreen(e, d),
  };
}

/** The small live update sent to participant phones while a round is open or running. */
export function publicRoundUpdate(e: LiveEvent, d: DerivedEvent) {
  const results = buildProgress(e).results[e.round.current] ?? {};
  return { round: roundState(e), projector: projectorScreen(e, d), races: racesOf(d, e.round.current, results) };
}

function outstanding(e: LiveEvent, d: DerivedEvent) {
  if (e.round.current === 0 || e.round.phase === 'finished' || e.round.phase === 'idle') return [];
  const results = buildProgress(e).results[e.round.current] ?? {};
  return teamsInRound(d, e.round.current).filter((t) => !results[t.teamId]);
}

export function refereeView(e: LiveEvent, d: DerivedEvent, station: number) {
  const tables = tablesOfStation(station, e.setup.tableCount);
  const results = buildProgress(e).results[e.round.current] ?? {};
  const name = new Map(e.setup.teams.map((t) => [t.id, t.name]));
  const teams = teamsInRound(d, e.round.current)
    .filter((t) => stationOfTable(t.table) === station)
    .sort((a, b) => a.table - b.table)
    .map(({ teamId, table }) => ({
      teamId,
      name: name.get(teamId) ?? teamId,
      table,
      result: results[teamId] ?? null,
      taps: e.taps
        .filter((t) => t.round === e.round.current && t.teamId === teamId)
        .map(({ id, kind, createdAt, removedAt }) => ({ id, kind, createdAt, removedAt })),
    }));
  const s = e.stations[station] ?? { ready: false, excluded: true };
  return {
    round: roundState(e),
    settings: { ...e.settings },
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
    setup: e.setup,
    taps: e.taps,
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
    readyCount: active.filter((s) => s.ready).length,
    stationCount: active.length,
    outstanding: outstanding(e, d).length,
    penaltiesEnabled: e.settings.penaltiesEnabled,
    projector: projectorScreen(e, d),
  };
}
