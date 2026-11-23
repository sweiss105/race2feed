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
}

export interface EventProgress {
  /** Rounds 1..finishedRounds are locked. */
  finishedRounds: number;
  /** round → teamId → result */
  results: Record<number, Record<string, EntryResult>>;
  /** raceId → team order for its tied teams */
  tieDecisions: Record<string, string[]>;
}
