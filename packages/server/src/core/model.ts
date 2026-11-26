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
  /** Who entered it at the console (source 'control'). Missing on taps stored before it was recorded. */
  by?: string;
  createdAt: number;
  removedAt: number | null;
  /** Who removed or rejected it at the console. Missing when a referee undid their own tap, and on older taps. */
  removedBy?: string;
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
/** by: who entered it at the console. Missing on overrides stored before it was recorded. */
export interface Override { round: number; teamId: string; at: number; set: OverrideSet; by?: string }

export type ProjectorScreen = 'welcome' | 'tables' | 'clock' | 'seeding-results' | 'brackets' | 'standings' | 'champion';

export interface LiveEvent {
  id: string;
  name: string;
  date: string;
  setup: EventInput;
  setupLocked: boolean;
  /** autoFinishMs: missing means 30 s (events stored before auto-finish); 0 turns auto-finish off. */
  /** rotateReferees: missing means off (events stored before rotation); new events have it on. See rotation.ts. */
  settings: { penaltiesEnabled: boolean; undoWindowMs: number; penaltyMs?: number; autoFinishMs?: number; rotateReferees?: boolean };
  bagTotal: string | null;
  /** autoFinishAt: when the running round finishes by itself (every team has a result); see autofinish.ts. */
  round: { current: number; phase: Phase; startedAt: number | null; finishedAt: number | null; autoFinishAt?: number | null };
  finishedRounds: number;
  /**
   * Referee stations of the open round. readyTables: the tables marked ready (missing on events stored before
   * per-table Ready; then `ready: true` means every table is ready). `ready` is kept true exactly when every
   * table of the station that has a team this round is in readyTables.
   */
  stations: Record<number, Station>;
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
  /**
   * round → who judged which tables, saved when the round opened with rotation on; see rotation.ts.
   * A round without an entry was opened with rotation off: every referee is at their home station.
   */
  assignments?: Record<number, Assignment[]>;
  /** Fairness warning id → race control's dismissal; see fairness.ts. Missing means none. */
  dismissed?: Record<string, Dismissal>;
}

/** Race control has looked at a fairness warning and set it aside. */
export interface Dismissal { by: string; at: number; note: string }

/** One paired referee that has not been revoked. home: the station the device was paired to. */
export interface RosterEntry { deviceId: string; name: string; home: number }
/** A referee's place in one round. tables: only the tables this referee judges that round. */
export interface Assignment { deviceId: string; name: string; station: number; tables: number[] }

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
  | { type: 'setSettings'; undoWindowMs?: number; autoFinishMs?: number; rotateReferees?: boolean }
  | { type: 'setBagTotal'; text: string }
  | { type: 'setPenaltyReasons'; reasons: PenaltyReason[] };

export interface Station { ready: boolean; excluded: boolean; readyTables?: number[] }

export type LifecycleCommand =
  | { type: 'openNextRound' }
  /** table: one of the referee's tables; without it (older tablet pages) every occupied table of the station. */
  | { type: 'stationReady'; table?: number }
  | { type: 'overrideStation'; station: number; state: 'ready' | 'notReady' | 'excluded' }
  /** a, b: referee device ids. Exchanges their tables in the open round; one of them may have none. See rotation.ts. */
  | { type: 'swapReferees'; a: string; b: string }
  | { type: 'startRace' }
  | { type: 'finishRace' }
  | { type: 'decideTie'; raceId: string; order: string[]; confirmUnlock?: boolean }
  | { type: 'pinProjector'; screen: ProjectorScreen | null }
  | { type: 'showChampion'; bagTotal: string }
  | { type: 'hideChampion' }
  /** id: a current fairness warning's id (fairness.ts). note: 1–200 characters. Dismissing again replaces the note. */
  | { type: 'dismissWarning'; id: string; note: string };

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

/** roster: the paired referees, passed by the hub (the only code that knows the devices). */
export interface Ctx { now: number; actor: Actor; newId: () => string; roster?: RosterEntry[] }

export function newEvent(id: string, name: string, date: string, tableCount: number): LiveEvent {
  return {
    id,
    name,
    date,
    setup: { tableCount, categories: [], teams: [], groups: [], tableOf: {}, brackets: [], grandChampionship: true },
    setupLocked: false,
    settings: { penaltiesEnabled: false, undoWindowMs: 10_000, rotateReferees: true },
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

/** The station's ready tables, out of `tables` (its tables). A stored station without readyTables follows `ready`. */
export const readyTablesOf = (s: Station | undefined, tables: number[]): number[] =>
  !s ? [] : s.readyTables ? tables.filter((t) => s.readyTables!.includes(t)) : s.ready ? tables : [];
