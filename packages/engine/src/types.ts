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
  /** How the event runs; read it through formatOf(). Missing (events stored before formats) means the standard format. */
  format?: TournamentFormat;
}

/** How seeding is ranked: total of the finished runs, the best single run, or the total without the slowest run. */
export type SeedingRankRule = 'total' | 'best' | 'dropSlowest';
/** placement: heats then placement. finals: one race per bracket. none: seeding only. knockout: single elimination. */
export type BracketFormat = 'placement' | 'finals' | 'none' | 'knockout';
/** Every field is optional; a missing field has the value the event had before formats existed (formatOf). */
export interface TournamentFormat { seedingRuns?: 1 | 2 | 3; seedingRank?: SeedingRankRule; brackets?: BracketFormat }

const SEEDING_RANKS: SeedingRankRule[] = ['total', 'best', 'dropSlowest'];
const BRACKET_FORMATS: BracketFormat[] = ['placement', 'finals', 'none', 'knockout'];

/** The event's format with every field filled in: 2 seeding runs, ranked by total time, heats then placement. */
export function formatOf(input: Pick<EventInput, 'format'>): Required<TournamentFormat> {
  return {
    seedingRuns: input.format?.seedingRuns ?? 2,
    seedingRank: input.format?.seedingRank ?? 'total',
    brackets: input.format?.brackets ?? 'placement',
  };
}

/**
 * Problems with the format itself, as plain sentences ([] when fine): a value that is not one of the choices,
 * 'best' with fewer than 2 runs, 'dropSlowest' with fewer than 3.
 */
export function validateFormat(format: TournamentFormat | undefined): string[] {
  if (format === undefined) return [];
  if (format === null || typeof format !== 'object' || Array.isArray(format)) return ['The format is not valid.'];
  const errors: string[] = [];
  if (format.seedingRuns !== undefined && ![1, 2, 3].includes(format.seedingRuns)) errors.push('Seeding rounds must be 1, 2 or 3.');
  if (format.seedingRank !== undefined && !SEEDING_RANKS.includes(format.seedingRank)) errors.push('That seeding rank is not one of the choices.');
  if (format.brackets !== undefined && !BRACKET_FORMATS.includes(format.brackets)) errors.push('That bracket format is not one of the choices.');
  if (errors.length) return errors;
  const { seedingRuns, seedingRank } = formatOf({ format });
  if (seedingRank === 'best' && seedingRuns < 2) errors.push('Best run needs at least two seeding rounds.');
  if (seedingRank === 'dropSlowest' && seedingRuns < 3) errors.push('Drop the slowest needs three seeding rounds.');
  return errors;
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
