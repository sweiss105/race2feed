import { describe, it, expect } from 'vitest';
import { handleSetup } from '../../../server/src/core/setup';
import { derive } from '../../../server/src/core/results';
import { admin, blank, csvFor, ctx, ok } from '../../../server/test/core/helpers';
import {
  BRACKET_FORMAT, PRESETS, SEEDING_RANK, SEEDING_RUNS_HELP, bracketsMismatch, formatSummary, presetOf, rankUnavailable,
} from '../../src/lib/formatCopy';
import { lockedFour, previousEvent, previousEventDone } from '../support/state';

describe('format copy', () => {
  it('has the four presets with their formats and explanations', () => {
    expect(PRESETS.map((p) => [p.id, p.name, p.format])).toEqual([
      ['standard', 'Standard', { seedingRuns: 2, seedingRank: 'total', brackets: 'placement' }],
      ['short', 'Short', { seedingRuns: 1, seedingRank: 'total', brackets: 'finals' }],
      ['seeding', 'Seeding only', { seedingRuns: 2, seedingRank: 'total', brackets: 'none' }],
      ['knockout', 'Knockout', { seedingRuns: 2, seedingRank: 'total', brackets: 'knockout' }],
    ]);
    expect(PRESETS.map((p) => p.blurb)).toEqual([
      'Two seeding rounds, then heats and a placement race in each bracket. This is how Race to Feed has been run.',
      'One seeding round, then one final race per bracket. The quickest full event.',
      'Seeding rounds decide everything. No brackets.',
      'Seeding rounds, then head-to-head knockout brackets down to a final.',
    ]);
  });

  it('explains every seeding-round count, rank rule and bracket format', () => {
    expect(SEEDING_RUNS_HELP).toEqual({
      1: "Every team races once to set the seeding. Quickest, but one bad run decides a team's seed.",
      2: 'Every team races twice. A slow run can be made up in the other.',
      3: 'Every team races three times. The fairest seeding and the longest evening.',
    });
    expect(SEEDING_RANK).toEqual({
      total: { label: 'Total time', help: 'Add up every run. Rewards teams that are consistently fast; a team that misses a run ranks below teams that finished them all.' },
      best: { label: 'Best run', help: "Only each team's fastest run counts. One great run is enough, and a bad run costs nothing." },
      dropSlowest: { label: 'Drop the slowest', help: "Each team's slowest run is ignored, so one bad run (or one DNF) is forgiven. Needs three seeding rounds." },
    });
    expect(BRACKET_FORMAT).toEqual({
      placement: { label: 'Heats, then placement', help: 'Teams race head-to-head in heats, top seed against bottom seed. Heat winners then race each other for the top places, and the rest race for the remaining places.' },
      finals: { label: 'Finals only', help: 'Each bracket races once, all its teams together. The finishing order is the result.' },
      none: { label: 'Seeding only', help: "No brackets. Each category's final order is its seeding order." },
      knockout: { label: 'Knockout', help: "Head-to-head rounds. Win and you go through; lose and you're out. The last two race the final, and the semi-final losers race for third." },
    });
  });

  it('names the preset a format matches, or custom', () => {
    for (const p of PRESETS) expect(presetOf(p.format)).toBe(p.id);
    expect(presetOf({ seedingRuns: 3, seedingRank: 'total', brackets: 'placement' })).toBe('custom');
    expect(presetOf({ seedingRuns: 2, seedingRank: 'best', brackets: 'placement' })).toBe('custom');
    expect(presetOf({ seedingRuns: 1, seedingRank: 'total', brackets: 'none' })).toBe('custom');
  });

  it('says why a rank rule is not available', () => {
    expect(rankUnavailable('total', 1)).toBeNull();
    expect(rankUnavailable('best', 1)).toBe('Needs at least two seeding rounds.');
    expect(rankUnavailable('best', 2)).toBeNull();
    expect(rankUnavailable('dropSlowest', 1)).toBe('Needs three seeding rounds.');
    expect(rankUnavailable('dropSlowest', 2)).toBe('Needs three seeding rounds.');
    expect(rankUnavailable('dropSlowest', 3)).toBeNull();
  });
});

describe('formatSummary', () => {
  it('gives the real round and race counts of the previous event under Standard', () => {
    const rounds = derive(previousEventDone()).rounds;
    const races = rounds.reduce((n, r) => n + r.races.length, 0);
    expect([rounds.length, races]).toEqual([9, 150]);
    expect(formatSummary(previousEvent().setup)).toBe('9 rounds, 150 races');
  });

  it('follows the format: Short and Seeding only', () => {
    const setup = previousEvent().setup;
    // 2 seeding rounds (50 runs), 2 finals rounds (12 brackets), the Grand Championship.
    expect(formatSummary({ ...setup, format: { seedingRuns: 1, seedingRank: 'total', brackets: 'finals' } })).toBe('5 rounds, 63 races');
    // 4 seeding rounds (100 runs) and the Grand Championship between the three top seeds.
    expect(formatSummary({ ...setup, format: { brackets: 'none' }, brackets: [] })).toBe('5 rounds, 101 races');
    expect(formatSummary({ ...setup, format: { brackets: 'none' }, brackets: [], grandChampionship: false })).toBe('4 rounds, 100 races');
    expect(formatSummary({ ...setup, format: { seedingRuns: 3, seedingRank: 'dropSlowest' } })).toBe('11 rounds, 200 races');
  });

  it('counts the races of small brackets and uses the singular', () => {
    // Four teams, one bracket: 2 seeding rounds of 4, 2 heats, winners and others races.
    expect(formatSummary(lockedFour().setup)).toBe('4 rounds, 12 races');
    let e = ok(handleSetup(blank(4), { type: 'addTeam', name: 'Solo', category: 'Open' }, ctx(admin)));
    e = ok(handleSetup(e, { type: 'setFormat', format: { seedingRuns: 1, brackets: 'none' } }, ctx(admin)));
    e = ok(handleSetup(e, { type: 'suggestSetup' }, ctx(admin)));
    expect(formatSummary(e.setup)).toBe('1 round, 1 race');
  });

  it('says what is still needed before there are teams, groups or brackets', () => {
    expect(formatSummary(blank(4).setup)).toBe('Add teams to see how many rounds this makes.');
    const imported = ok(handleSetup(blank(4), { type: 'importTeams', csv: csvFor({ T: 4 }) }, ctx(admin)));
    expect(formatSummary(imported.setup)).toBe('Press Suggest groups and brackets to see how many rounds this makes.');
    const suggested = ok(handleSetup(imported, { type: 'suggestSetup' }, ctx(admin)));
    expect(formatSummary({ ...suggested.setup, brackets: [] })).toBe('Press Suggest groups and brackets to see how many rounds this makes.');
    expect(formatSummary({ ...suggested.setup, brackets: [], format: { brackets: 'none' } })).toBe('2 rounds, 8 races');
  });

  it('never asks the engine for a knockout plan', () => {
    expect(formatSummary({ ...lockedFour().setup, format: { brackets: 'knockout' } })).toBe('Knockout is coming soon.');
  });
});

describe('bracketsMismatch', () => {
  const unlocked = () => ({ ...lockedFour(), setupLocked: false });
  it('is false for brackets that fit the format, and before anything is set up', () => {
    expect(bracketsMismatch(unlocked().setup)).toBe(false);
    expect(bracketsMismatch(blank(4).setup)).toBe(false);
    const imported = ok(handleSetup(blank(4), { type: 'importTeams', csv: csvFor({ T: 4 }) }, ctx(admin)));
    expect(bracketsMismatch(imported.setup)).toBe(false);
  });
  it('is true when the brackets were set up for seeding only and the format now needs them', () => {
    let e = ok(handleSetup(unlocked(), { type: 'setFormat', format: { brackets: 'none' } }, ctx(admin)));
    expect(bracketsMismatch(e.setup)).toBe(false);
    e = ok(handleSetup(e, { type: 'setFormat', format: { brackets: 'finals' } }, ctx(admin)));
    expect(bracketsMismatch(e.setup)).toBe(true);
    e = ok(handleSetup(e, { type: 'suggestSetup' }, ctx(admin)));
    expect(bracketsMismatch(e.setup)).toBe(false);
  });
  it('is true when brackets are left over in seeding only', () => {
    const e = unlocked();
    expect(bracketsMismatch({ ...e.setup, format: { brackets: 'none' } })).toBe(true);
  });
});
