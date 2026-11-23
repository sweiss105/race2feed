import { fail, type CommandResult, type LiveEvent } from './model';
import { lineupOf } from './lineups';

/** Who races where in each race, for comparing line-ups. */
const shape = (races: ReturnType<typeof lineupOf>) => JSON.stringify(races?.map((r) => [r.id, r.teams, r.tables]) ?? null);

/**
 * Guards a change to an already-raced round. Once a later round has been opened the change
 * needs `confirm`. Opened rounds keep their saved line-up; the reply lists those
 * (`keptRounds`) that no longer match what the corrected results would build.
 */
export function checkCorrection(before: LiveEvent, after: LiveEvent, round: number, confirm: boolean | undefined): CommandResult | null {
  const current = before.round.current;
  if (round >= current) return null;
  if (confirm) return null;
  const laterRounds = Array.from({ length: current - round }, (_, i) => round + 1 + i);
  const rebuilt: LiveEvent = { ...after, lineups: undefined, bracketMembers: undefined };
  const keptRounds = laterRounds.filter((r) => shape(after.lineups?.[r] ?? lineupOf(after, r)) !== shape(lineupOf(rebuilt, r)));
  return fail('unlock_required', 'Later rounds have already been opened; confirm to change this round.', { laterRounds, keptRounds });
}
