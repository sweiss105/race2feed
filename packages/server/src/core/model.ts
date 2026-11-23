import type { BracketSpec, EventInput, SeedingGroup } from '@race2feed/engine';

export type Role = 'admin' | 'control' | 'referee' | 'companion' | 'public';
export interface Actor { role: Role; label: string; deviceId?: string; station?: number }

export type Phase = 'idle' | 'open' | 'running' | 'finished';

export interface Tap {
  id: string;
  clientTapId?: string;
  kind: 'finish' | 'penalty';
  round: number;
  teamId: string;
  /** finish only */
  elapsedMs?: number;
  /** penalty only */
  amountMs?: number;
  source: 'referee' | 'control';
  deviceId?: string;
  createdAt: number;
  removedAt: number | null;
}

export type OverrideSet =
  | { kind: 'status'; status: 'dnf' | 'dns' }
  | { kind: 'time'; rawMs: number }
  | { kind: 'clear' };
export interface Override { round: number; teamId: string; at: number; set: OverrideSet }

export type ProjectorScreen = 'welcome' | 'tables' | 'clock' | 'seeding-results' | 'brackets' | 'standings' | 'champion';

export interface LiveEvent {
  id: string;
  name: string;
  date: string;
  setup: EventInput;
  setupLocked: boolean;
  settings: { penaltiesEnabled: boolean; penaltyMs: number; undoWindowMs: number };
  bagTotal: string | null;
  round: { current: number; phase: Phase; startedAt: number | null; finishedAt: number | null };
  finishedRounds: number;
  stations: Record<number, { ready: boolean; excluded: boolean }>;
  taps: Tap[];
  overrides: Override[];
  tieDecisions: Record<string, string[]>;
  projectorPin: ProjectorScreen | null;
}

export type SetupCommand =
  | { type: 'importTeams'; csv: string }
  | { type: 'addTeam'; name: string; category: string }
  | { type: 'renameTeam'; teamId: string; name: string }
  | { type: 'removeTeam'; teamId: string }
  | { type: 'setTableCount'; tableCount: number }
  | { type: 'suggestSetup' }
  | { type: 'setGroups'; groups: SeedingGroup[]; tableOf: Record<string, number> }
  | { type: 'setBrackets'; brackets: BracketSpec[] }
  | { type: 'setGrandChampionship'; enabled: boolean }
  | { type: 'lockSetup' }
  | { type: 'unlockSetup' }
  | { type: 'setSettings'; penaltyMs?: number; undoWindowMs?: number }
  | { type: 'setBagTotal'; text: string };

export type LifecycleCommand =
  | { type: 'openNextRound' }
  | { type: 'stationReady' }
  | { type: 'overrideStation'; station: number; state: 'ready' | 'notReady' | 'excluded' }
  | { type: 'startRace' }
  | { type: 'finishRace' }
  | { type: 'decideTie'; raceId: string; order: string[] }
  | { type: 'pinProjector'; screen: ProjectorScreen | null };

export type TapCommand =
  | { type: 'tapFinish'; teamId: string; atServerMs: number; clientTapId: string }
  | { type: 'tapPenalty'; teamId: string; clientTapId: string }
  | { type: 'undoTap'; tapId: string }
  | { type: 'setResult'; round: number; teamId: string; set: OverrideSet; confirmUnlock?: boolean }
  | { type: 'addPenalty'; round: number; teamId: string; confirmUnlock?: boolean }
  | { type: 'removePenalty'; tapId: string; confirmUnlock?: boolean }
  | { type: 'setPenaltiesEnabled'; enabled: boolean };

export type Command = SetupCommand | LifecycleCommand | TapCommand;

export interface AuditEntry { action: Command['type']; actor: string; detail: unknown }

export type CommandResult =
  | { ok: true; event: LiveEvent; audit: AuditEntry; reply?: unknown }
  | { ok: false; code: string; message: string; detail?: unknown };

export interface Ctx { now: number; actor: Actor; newId: () => string }

export function newEvent(id: string, name: string, date: string, tableCount: number): LiveEvent {
  return {
    id,
    name,
    date,
    setup: { tableCount, categories: [], teams: [], groups: [], tableOf: {}, brackets: [], grandChampionship: true },
    setupLocked: false,
    settings: { penaltiesEnabled: false, penaltyMs: 5000, undoWindowMs: 10_000 },
    bagTotal: null,
    round: { current: 0, phase: 'idle', startedAt: null, finishedAt: null },
    finishedRounds: 0,
    stations: {},
    taps: [],
    overrides: [],
    tieDecisions: {},
    projectorPin: null,
  };
}

/** Successful result; the dispatcher fills in the audit entry. */
export function done(event: LiveEvent, cmd: Command, ctx: Ctx, reply?: unknown): CommandResult {
  return { ok: true, event, audit: { action: cmd.type, actor: ctx.actor.label, detail: cmd }, ...(reply === undefined ? {} : { reply }) };
}

export function fail(code: string, message: string, detail?: unknown): CommandResult {
  return { ok: false, code, message, ...(detail === undefined ? {} : { detail }) };
}
