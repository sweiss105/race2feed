export type Ms = number;

/** Array order of categories is display and layout order. */
export interface Category { id: string; name: string }
export interface Team { id: string; name: string; categoryId: string; order: number }

export type EntryStatus = 'pending' | 'finished' | 'dnf' | 'dns';
export interface EntryResult { status: EntryStatus; rawMs: Ms | null; penaltiesMs: Ms }

/** Group ids are 'A', 'B', 'C', … */
export interface SeedingGroup { id: string; teamIds: string[] }

export interface BracketSpec {
  id: string;
  categoryId: string;
  tierIndex: number;
  tierName: string;
  firstSeed: number;
  size: number;
}

export interface EventInput {
  tableCount: number;
  categories: Category[];
  teams: Team[];
  groups: SeedingGroup[];
  /** teamId → seeding table */
  tableOf: Record<string, number>;
  brackets: BracketSpec[];
  grandChampionship: boolean;
  /** Tables each referee covers; defaults to 2 (a pair of adjacent tables). */
  tablesPerStation?: 1 | 2;
}

export type RaceRole = 'seed' | 'heat' | 'final' | 'winners' | 'others' | 'grand';
/** One race as it was published when its round opened. */
export interface SavedRace { id: string; label: string; bracketId?: string; role: RaceRole; teams: string[]; tables: number[]; fallbackOrder: string[] }

export interface EventProgress {
  /** Rounds 1..finishedRounds are locked. */
  finishedRounds: number;
  /** round → teamId → result */
  results: Record<number, Record<string, EntryResult>>;
  /**
   * raceId → one list holding the decided order of every tied group in the race. A group is decided when all
   * its members are in the list, and ranks by their relative order there; other teams in the list don't matter.
   */
  tieDecisions: Record<string, string[]>;
  /** round → the races it was opened with. A round listed here is never rebuilt. */
  lineups?: Record<number, SavedRace[]>;
  /** bracketId → team ids in seed order, as they stood when the first bracket round opened. */
  bracketMembers?: Record<string, string[]>;
}
