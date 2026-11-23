import { fail, type CommandResult, type LiveEvent } from './model';
import { derive } from './results';

const matchups = (e: LiveEvent) =>
  derive(e).rounds.map((r) => JSON.stringify(r.races.map((race) => race.entrants.map((x) => [x.teamId, x.table]))));

/**
 * Guards a change to an already-raced round. Once a later round has been opened the change
 * needs `confirm`, and the reply lists which later rounds' matchups it would change. It is
 * refused outright if it would reshuffle (or block) the round that is open or running.
 */
export function checkCorrection(before: LiveEvent, after: LiveEvent, round: number, confirm: boolean | undefined): CommandResult | null {
  const current = before.round.current;
  if (round >= current) return null;
  const laterRounds = Array.from({ length: current - round }, (_, i) => round + 1 + i);
  const [was, now] = [matchups(before), matchups(after)];
  const changedRounds = laterRounds.filter((r) => was[r - 1] !== now[r - 1]);
  if (!confirm) {
    return fail('unlock_required', 'Later rounds have already been opened; confirm to change this round.', { laterRounds, changedRounds });
  }
  const live = before.round.phase === 'open' || before.round.phase === 'running';
  if (live && changedRounds.includes(current)) {
    return fail('changes_current_round', 'This would change who is racing in the current round. Finish the round first.', { changedRounds });
  }
  return null;
}
