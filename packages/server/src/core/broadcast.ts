import type { Command, LiveEvent } from './model';

const ALWAYS = new Set<string>([
  'openNextRound', 'startRace', 'finishRace', 'decideTie', 'pinProjector', 'removePenalty', 'decidePenalty', 'decideLateFinish', 'showChampion', 'hideChampion', 'endEvent', 'activateEvent', 'createEvent',
  'importTeams', 'addTeam', 'renameTeam', 'removeTeam', 'setTableCount', 'suggestSetup', 'setGroups', 'setBrackets',
  'setGrandChampionship', 'setFormat', 'lockSetup', 'unlockSetup', 'setBagTotal',
]);

/**
 * Whether participant phones need a full snapshot after `cmd` (applied to the event as it was
 * `before`), instead of the small current-round update.
 */
export function needsSnapshot(cmd: Command | { type: string }, before: LiveEvent): boolean {
  if (ALWAYS.has(cmd.type)) return true;
  if (cmd.type === 'setResult' || cmd.type === 'addPenalty') {
    const { round } = cmd as { round: number };
    return round < before.round.current || before.round.phase === 'finished';
  }
  return false;
}
