import type { BracketSpec, EventInput, SavedRace, SeedingGroup } from '@race2feed/engine';
import { STARTER_REASONS } from './starter';

export type Role = 'admin' | 'referee' | 'companion' | 'public';
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
  /** Penalty taps only. Missing on taps stored before reviews existed (treated as approved). */
  review?: PenaltyReview;
}

export interface PenaltyReason { id: string; name: string; kind: 'time' | 'dq'; amountMs?: number }

export interface PenaltyReview {
  status: 'pending' | 'approved' | 'rejected';
  /** The official reason race control chose. */
  reasonId?: string;
  reasonName?: string;
  /** The referee's suggestion, sent after the race. */
  refereeReasonId?: string;
  refereeNote?: string;
  dq?: boolean;
  decidedAt?: number;
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
  /** autoFinishMs: missing means 30 s (events stored before auto-finish); 0 turns auto-finish off. */
  settings: { penaltiesEnabled: boolean; undoWindowMs: number; penaltyMs?: number; autoFinishMs?: number };
  bagTotal: string | null;
  /** autoFinishAt: when the running round finishes by itself (every team has a result); see autofinish.ts. */
  round: { current: number; phase: Phase; startedAt: number | null; finishedAt: number | null; autoFinishAt?: number | null };
  finishedRounds: number;
  stations: Record<number, { ready: boolean; excluded: boolean }>;
  taps: Tap[];
  overrides: Override[];
  tieDecisions: Record<string, string[]>;
  projectorPin: ProjectorScreen | null;
  /** Missing on events stored before the list existed; see reasonsOf(). */
  penaltyReasons?: PenaltyReason[];
  /** Race control is showing the champion screen on every device. */
  championShown?: boolean;
  /** Set when admin ends the event; it is then read-only and no longer active. */
  endedAt?: number | null;
  /** round → the races it was opened with; see lineups.ts. Missing on events stored before line-ups were saved. */
  lineups?: Record<number, SavedRace[]>;
  /** bracketId → team ids in seed order, saved when the first bracket round opened. */
  bracketMembers?: Record<string, string[]>;
}

export type SetupCommand =
  | { type: 'importTeams'; csv: string }
  | { type: 'addTeam'; name: string; category: string }
  | { type: 'renameTeam'; teamId: string; name: string }
  | { type: 'removeTeam'; teamId: string }
  | { type: 'setTableCount'; tableCount: number }
  | { type: 'setTablesPerReferee'; count: 1 | 2 }
  | { type: 'suggestSetup' }
  | { type: 'setGroups'; groups: SeedingGroup[]; tableOf: Record<string, number> }
  | { type: 'setBrackets'; brackets: BracketSpec[] }
  | { type: 'setGrandChampionship'; enabled: boolean }
  | { type: 'lockSetup' }
  | { type: 'unlockSetup' }
  | { type: 'setSettings'; undoWindowMs?: number; autoFinishMs?: number }
  | { type: 'setBagTotal'; text: string }
  | { type: 'setPenaltyReasons'; reasons: PenaltyReason[] };

export type LifecycleCommand =
  | { type: 'openNextRound' }
  | { type: 'stationReady' }
  | { type: 'overrideStation'; station: number; state: 'ready' | 'notReady' | 'excluded' }
  | { type: 'startRace' }
  | { type: 'finishRace' }
  | { type: 'decideTie'; raceId: string; order: string[]; confirmUnlock?: boolean }
  | { type: 'pinProjector'; screen: ProjectorScreen | null }
  | { type: 'showChampion'; bagTotal: string }
  | { type: 'hideChampion' };

export type TapCommand =
  | { type: 'tapFinish'; teamId: string; atServerMs: number; clientTapId: string }
  | { type: 'tapPenalty'; teamId: string; clientTapId: string }
  | { type: 'undoTap'; tapId: string }
  | { type: 'setResult'; round: number; teamId: string; set: OverrideSet; confirmUnlock?: boolean }
  | { type: 'addPenalty'; round: number; teamId: string; reasonId: string; confirmUnlock?: boolean }
  | { type: 'removePenalty'; tapId: string; confirmUnlock?: boolean }
  | { type: 'setPenaltiesEnabled'; enabled: boolean }
  | { type: 'notePenalty'; tapId: string; reasonId: string; note?: string }
  | { type: 'decidePenalty'; tapId: string; decision: 'approve' | 'reject'; reasonId?: string; confirmUnlock?: boolean };

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
    settings: { penaltiesEnabled: false, undoWindowMs: 10_000 },
    bagTotal: null,
    round: { current: 0, phase: 'idle', startedAt: null, finishedAt: null },
    finishedRounds: 0,
    stations: {},
    taps: [],
    overrides: [],
    tieDecisions: {},
    projectorPin: null,
    penaltyReasons: STARTER_REASONS.map((r) => ({ ...r })),
  };
}

/** Successful result; the dispatcher fills in the audit entry. */
export function done(event: LiveEvent, cmd: Command, ctx: Ctx, reply?: unknown): CommandResult {
  return { ok: true, event, audit: { action: cmd.type, actor: ctx.actor.label, detail: cmd }, ...(reply === undefined ? {} : { reply }) };
}

export function fail(code: string, message: string, detail?: unknown): CommandResult {
  return { ok: false, code, message, ...(detail === undefined ? {} : { detail }) };
}

/** Tables each referee covers in this event. */
export const perStation = (e: LiveEvent): 1 | 2 => e.setup.tablesPerStation ?? 2;
