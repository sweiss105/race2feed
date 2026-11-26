import { stationCount, stationOfTable, tablesOfStation } from '@race2feed/engine';
import { done, fail, perStation, readyTablesOf, type CommandResult, type Ctx, type LifecycleCommand, type LiveEvent, type Station } from './model';
import { buildProgress, derive, teamsInRound } from './results';
import { checkCorrection } from './corrections';
import { saveLineup } from './lineups';
import { assignmentOf, assignRound, rotationOn, tablesFor } from './rotation';

/** Referee penalties still waiting for race control, in rounds raced so far. */
export function pendingPenalties(e: LiveEvent) {
  return e.taps
    .filter((t) => t.kind === 'penalty' && t.removedAt === null && t.review?.status === 'pending' && t.round <= e.round.current)
    .map((t) => ({ tapId: t.id, round: t.round, teamId: t.teamId }));
}

const pendingFail = (pending: ReturnType<typeof pendingPenalties>) =>
  fail('penalties_pending', `${pending.length} penalt${pending.length === 1 ? 'y needs' : 'ies need'} a decision first.`, pending);

/** The station's tables that have a team in the current round. */
function occupiedTables(e: LiveEvent, station: number): number[] {
  const tables = new Set(teamsInRound(derive(e), e.round.current).map((t) => t.table));
  return tablesOfStation(station, e.setup.tableCount, perStation(e)).filter((t) => tables.has(t));
}

/** A not-excluded station with these ready tables; ready once every occupied table is (`empty` when it has none). */
function withReadyTables(occupied: number[], readyTables: number[], empty = false): Station {
  const sorted = [...new Set(readyTables)].sort((a, b) => a - b);
  return { ready: occupied.length ? occupied.every((t) => sorted.includes(t)) : empty, excluded: false, readyTables: sorted };
}

export function handleLifecycle(e: LiveEvent, cmd: LifecycleCommand, ctx: Ctx): CommandResult {
  const ok = (event: LiveEvent) => done(event, cmd, ctx);

  switch (cmd.type) {
    case 'openNextRound': {
      if (!e.setupLocked) return fail('setup_not_locked', 'Lock the setup before opening a round.');
      if (e.round.phase === 'open' || e.round.phase === 'running') {
        return fail('round_in_progress', 'Finish the current round first.');
      }
      const pending = pendingPenalties(e);
      if (pending.length) return pendingFail(pending);
      const d = derive(e);
      const next = d.rounds[e.round.current];
      if (!next) return fail('event_complete', 'Every round has been raced.');
      if (next.status !== 'ready') return fail('blocked', 'The next round is waiting on a decision.', d.blockers);
      const busy = new Set(next.races.flatMap((r) => r.entrants.map((x) => stationOfTable(x.table, perStation(e)))));
      const stations: LiveEvent['stations'] = {};
      for (let s = 1; s <= stationCount(e.setup.tableCount, perStation(e)); s++) stations[s] = { ready: false, excluded: !busy.has(s), readyTables: [] };
      const round = e.round.current + 1;
      const opened = saveLineup({ ...e, round: { current: round, phase: 'open', startedAt: null, finishedAt: null }, stations }, round);
      if (!rotationOn(opened)) return ok(opened);
      return ok({ ...opened, assignments: { ...opened.assignments, [round]: assignRound(opened, derive(opened), round, ctx.roster ?? []) } });
    }
    case 'stationReady': {
      if (e.round.phase !== 'open') return fail('round_not_open', 'There is no round waiting to start.');
      // The referee's tables this round: the saved assignment's, or the home station's with rotation off.
      const s = assignmentOf(e, e.round.current, ctx.actor.deviceId)?.station ?? ctx.actor.station;
      const station = s === undefined ? undefined : e.stations[s];
      const mine = tablesFor(e, ctx.actor, e.round.current);
      if (s === undefined || !station || !mine.length) return fail('not_your_station', 'This device has no tables this round.');
      const occupied = occupiedTables(e, s);
      const already = readyTablesOf(station, tablesOfStation(s, e.setup.tableCount, perStation(e)));
      if (cmd.table === undefined) {
        // An older tablet page: one Ready for all of the referee's tables. Ready once every occupied table is
        // (in a split final the other referee readies the other table).
        const readyTables = [...new Set([...already, ...occupied.filter((t) => mine.includes(t))])].sort((a, b) => a - b);
        return ok({ ...e, stations: { ...e.stations, [s]: { ...station, ready: occupied.every((t) => readyTables.includes(t)), readyTables } } });
      }
      if (!occupied.includes(cmd.table) || !mine.includes(cmd.table)) return fail('not_your_table', 'That table is not yours this round.');
      return ok({ ...e, stations: { ...e.stations, [s]: { ...withReadyTables(occupied, [...already, cmd.table]), excluded: station.excluded } } });
    }
    case 'swapReferees': {
      if (e.round.phase !== 'open') return fail('round_not_open', 'Referees can be swapped only before the start.');
      const round = e.round.current;
      const saved = e.assignments?.[round];
      if (!saved) return fail('rotation_off', 'Referees are not rotating in this round.');
      if (typeof cmd.a !== 'string' || typeof cmd.b !== 'string' || cmd.a === cmd.b) return fail('invalid', 'Choose two different referees.');
      const paired = (id: string) => ctx.roster?.find((r) => r.deviceId === id);
      const a = paired(cmd.a);
      const b = paired(cmd.b);
      if (!a || !b) return fail('not_found', 'That referee is not paired to this event.');
      const placeOfA = saved.find((x) => x.deviceId === a.deviceId);
      const placeOfB = saved.find((x) => x.deviceId === b.deviceId);
      if (!placeOfA && !placeOfB) return fail('not_assigned', 'Neither referee has tables this round.');
      // Each place (station and tables) goes to the other referee; a referee without one leaves the other without.
      const assignments = saved.flatMap((x) =>
        x === placeOfA ? [{ ...x, deviceId: b.deviceId, name: b.name }]
          : x === placeOfB ? [{ ...x, deviceId: a.deviceId, name: a.name }] : [x]);
      // A Ready at those tables was given by the referee who has now left them.
      const stations = { ...e.stations };
      for (const place of [placeOfA, placeOfB]) {
        const st = place && stations[place.station];
        if (!place || !st) continue;
        const kept = readyTablesOf(st, tablesOfStation(place.station, e.setup.tableCount, perStation(e))).filter((t) => !place.tables.includes(t));
        stations[place.station] = { ...withReadyTables(occupiedTables(e, place.station), kept), excluded: st.excluded };
      }
      return ok({ ...e, stations, assignments: { ...e.assignments, [round]: assignments } });
    }
    case 'overrideStation': {
      const station = e.stations[cmd.station];
      if (!station) return fail('not_found', `There is no station ${cmd.station} in this round.`);
      const next: Station = cmd.state === 'excluded'
        ? { ready: false, excluded: true, readyTables: [] }
        : withReadyTables(occupiedTables(e, cmd.station), cmd.state === 'ready' ? occupiedTables(e, cmd.station) : [], cmd.state === 'ready');
      return ok({ ...e, stations: { ...e.stations, [cmd.station]: next } });
    }
    case 'startRace': {
      if (e.round.phase === 'running') return fail('already_running', 'The race is already running.');
      if (e.round.phase !== 'open') return fail('round_not_open', 'Open a round before starting.');
      const notReady = Object.entries(e.stations)
        .filter(([, s]) => !s.excluded && !s.ready)
        .map(([n]) => Number(n));
      if (notReady.length) return fail('stations_not_ready', `${notReady.length} station(s) not ready.`, notReady);
      return ok({ ...e, round: { ...e.round, phase: 'running', startedAt: ctx.now } });
    }
    case 'finishRace': {
      if (e.round.phase !== 'running') return fail('round_not_running', 'No race is running.');
      const results = buildProgress(e).results[e.round.current] ?? {};
      const outstanding = teamsInRound(derive(e), e.round.current).filter((t) => !results[t.teamId]);
      if (outstanding.length) return fail('teams_outstanding', `${outstanding.length} team(s) have no result.`, outstanding);
      return ok({
        ...e,
        round: { ...e.round, phase: 'finished', finishedAt: ctx.now },
        finishedRounds: e.round.current,
      });
    }
    case 'decideTie': {
      if (!Array.isArray(cmd.order) || !cmd.order.every((id) => typeof id === 'string')) {
        return fail('invalid', 'A tie decision is a list of team ids.');
      }
      const race = derive(e).rounds.flatMap((r) => r.races).find((r) => r.id === cmd.raceId);
      const sameTeams = (g: string[]) =>
        g.length === cmd.order.length && new Set(cmd.order).size === g.length && g.every((id) => cmd.order.includes(id));
      const previous = e.tieDecisions[cmd.raceId];
      const group = race?.ranking.ties.find(sameTeams) ?? (previous && sameTeams(previous) ? previous : undefined);
      if (!race || !group) return fail('not_a_tie', 'That order does not match a tie in this race.');
      const after = { ...e, tieDecisions: { ...e.tieDecisions, [cmd.raceId]: cmd.order } };
      return checkCorrection(e, after, race.round, cmd.confirmUnlock) ?? ok(after);
    }
    case 'pinProjector':
      return ok({ ...e, projectorPin: cmd.screen });
    case 'showChampion': {
      const rounds = derive(e).rounds.length;
      if (e.round.phase !== 'finished' || e.round.current !== rounds || rounds === 0) {
        return fail('not_finished', 'Show the champion once the last round is finished.');
      }
      const pending = pendingPenalties(e);
      if (pending.length) return pendingFail(pending);
      const bags = typeof cmd.bagTotal === 'string' ? cmd.bagTotal.trim().slice(0, 40) : '';
      return ok({ ...e, championShown: true, bagTotal: bags || e.bagTotal });
    }
    case 'hideChampion':
      return ok({ ...e, championShown: false });
  }
}
