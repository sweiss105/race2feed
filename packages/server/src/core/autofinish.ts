import type { LiveEvent } from './model';
import { buildProgress, derive, teamsInRound } from './results';

export const DEFAULT_AUTO_FINISH_MS = 30_000;

/** How long after the last result the round finishes by itself; 0 when auto-finish is off. Never shorter than the referee undo window. */
export function autoFinishDelay(e: LiveEvent): number {
  const ms = e.settings.autoFinishMs ?? DEFAULT_AUTO_FINISH_MS;
  return ms === 0 ? 0 : Math.max(ms, e.settings.undoWindowMs);
}

function allTeamsIn(e: LiveEvent): boolean {
  const current = e.round.current;
  const results = buildProgress(e).results[current] ?? {};
  return teamsInRound(derive(e), current).every((t) => results[t.teamId]);
}

/**
 * Sets `round.autoFinishAt` on the result of a command: cleared unless the round is running with every team in,
 * restarted when taps or results changed (or no time is set yet), otherwise left as it was.
 */
export function withAutoFinish(before: LiveEvent, after: LiveEvent, now: number): LiveEvent {
  const delay = autoFinishDelay(after);
  let at: number | null;
  if (after.round.phase !== 'running' || delay === 0 || !allTeamsIn(after)) at = null;
  else if (after.taps !== before.taps || after.overrides !== before.overrides || after.round.autoFinishAt == null) at = now + delay;
  else return after;
  // Events stored before auto-finish existed keep their round untouched until a countdown starts.
  if (at === (after.round.autoFinishAt ?? null)) return after;
  return { ...after, round: { ...after.round, autoFinishAt: at } };
}

/** The hub's single alarm: the earlier of a paced phone update and the auto-finish time. */
export function nextAlarm(publicDue: number | null, autoFinishAt: number | null | undefined): number | null {
  const times = [publicDue, autoFinishAt].filter((t): t is number => typeof t === 'number');
  return times.length ? Math.min(...times) : null;
}
