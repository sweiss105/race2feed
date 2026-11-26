import {
  buildRoundPlan, formatOf, validateBracketPlan, validateFormat,
  type BracketFormat, type EventInput, type SeedingRankRule, type TournamentFormat,
} from '@race2feed/engine';

/**
 * Every word of the Tournament format panel in Setup, in one place: the tests pin it and the staff guide quotes it.
 * The owner asked for an explanation beside every option, so each one has its own sentence or two.
 */
export type Format = Required<TournamentFormat>;
export type PresetId = 'standard' | 'short' | 'seeding' | 'knockout';

export const PANEL_INTRO = 'Choose how the event runs. You can change this until setup is locked.';
export const LOCKED_NOTE = 'Setup is locked. Unlock it to change the format.';
export const COMING_SOON = 'Coming soon';
export const CUSTOM = 'Custom';
export const CUSTOM_NOTE = 'Your own mix of the settings below.';
export const RANK_CHANGED = 'Seeding rank changed to Total time.';
export const BRACKETS_MISMATCH = 'Your brackets were set up for a different format. Press Suggest groups and brackets to rebuild them.';
export const NO_BRACKETS = 'Seeding only uses no brackets.';

export const PRESETS: { id: PresetId; name: string; blurb: string; format: Format }[] = [
  {
    id: 'standard', name: 'Standard',
    blurb: 'Two seeding rounds, then heats and a placement race in each bracket. This is how Race to Feed has been run.',
    format: { seedingRuns: 2, seedingRank: 'total', brackets: 'placement' },
  },
  {
    id: 'short', name: 'Short',
    blurb: 'One seeding round, then one final race per bracket. The quickest full event.',
    format: { seedingRuns: 1, seedingRank: 'total', brackets: 'finals' },
  },
  {
    id: 'seeding', name: 'Seeding only',
    blurb: 'Seeding rounds decide everything. No brackets.',
    format: { seedingRuns: 2, seedingRank: 'total', brackets: 'none' },
  },
  {
    id: 'knockout', name: 'Knockout',
    blurb: 'Seeding rounds, then head-to-head knockout brackets down to a final.',
    format: { seedingRuns: 2, seedingRank: 'total', brackets: 'knockout' },
  },
];

/** The preset whose three settings are exactly these, or 'custom'. */
export const presetOf = (f: Format): PresetId | 'custom' =>
  PRESETS.find((p) => p.format.seedingRuns === f.seedingRuns && p.format.seedingRank === f.seedingRank && p.format.brackets === f.brackets)?.id ?? 'custom';

export const SEEDING_RUNS: (1 | 2 | 3)[] = [1, 2, 3];
export const SEEDING_RUNS_LABEL: Record<1 | 2 | 3, string> = { 1: '1 round', 2: '2 rounds', 3: '3 rounds' };
export const SEEDING_RUNS_HELP: Record<1 | 2 | 3, string> = {
  1: "Every team races once to set the seeding. Quickest, but one bad run decides a team's seed.",
  2: 'Every team races twice. A slow run can be made up in the other.',
  3: 'Every team races three times. The fairest seeding and the longest evening.',
};

export const SEEDING_RANK: Record<SeedingRankRule, { label: string; help: string }> = {
  total: {
    label: 'Total time',
    help: 'Add up every run. Rewards teams that are consistently fast; a team that misses a run ranks below teams that finished them all.',
  },
  best: {
    label: 'Best run',
    help: "Only each team's fastest run counts. One great run is enough, and a bad run costs nothing.",
  },
  dropSlowest: {
    label: 'Drop the slowest',
    help: "Each team's slowest run is ignored, so one bad run (or one DNF) is forgiven. Needs three seeding rounds.",
  },
};

export const BRACKET_FORMAT: Record<BracketFormat, { label: string; help: string }> = {
  placement: {
    label: 'Heats, then placement',
    help: 'Teams race head-to-head in heats, top seed against bottom seed. Heat winners then race each other for the top places, and the rest race for the remaining places.',
  },
  finals: {
    label: 'Finals only',
    help: 'Each bracket races once, all its teams together. The finishing order is the result.',
  },
  none: {
    label: 'Seeding only',
    help: "No brackets. Each category's final order is its seeding order.",
  },
  knockout: {
    label: 'Knockout',
    help: "Head-to-head rounds. Win and you go through; lose and you're out. The last two race the final, and the semi-final losers race for third.",
  },
};

const RANK_NEEDS: Record<SeedingRankRule, string> = {
  total: '',
  best: 'Needs at least two seeding rounds.',
  dropSlowest: 'Needs three seeding rounds.',
};

/** Why a rank rule cannot be chosen with this many seeding rounds, or null when it can (the engine's own rule). */
export function rankUnavailable(rule: SeedingRankRule, seedingRuns: 1 | 2 | 3): string | null {
  return validateFormat({ seedingRuns, seedingRank: rule }).length ? RANK_NEEDS[rule] : null;
}

const count = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/**
 * "9 rounds, 150 races" for the setup as it stands, or what is still needed before that can be said.
 * A race is one start on the clock: every seeding run of every team, every heat, placement race and final,
 * and the Grand Championship.
 */
export function formatSummary(setup: EventInput): string {
  const format = formatOf(setup);
  // Knockout is not built yet: the engine's round plan refuses it.
  if (format.brackets === 'knockout') return 'Knockout is coming soon.';
  if (!setup.teams.length) return 'Add teams to see how many rounds this makes.';
  if (!setup.groups.length || (format.brackets !== 'none' && !setup.brackets.length)) {
    return 'Press Suggest groups and brackets to see how many rounds this makes.';
  }
  const size = new Map(setup.brackets.map((b) => [b.id, b.size]));
  const plan = buildRoundPlan(setup);
  const races = plan.reduce((total, round) => {
    switch (round.kind) {
      case 'seeding': return total + (setup.groups.find((g) => g.id === round.groupId)?.teamIds.length ?? 0);
      // A bracket of fewer than four is one race; otherwise head-to-head heats (an odd team joins the last one).
      case 'heats': return total + round.bracketIds.reduce((n, id) => n + ((size.get(id) ?? 0) < 4 ? 1 : Math.floor(size.get(id)! / 2)), 0);
      // The winners race and the others race.
      case 'placement': return total + 2 * round.bracketIds.length;
      case 'finals': return total + round.bracketIds.length;
      case 'grand': return total + 1;
    }
  }, 0);
  return `${count(plan.length, 'round')}, ${count(races, 'race')}`;
}

/**
 * Whether the brackets in the setup were made for another bracket format: they do not fit this one, and would
 * fit another. Groups exist once Suggest has been pressed; before that there is nothing to rebuild.
 */
export function bracketsMismatch(setup: EventInput): boolean {
  if (!setup.teams.length || !setup.groups.length) return false;
  const format = formatOf(setup);
  // The Grand Championship's own problem (more winners than tables) is not about the brackets.
  const fits = (brackets: BracketFormat) => validateBracketPlan({ ...setup, grandChampionship: false, format: { ...format, brackets } }).length === 0;
  if (fits(format.brackets)) return false;
  return (Object.keys(BRACKET_FORMAT) as BracketFormat[]).some((other) => other !== format.brackets && fits(other));
}
