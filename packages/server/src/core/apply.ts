import { fail, type Command, type CommandResult, type Ctx, type LiveEvent, type Role } from './model';
import { handleSetup } from './setup';
import { handleLifecycle } from './lifecycle';
import { handleTaps } from './taps';

const SETUP = ['importTeams', 'addTeam', 'renameTeam', 'removeTeam', 'setTableCount', 'setTablesPerReferee', 'suggestSetup', 'setGroups',
  'setBrackets', 'setGrandChampionship', 'lockSetup', 'unlockSetup', 'setSettings', 'setBagTotal', 'setPenaltyReasons'] as const;
const LIFECYCLE = ['openNextRound', 'stationReady', 'overrideStation', 'startRace', 'finishRace', 'decideTie', 'pinProjector', 'showChampion', 'hideChampion'] as const;
const TAPS = ['tapFinish', 'tapPenalty', 'undoTap', 'setResult', 'addPenalty', 'removePenalty', 'setPenaltiesEnabled', 'notePenalty', 'decidePenalty'] as const;

const CONTROL = ['openNextRound', 'overrideStation', 'startRace', 'finishRace', 'decideTie', 'pinProjector',
  'setResult', 'addPenalty', 'removePenalty', 'setPenaltiesEnabled', 'decidePenalty', 'showChampion', 'hideChampion'];

/** Roles allowed to send each command. Admin may do everything race control can, plus setup. */
export const PERMISSIONS: Record<Command['type'], Role[]> = Object.fromEntries([
  ...SETUP.map((t) => [t, ['admin']]),
  ...CONTROL.map((t) => [t, ['admin', 'control']]),
  ...['stationReady', 'tapFinish', 'tapPenalty', 'undoTap', 'notePenalty'].map((t) => [t, ['referee']]),
]) as Record<Command['type'], Role[]>;
for (const t of ['startRace', 'finishRace', 'pinProjector'] as const) PERMISSIONS[t] = [...PERMISSIONS[t], 'companion'];
// Race control can fix a misspelled team name on the day (setup otherwise stays admin-only).
PERMISSIONS.renameTeam = ['admin', 'control'];

const isOneOf = <T extends string>(list: readonly T[], type: string): type is T => (list as readonly string[]).includes(type);

export function applyCommand(e: LiveEvent, cmd: Command, ctx: Ctx): CommandResult {
  if (e.endedAt) return fail('event_ended', 'This event has ended; reopen it from Events to make changes.');
  const allowed = Object.hasOwn(PERMISSIONS, cmd.type) ? PERMISSIONS[cmd.type] : undefined;
  if (!allowed) return fail('unknown_command', `Unknown command "${(cmd as { type: string }).type}".`);
  if (!allowed.includes(ctx.actor.role)) return fail('forbidden', 'You are not allowed to do that.');
  try {
    if (isOneOf(SETUP, cmd.type)) return handleSetup(e, cmd as Extract<Command, { type: (typeof SETUP)[number] }>, ctx);
    if (isOneOf(LIFECYCLE, cmd.type)) return handleLifecycle(e, cmd as Extract<Command, { type: (typeof LIFECYCLE)[number] }>, ctx);
    if (isOneOf(TAPS, cmd.type)) return handleTaps(e, cmd as Extract<Command, { type: (typeof TAPS)[number] }>, ctx);
  } catch (err) {
    // Handlers are pure, so a throw leaves nothing half-applied. In setup it is a wrong-typed field;
    // elsewhere it may be a server fault, so the sender keeps the command and can try again.
    console.error('command failed', cmd.type, err);
    if (isOneOf(SETUP, cmd.type)) return fail('invalid', 'That command is malformed.');
    return fail('server_error', 'The server could not process that. Try again.');
  }
  return fail('unknown_command', `Unknown command "${cmd.type}".`);
}
