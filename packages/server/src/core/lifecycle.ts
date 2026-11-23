import { stationCount, stationOfTable } from '@race2feed/engine';
import { done, fail, type CommandResult, type Ctx, type LifecycleCommand, type LiveEvent } from './model';
import { buildProgress, derive, teamsInRound } from './results';
import { checkCorrection } from './corrections';

export function handleLifecycle(e: LiveEvent, cmd: LifecycleCommand, ctx: Ctx): CommandResult {
  const ok = (event: LiveEvent) => done(event, cmd, ctx);

  switch (cmd.type) {
    case 'openNextRound': {
      if (!e.setupLocked) return fail('setup_not_locked', 'Lock the setup before opening a round.');
      if (e.round.phase === 'open' || e.round.phase === 'running') {
        return fail('round_in_progress', 'Finish the current round first.');
      }
      const pending = e.taps
        .filter((t) => t.kind === 'penalty' && t.removedAt === null && t.review?.status === 'pending' && t.round <= e.round.current)
        .map((t) => ({ tapId: t.id, round: t.round, teamId: t.teamId }));
      if (pending.length) return fail('penalties_pending', `${pending.length} penalt${pending.length === 1 ? 'y needs' : 'ies need'} a decision first.`, pending);
      const d = derive(e);
      const next = d.rounds[e.round.current];
      if (!next) return fail('event_complete', 'Every round has been raced.');
      if (next.status !== 'ready') return fail('blocked', 'The next round is waiting on a decision.', d.blockers);
      const busy = new Set(next.races.flatMap((r) => r.entrants.map((x) => stationOfTable(x.table))));
      const stations: LiveEvent['stations'] = {};
      for (let s = 1; s <= stationCount(e.setup.tableCount); s++) stations[s] = { ready: false, excluded: !busy.has(s) };
      return ok({
        ...e,
        round: { current: e.round.current + 1, phase: 'open', startedAt: null, finishedAt: null },
        stations,
      });
    }
    case 'stationReady': {
      if (e.round.phase !== 'open') return fail('round_not_open', 'There is no round waiting to start.');
      const s = ctx.actor.station;
      const station = s === undefined ? undefined : e.stations[s];
      if (s === undefined || !station) return fail('not_your_station', 'This device is not paired to a station.');
      return ok({ ...e, stations: { ...e.stations, [s]: { ...station, ready: true } } });
    }
    case 'overrideStation': {
      const station = e.stations[cmd.station];
      if (!station) return fail('not_found', `There is no station ${cmd.station} in this round.`);
      const next = cmd.state === 'excluded'
        ? { ready: false, excluded: true }
        : { ready: cmd.state === 'ready', excluded: false };
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
      const bags = typeof cmd.bagTotal === 'string' ? cmd.bagTotal.trim().slice(0, 40) : '';
      return ok({ ...e, championShown: true, bagTotal: bags || e.bagTotal });
    }
    case 'hideChampion':
      return ok({ ...e, championShown: false });
  }
}
