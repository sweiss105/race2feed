import type { ControlView } from './types';

export interface RaceAction {
  label: string;
  kind: 'open' | 'start' | 'finish' | 'showChampion' | 'hideChampion';
  enabled: boolean;
  /** Pressing it now will work and is the expected next step. Never true while `enabled` is false. */
  pulse: boolean;
  status: string;
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The Race page's one button and status line: the next step, and what the room is waiting for. */
export function raceAction(view: ControlView, now: number): RaceAction {
  const { round } = view;
  const act = (label: string, kind: RaceAction['kind'], enabled: boolean, pulse: boolean, status: string): RaceAction =>
    ({ label, kind, enabled, pulse: enabled && pulse, status });

  if (view.championShown) return act('Hide champion', 'hideChampion', true, false, 'Champion is showing');

  if (round.phase === 'running') {
    const out = view.outstanding.length;
    if (out) return act('Finish now', 'finish', false, false, `Racing — waiting on ${count(out, 'team', 'teams')}`);
    if (round.autoFinishAt !== null) {
      const seconds = Math.max(0, Math.ceil((round.autoFinishAt - now) / 1000));
      return act('Finish now', 'finish', true, false, `All teams in — finishing in ${seconds} s`);
    }
    return act('Finish now', 'finish', true, true, 'All teams in');
  }

  if (round.phase === 'open') {
    const notReady = Object.values(view.stations).filter((s) => !s.excluded && !s.ready).length;
    if (notReady) return act('Start', 'start', false, false, `Waiting on ${count(notReady, 'table', 'tables')} to be ready`);
    return act('Start', 'start', true, true, 'All tables ready');
  }

  const lastDone = round.phase === 'finished' && view.rounds.length > 0 && round.current >= view.rounds.length;
  const next = round.current + 1;
  const [label, kind] = lastDone ? ['Show champion', 'showChampion' as const] : [`Open round ${next}`, 'open' as const];

  const pending = view.penaltyReviews.filter((p) => p.status === 'pending').length;
  if (pending) return act(label, kind, false, false, `Waiting on ${count(pending, 'penalty', 'penalties')} to be reviewed`);
  if (view.ties.length || view.blockers.length) return act(label, kind, false, false, 'Waiting on a tie to be decided');
  if (lastDone) return act(label, kind, true, true, 'Event complete');
  // The server refuses to open a round until setup is locked.
  return act(label, kind, view.setupLocked, true, round.current ? `Ready to open round ${next}` : 'Not started');
}
