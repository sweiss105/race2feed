import { describe, it, expect } from 'vitest';
import type { TournamentFormat } from '@race2feed/engine';
import { applyCommand } from '../../src/core/apply';
import { handleSetup } from '../../src/core/setup';
import { derive } from '../../src/core/results';
import { controlView, projectorScreen, publicRoundUpdate, publicView } from '../../src/core/views';
import { needsSnapshot } from '../../src/core/broadcast';
import { eventCsv } from '../../src/core/export';
import { fairnessWarnings } from '../../src/core/fairness';
import { fairnessCsv } from '../../src/core/fairnessExport';
import type { Command, CommandResult, LiveEvent } from '../../src/core/model';
import { admin, blank, companion, csvFor, ctx, ok, referee, roster, runRound, teamId } from './helpers';
import { previousEvent } from './fixture';

const run = (e: LiveEvent, cmd: Command, actor = admin, now = 3_000_000) => applyCommand(e, cmd, ctx(actor, now));
const code = (r: CommandResult) => (r.ok ? 'ok' : r.code);
const detail = (r: CommandResult) => (r.ok ? null : r.detail);
const setFormat = (e: LiveEvent, format: TournamentFormat) => ok(run(e, { type: 'setFormat', format }));

/** Teams imported and nothing else: categories given as { name: count }, team names "A 1", "A 2", … */
const imported = (counts: Record<string, number>, tables: number): LiveEvent =>
  ok(run(blank(tables), { type: 'importTeams', csv: csvFor(counts) }));
/** Format set, groups and brackets suggested, setup locked. */
function locked(counts: Record<string, number>, tables: number, format: TournamentFormat, grand = true): LiveEvent {
  let e = setFormat(imported(counts, tables), format);
  e = ok(run(e, { type: 'setGrandChampionship', enabled: grand }));
  e = ok(run(e, { type: 'suggestSetup' }));
  return ok(run(e, { type: 'lockSetup' }));
}
const kinds = (e: LiveEvent) => derive(e).rounds.map((r) => r.spec.kind);
const names = (e: LiveEvent, ids: (string | null)[]) => ids.map((id) => e.setup.teams.find((t) => t.id === id)?.name ?? null);
const byName = (e: LiveEvent, record: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(record).map(([id, v]) => [e.setup.teams.find((t) => t.id === id)!.name, v]));
/** Races the next round like runRound, then marks the named teams DNF. */
function runRoundWithDnf(e: LiveEvent, times: Record<string, number>, dnf: string[], now: number): LiveEvent {
  e = runRound(e, times, now);
  for (const name of dnf) {
    e = ok(run(e, { type: 'setResult', round: e.round.current, teamId: teamId(e, name), set: { kind: 'status', status: 'dnf' } }, admin, now + 2));
  }
  return e;
}

describe('setFormat', () => {
  it('stores the format and the views carry it filled in', () => {
    const before = imported({ A: 4 }, 4);
    expect(before.setup.format).toBeUndefined();
    expect(publicView(before, derive(before)).format).toEqual({ seedingRuns: 2, seedingRank: 'total', brackets: 'placement' });

    const e = setFormat(before, { seedingRuns: 3, seedingRank: 'dropSlowest', brackets: 'finals' });
    expect(e.setup.format).toEqual({ seedingRuns: 3, seedingRank: 'dropSlowest', brackets: 'finals' });
    expect(publicView(e, derive(e)).format).toEqual({ seedingRuns: 3, seedingRank: 'dropSlowest', brackets: 'finals' });
    const control = controlView(e, derive(e), { devices: [], audit: [], roster: [] });
    expect(control.format).toEqual({ seedingRuns: 3, seedingRank: 'dropSlowest', brackets: 'finals' });
    expect(control.setup.format).toEqual({ seedingRuns: 3, seedingRank: 'dropSlowest', brackets: 'finals' });
  });

  it('merges the given fields over the stored format', () => {
    let e = setFormat(imported({ A: 4 }, 4), { seedingRuns: 3 });
    expect(e.setup.format).toEqual({ seedingRuns: 3 });
    e = setFormat(e, { seedingRank: 'best' });
    expect(e.setup.format).toEqual({ seedingRuns: 3, seedingRank: 'best' });
    e = setFormat(e, { brackets: 'finals', seedingRuns: 2 });
    expect(e.setup.format).toEqual({ seedingRuns: 2, seedingRank: 'best', brackets: 'finals' });
    e = setFormat(e, {});
    expect(e.setup.format).toEqual({ seedingRuns: 2, seedingRank: 'best', brackets: 'finals' });
    // Only the three settings are stored.
    e = setFormat(e, { seedingRuns: 3, extra: 'x' } as TournamentFormat);
    expect(e.setup.format).toEqual({ seedingRuns: 3, seedingRank: 'best', brackets: 'finals' });
  });

  it('is recorded in the audit and refreshes every phone', () => {
    const e = imported({ A: 4 }, 4);
    const r = run(e, { type: 'setFormat', format: { seedingRuns: 1 } });
    expect(r.ok && r.audit).toEqual({ action: 'setFormat', actor: 'admin', detail: { type: 'setFormat', format: { seedingRuns: 1 } } });
    expect(needsSnapshot({ type: 'setFormat', format: {} }, e)).toBe(true);
  });

  it('is refused once setup is locked, and allowed again after unlocking', () => {
    let e = locked({ A: 4 }, 4, {});
    const refused = run(e, { type: 'setFormat', format: { seedingRuns: 1 } });
    expect(code(refused)).toBe('setup_locked');
    expect(e.setup.format).toEqual({});
    e = ok(run(e, { type: 'unlockSetup' }));
    expect(setFormat(e, { seedingRuns: 1 }).setup.format).toEqual({ seedingRuns: 1 });
  });

  it('is for the console only', () => {
    const e = imported({ A: 4 }, 4);
    expect(code(run(e, { type: 'setFormat', format: { seedingRuns: 1 } }, referee(1)))).toBe('forbidden');
    expect(code(run(e, { type: 'setFormat', format: { seedingRuns: 1 } }, companion))).toBe('forbidden');
    expect(code(run(e, { type: 'setFormat', format: { seedingRuns: 1 } }, { role: 'public', label: 'phone' }))).toBe('forbidden');
  });

  it('refuses combinations that make no sense, with the reasons in plain sentences', () => {
    const e = imported({ A: 4 }, 4);
    const best = run(e, { type: 'setFormat', format: { seedingRuns: 1, seedingRank: 'best' } });
    expect([code(best), detail(best)]).toEqual(['invalid', ['Best run needs at least two seeding rounds.']]);
    const drop = run(e, { type: 'setFormat', format: { seedingRank: 'dropSlowest' } });
    expect([code(drop), detail(drop)]).toEqual(['invalid', ['Drop the slowest needs three seeding rounds.']]);
    // The merged format is what counts: the stored rule no longer fits the new number of rounds.
    const three = setFormat(e, { seedingRuns: 3, seedingRank: 'dropSlowest' });
    const fewer = run(three, { type: 'setFormat', format: { seedingRuns: 2 } });
    expect([code(fewer), detail(fewer)]).toEqual(['invalid', ['Drop the slowest needs three seeding rounds.']]);
    expect(setFormat(three, { seedingRuns: 2, seedingRank: 'total' }).setup.format).toEqual({ seedingRuns: 2, seedingRank: 'total' });
  });

  it('refuses unknown values and malformed commands', () => {
    const e = imported({ A: 4 }, 4);
    const bad = (format: unknown) => run(e, { type: 'setFormat', format } as Command);
    expect([code(bad({ seedingRuns: 4 })), detail(bad({ seedingRuns: 4 }))]).toEqual(['invalid', ['Seeding rounds must be 1, 2 or 3.']]);
    expect([code(bad({ seedingRuns: '2' })), detail(bad({ seedingRuns: '2' }))]).toEqual(['invalid', ['Seeding rounds must be 1, 2 or 3.']]);
    expect(detail(bad({ seedingRank: 'fastest' }))).toEqual(['That seeding rank is not one of the choices.']);
    expect(detail(bad({ brackets: 'swiss' }))).toEqual(['That bracket format is not one of the choices.']);
    for (const format of [undefined, null, 'finals', 3, ['finals']]) expect(code(bad(format))).toBe('invalid');
  });

  it('refuses knockout until it is built', () => {
    const e = imported({ A: 4 }, 4);
    const r = run(e, { type: 'setFormat', format: { brackets: 'knockout' } });
    expect([code(r), !r.ok && r.message, detail(r)]).toEqual(['invalid', 'Knockout is not available yet.', ['Knockout is not available yet.']]);
    expect(e.setup.format).toBeUndefined();
  });
});

describe('format and brackets in setup', () => {
  it('switching to seeding only clears the brackets; other changes keep them', () => {
    let e = ok(run(imported({ A: 5, B: 4 }, 10), { type: 'suggestSetup' }));
    expect(e.setup.brackets).toHaveLength(2);
    expect(setFormat(e, { brackets: 'finals' }).setup.brackets).toHaveLength(2);
    expect(setFormat(e, { seedingRuns: 3 }).setup.brackets).toHaveLength(2);
    e = setFormat(e, { brackets: 'none' });
    expect(e.setup.brackets).toEqual([]);
    expect(e.setup.groups).toHaveLength(1);
  });

  it('suggestSetup builds brackets for the chosen format', () => {
    const e = imported({ A: 5, B: 4 }, 10);
    expect(ok(run(setFormat(e, { brackets: 'none' }), { type: 'suggestSetup' })).setup.brackets).toEqual([]);
    expect(ok(run(setFormat(e, { brackets: 'finals' }), { type: 'suggestSetup' })).setup.brackets.map((b) => [b.id, b.size]))
      .toEqual([['a:0', 5], ['b:0', 4]]);
  });

  it('seeding only locks without brackets', () => {
    let e = setFormat(imported({ A: 5, B: 4 }, 10), { brackets: 'none' });
    e = ok(run(e, { type: 'suggestSetup' }));
    expect(e.setup.brackets).toEqual([]);
    e = ok(run(e, { type: 'lockSetup' }));
    expect(e.setupLocked).toBe(true);
    expect(kinds(e)).toEqual(['seeding', 'seeding', 'grand']);
  });

  it('seeding only with a bracket added by hand is refused at lock with a plain sentence', () => {
    let e = setFormat(imported({ A: 5 }, 10), { brackets: 'none' });
    e = ok(run(e, { type: 'suggestSetup' }));
    e = ok(run(e, { type: 'setBrackets', brackets: [{ id: 'a:0', categoryId: 'a', tierIndex: 0, tierName: 'Gold', firstSeed: 1, size: 5 }] }));
    const r = run(e, { type: 'lockSetup' });
    expect([code(r), detail(r)]).toEqual(['setup_invalid', ['Seeding only uses no brackets. Remove them, or suggest groups and brackets again.']]);
    expect(ok(run(ok(run(e, { type: 'suggestSetup' })), { type: 'lockSetup' })).setupLocked).toBe(true);
  });

  it('a format change that leaves the brackets wrong is caught at lock and repaired by Suggest (Review Focus 4)', () => {
    // Seeding only has no brackets; back in a bracket format the setup has none, which lock refuses.
    let e = ok(run(imported({ A: 5, B: 4 }, 10), { type: 'suggestSetup' }));
    e = setFormat(e, { brackets: 'none' });
    e = setFormat(e, { brackets: 'finals' });
    const r = run(e, { type: 'lockSetup' });
    expect([code(r), detail(r)]).toEqual(['setup_invalid', ['A: brackets hold 0 teams but the category has 5', 'B: brackets hold 0 teams but the category has 4']]);
    e = ok(run(e, { type: 'suggestSetup' }));
    e = ok(run(e, { type: 'lockSetup' }));
    expect(kinds(e)).toEqual(['seeding', 'seeding', 'finals', 'grand']);
  });

  it('lock lists a problem with a stored format', () => {
    // A format stored by other means than the command (an import, an older build).
    let e = ok(run(imported({ A: 4 }, 4), { type: 'suggestSetup' }));
    e = { ...e, setup: { ...e.setup, format: { seedingRuns: 1, seedingRank: 'best' } } };
    const r = run(e, { type: 'lockSetup' });
    expect([code(r), detail(r)]).toEqual(['setup_invalid', ['Best run needs at least two seeding rounds.']]);
    const knockout = run({ ...e, setup: { ...e.setup, format: { brackets: 'knockout' } } }, { type: 'lockSetup' });
    expect([code(knockout), detail(knockout)]).toEqual(['setup_invalid', ['Knockout is not available yet.']]);
  });
});

describe('an event with no format', () => {
  it('gains nothing in storage and derives the same rounds', () => {
    const e = previousEvent();
    expect('format' in e.setup).toBe(false);
    expect(kinds(e)).toEqual(['seeding', 'seeding', 'seeding', 'seeding', 'heats', 'heats', 'placement', 'placement', 'grand']);
    expect(derive({ ...e, setup: { ...e.setup, format: {} } })).toEqual(derive(e));
    const v = publicView(e, derive(e));
    expect(v.format).toEqual({ seedingRuns: 2, seedingRank: 'total', brackets: 'placement' });
    expect(Object.values(v.seedRuns).every((r) => r.length === 2 && r.every((ms) => ms === null))).toBe(true);
    expect(Object.keys(v.seedRuns)).toHaveLength(50);
    expect(Object.values(v.seedScoreMs).every((ms) => ms === null)).toBe(true);
  });
});

describe('seeding runs and rank in the views', () => {
  const t = { 'A 1': 100_000, 'A 2': 110_000, 'A 3': 120_000, 'A 4': 130_000 };

  it('one run: the event races to the standings', () => {
    let e = locked({ A: 4 }, 4, { seedingRuns: 1 }, false);
    expect(kinds(e)).toEqual(['seeding', 'heats', 'placement']);
    e = runRound(e, t, 2_000_000);
    let v = publicView(e, derive(e));
    expect(byName(e, v.seedRuns)).toEqual({ 'A 1': [100_000], 'A 2': [110_000], 'A 3': [120_000], 'A 4': [130_000] });
    expect(byName(e, v.seedScoreMs)).toEqual({ 'A 1': 100_000, 'A 2': 110_000, 'A 3': 120_000, 'A 4': 130_000 });
    expect(v.projector).toBe('seeding-results');
    e = runRound(e, t, 3_000_000); // heats: A 1 beats A 4, A 2 beats A 3
    e = runRound(e, t, 4_000_000); // winners race: A 1 beats A 2; others race: A 3 beats A 4
    v = publicView(e, derive(e));
    expect(names(e, v.standings.a!)).toEqual(['A 1', 'A 2', 'A 3', 'A 4']);
    expect(byName(e, v.seedRank!)).toEqual({ 'A 1': 1, 'A 2': 2, 'A 3': 3, 'A 4': 4 });
    expect(names(e, [v.categoryWinners.a!])).toEqual(['A 1']);
    expect(ok(run(e, { type: 'showChampion', bagTotal: '' })).championShown).toBe(true);
    expect(() => eventCsv(e)).not.toThrow();
    expect(eventCsv(e).split('\n')).toHaveLength(1 + 3 * 4);
    expect(() => fairnessWarnings(e, derive(e))).not.toThrow();
    expect(() => fairnessCsv(e)).not.toThrow();
  });

  it('three runs, drop the slowest: runs, scores and ranks agree, and the event races to the standings', () => {
    let e = locked({ A: 4 }, 4, { seedingRuns: 3, seedingRank: 'dropSlowest', brackets: 'finals' }, false);
    expect(kinds(e)).toEqual(['seeding', 'seeding', 'seeding', 'finals']);
    e = runRound(e, { 'A 1': 60_000, 'A 2': 60_000, 'A 3': 50_000, 'A 4': 70_004 }, 2_000_000);
    // Mid-seeding: a run not raced yet is null and does not count.
    let v = publicView(e, derive(e));
    expect(byName(e, v.seedRuns)).toEqual({ 'A 1': [60_000, null, null], 'A 2': [60_000, null, null], 'A 3': [50_000, null, null], 'A 4': [70_004, null, null] });
    expect(byName(e, v.seedScoreMs)).toEqual({ 'A 1': 60_000, 'A 2': 60_000, 'A 3': 50_000, 'A 4': 70_000 });
    expect(v.seedRank).toBeNull();
    e = runRoundWithDnf(e, { 'A 1': 62_000, 'A 2': 61_000, 'A 3': 1, 'A 4': 70_009 }, ['A 3'], 3_000_000);
    // The small live update stays as it was: totals only.
    expect(Object.keys(publicRoundUpdate(e, derive(e)))).toEqual(['round', 'projector', 'races', 'seedTotalsMs']);
    e = runRoundWithDnf(e, { 'A 1': 1, 'A 2': 90_000, 'A 3': 1, 'A 4': 200_000 }, ['A 1', 'A 3'], 4_000_000);
    v = publicView(e, derive(e));
    expect(byName(e, v.seedRuns)).toEqual({
      'A 1': [60_000, 62_000, null], 'A 2': [60_000, 61_000, 90_000], 'A 3': [50_000, null, null], 'A 4': [70_004, 70_009, 200_000],
    });
    expect(byName(e, v.seedScoreMs)).toEqual({ 'A 1': 122_000, 'A 2': 121_000, 'A 3': 50_000, 'A 4': 140_010 });
    // seedTotalsMs stays the sum of the finished runs.
    expect(byName(e, v.seedTotalsMs)).toEqual({ 'A 1': 122_000, 'A 2': 211_000, 'A 3': 50_000, 'A 4': 340_013 });
    expect(v.projector).toBe('seeding-results');

    // The final: every team in one race, in seed order A 2, A 1, A 4, A 3 (A 3 has one counted run).
    e = ok(run(e, { type: 'openNextRound' }, admin, 5_000_000));
    v = publicView(e, derive(e));
    expect(byName(e, v.seedRank!)).toEqual({ 'A 2': 1, 'A 1': 2, 'A 4': 3, 'A 3': 4 });
    expect(v.rounds[3]).toMatchObject({ kind: 'finals', races: [{ id: 'r4:a:0:final', label: 'A Gold · Final', bracketId: 'a:0' }] });
    expect(e.bracketMembers).toEqual({ 'a:0': ['A 2', 'A 1', 'A 4', 'A 3'].map((n) => teamId(e, n)) });
    expect(e.lineups![4]).toMatchObject([{ id: 'r4:a:0:final', role: 'final', fallbackOrder: e.bracketMembers!['a:0'] }]);
  });

  it('best run with two runs ranks on the faster run', () => {
    let e = locked({ A: 4 }, 4, { seedingRank: 'best' }, false);
    e = runRound(e, { 'A 1': 70_000, 'A 2': 60_000, 'A 3': 65_000, 'A 4': 69_000 }, 2_000_000);
    e = runRoundWithDnf(e, { 'A 1': 71_000, 'A 2': 1, 'A 3': 200_000, 'A 4': 69_000 }, ['A 2'], 3_000_000);
    e = ok(run(e, { type: 'openNextRound' }, admin, 4_000_000));
    const v = publicView(e, derive(e));
    expect(byName(e, v.seedScoreMs)).toEqual({ 'A 1': 70_000, 'A 2': 60_000, 'A 3': 65_000, 'A 4': 69_000 });
    expect(byName(e, v.seedRank!)).toEqual({ 'A 2': 1, 'A 3': 2, 'A 4': 3, 'A 1': 4 });
  });
});

describe('finals only through commands', () => {
  // A: 5 teams and B: 2 teams on 8 tables: rounds 1 seeding, 2 finals (both brackets), 3 grand.
  const seed = { 'A 1': 100_000, 'A 2': 101_000, 'A 3': 102_000, 'A 4': 103_000, 'A 5': 104_000, 'B 1': 100_000, 'B 2': 101_000 };
  const final = { 'A 1': 95_000, 'A 2': 90_000, 'A 3': 96_000, 'A 4': 97_000, 'A 5': 98_000, 'B 1': 95_000, 'B 2': 91_000 };

  it('races to a Grand Champion; the projector shows brackets after the finals round', () => {
    let e = locked({ A: 5, B: 2 }, 8, { seedingRuns: 1, brackets: 'finals' });
    expect(kinds(e)).toEqual(['seeding', 'finals', 'grand']);
    e = runRound(e, seed, 2_000_000);
    e = runRound(e, final, 3_000_000);
    expect(projectorScreen(e, derive(e))).toBe('brackets');
    let v = publicView(e, derive(e));
    expect(names(e, v.standings.a!)).toEqual(['A 2', 'A 1', 'A 3', 'A 4', 'A 5']);
    expect(names(e, v.standings.b!)).toEqual(['B 2', 'B 1']);
    expect(names(e, Object.values(v.categoryWinners))).toEqual(['A 2', 'B 2']);
    expect(code(run(e, { type: 'showChampion', bagTotal: '' }))).toBe('not_finished');
    e = runRound(e, { 'A 2': 80_000, 'B 2': 85_000 }, 4_000_000);
    v = publicView(e, derive(e));
    expect(names(e, [v.grandChampion])).toEqual(['A 2']);
    expect(v.projector).toBe('champion');
    expect(ok(run(e, { type: 'showChampion', bagTotal: '500' })).championShown).toBe(true);
    expect(eventCsv(e).split('\n')).toHaveLength(1 + 7 + 7 + 2);
    expect(() => fairnessWarnings(e, derive(e))).not.toThrow();
    expect(() => fairnessCsv(e)).not.toThrow();
  });

  it('a late seeding correction keeps the saved final and bracket members', () => {
    let e = locked({ A: 5, B: 2 }, 8, { seedingRuns: 1, brackets: 'finals' });
    e = runRound(e, seed, 2_000_000);
    e = ok(run(e, { type: 'openNextRound' }, admin, 3_000_000));
    const members = e.bracketMembers;
    const lineup = e.lineups![2];
    const change: Command = { type: 'setResult', round: 1, teamId: teamId(e, 'A 5'), set: { kind: 'time', rawMs: 50_000 } };
    const asked = run(e, change, admin, 3_000_100);
    expect(code(asked)).toBe('unlock_required');
    // With the corrected time A 5 would be the top seed: other tables in the final, and another seed order.
    expect(detail(asked)).toEqual({ laterRounds: [2], keptRounds: [2], bracketsKept: true });
    e = ok(run(e, { ...change, confirmUnlock: true }, admin, 3_000_100));
    expect(e.bracketMembers).toEqual(members);
    expect(e.lineups![2]).toEqual(lineup);
    expect(derive(e).rounds[1]!.races.find((r) => r.bracketId === 'a:0')!.fallbackOrder).toEqual(members!['a:0']);
  });

  it('rotation splits a two-team final between two referees, and the fairness check sees it', () => {
    // One category of 2 on 2 tables: rounds 1 seeding, 2 finals (one race of two teams at one station).
    let e = setFormat(imported({ A: 2 }, 2), { seedingRuns: 1, brackets: 'finals' });
    e = ok(run(e, { type: 'setSettings', rotateReferees: true }));
    e = ok(run(e, { type: 'suggestSetup' }));
    e = ok(run(e, { type: 'lockSetup' }));
    const open = (ev: LiveEvent, refs: number) => ok(applyCommand(ev, { type: 'openNextRound' }, { ...ctx(admin, 2_000_000), roster: roster(refs) }));
    e = open(e, 2);
    for (const s of Object.keys(e.stations)) e = ok(run(e, { type: 'overrideStation', station: Number(s), state: 'ready' }));
    e = ok(run(e, { type: 'startRace' }));
    for (const t of e.setup.teams) e = ok(run(e, { type: 'setResult', round: 1, teamId: t.id, set: { kind: 'time', rawMs: 100_000 + t.order * 1000 } }));
    e = ok(run(e, { type: 'finishRace' }));
    const split = open(e, 2);
    expect(split.assignments![2]!.map((a) => a.tables)).toEqual([[1], [2]]);
    expect(fairnessWarnings(split, derive(split)).filter((w) => w.kind === 'final_one_referee')).toEqual([]);
    const alone = open(e, 1);
    expect(alone.assignments![2]!.map((a) => a.tables)).toEqual([[1, 2]]);
    expect(fairnessWarnings(alone, derive(alone)).map((w) => w.kind)).toContain('final_one_referee');
  });
});

describe('seeding only through commands', () => {
  const seedA = { 'A 1': 110_000, 'A 2': 100_000, 'A 3': 120_000 };
  const seedB = { 'B 1': 210_000, 'B 2': 200_000 };

  it('two categories: the grand round races the top seeds and the event ends with a champion', () => {
    let e = locked({ A: 3, B: 2 }, 5, { brackets: 'none' });
    expect(kinds(e)).toEqual(['seeding', 'seeding', 'grand']);
    e = runRound(e, { ...seedA, ...seedB }, 2_000_000);
    let v = publicView(e, derive(e));
    expect(v.projector).toBe('seeding-results');
    expect(v.standings).toEqual({ a: [null, null, null], b: [null, null] });
    expect(v.categoryWinners).toEqual({ a: null, b: null });
    e = runRound(e, { ...seedA, ...seedB }, 3_000_000);
    v = publicView(e, derive(e));
    expect(v.projector).toBe('seeding-results');
    expect(names(e, v.standings.a!)).toEqual(['A 2', 'A 1', 'A 3']);
    expect(names(e, v.standings.b!)).toEqual(['B 2', 'B 1']);
    expect(names(e, Object.values(v.categoryWinners))).toEqual(['A 2', 'B 2']);
    expect(v.brackets).toEqual([]);
    expect(code(run(e, { type: 'showChampion', bagTotal: '' }))).toBe('not_finished');

    e = ok(run(e, { type: 'openNextRound' }, admin, 4_000_000));
    expect(e.bracketMembers).toBeUndefined();
    expect(e.lineups![3]).toMatchObject([{ id: 'r3:grand', role: 'grand', teams: [teamId(e, 'A 2'), teamId(e, 'B 2')] }]);
    expect(projectorScreen(e, derive(e))).toBe('tables');
    for (const s of Object.keys(e.stations)) e = ok(run(e, { type: 'overrideStation', station: Number(s), state: 'ready' }, admin, 4_000_000));
    e = ok(run(e, { type: 'startRace' }, admin, 4_000_000));
    e = ok(run(e, { type: 'setResult', round: 3, teamId: teamId(e, 'A 2'), set: { kind: 'time', rawMs: 90_004 } }, admin, 4_000_001));
    e = ok(run(e, { type: 'setResult', round: 3, teamId: teamId(e, 'B 2'), set: { kind: 'time', rawMs: 90_001 } }, admin, 4_000_001));
    e = ok(run(e, { type: 'finishRace' }, admin, 4_000_002));

    // A tie in the grand race: no champion yet, and never the brackets screen.
    expect(derive(e).grandChampion).toBeNull();
    expect(projectorScreen(e, derive(e))).toBe('seeding-results');
    expect(code(run(e, { type: 'showChampion', bagTotal: '' }))).toBe('tie_undecided');
    e = ok(run(e, { type: 'decideTie', raceId: 'r3:grand', order: [teamId(e, 'B 2'), teamId(e, 'A 2')] }));
    v = publicView(e, derive(e));
    expect(names(e, [v.grandChampion])).toEqual(['B 2']);
    expect(v.projector).toBe('champion');
    e = ok(run(e, { type: 'showChampion', bagTotal: '1,000' }));
    expect(publicView(e, derive(e))).toMatchObject({ championShown: true, projector: 'champion', bagTotal: '1,000' });
    expect(eventCsv(e).split('\n')).toHaveLength(1 + 5 + 5 + 2);
    expect(() => fairnessWarnings(e, derive(e))).not.toThrow();
    expect(() => fairnessCsv(e)).not.toThrow();
  });

  it('one category with the Grand Championship on: no grand round, and the champion screen has the winner', () => {
    let e = locked({ A: 3 }, 4, { brackets: 'none', seedingRuns: 3, seedingRank: 'dropSlowest' }, true);
    expect(e.setup.grandChampionship).toBe(true);
    expect(kinds(e)).toEqual(['seeding', 'seeding', 'seeding']);
    e = runRound(e, seedA, 2_000_000);
    e = runRound(e, seedA, 3_000_000);
    expect(code(run(e, { type: 'showChampion', bagTotal: '' }))).toBe('not_finished');
    expect(publicView(e, derive(e)).categoryWinners).toEqual({ a: null });
    e = runRoundWithDnf(e, { ...seedA, 'A 2': 1 }, ['A 2'], 4_000_000);

    let v = publicView(e, derive(e));
    expect(v.projector).toBe('seeding-results');
    expect(v.rounds.some((r) => r.kind === 'grand')).toBe(false);
    expect(v.grandChampion).toBeNull();
    expect(names(e, v.standings.a!)).toEqual(['A 2', 'A 1', 'A 3']);
    expect(names(e, [v.categoryWinners.a!])).toEqual(['A 2']);
    expect(code(run(e, { type: 'openNextRound' }))).toBe('event_complete');

    e = ok(run(e, { type: 'showChampion', bagTotal: '250' }));
    v = publicView(e, derive(e));
    expect(v).toMatchObject({ championShown: true, projector: 'champion', bagTotal: '250' });
    expect(names(e, [v.categoryWinners.a!])).toEqual(['A 2']);
    e = ok(run(e, { type: 'hideChampion' }));
    expect(projectorScreen(e, derive(e))).toBe('seeding-results');
    expect(eventCsv(e).split('\n')).toHaveLength(1 + 9);
    expect(() => fairnessWarnings(e, derive(e))).not.toThrow();
  });

  it('a cleared seeding result holds the champion back until it is entered', () => {
    let e = locked({ A: 3 }, 4, { brackets: 'none', seedingRuns: 1 }, false);
    e = runRound(e, seedA, 2_000_000);
    e = ok(run(e, { type: 'setResult', round: 1, teamId: teamId(e, 'A 2'), set: { kind: 'clear' } }));
    const v = publicView(e, derive(e));
    expect(v.standings).toEqual({ a: [null, null, null] });
    expect(v.categoryWinners).toEqual({ a: null });
    expect(v.seedRuns[teamId(e, 'A 2')]).toEqual([null]);
    expect(v.seedScoreMs[teamId(e, 'A 2')]).toBeNull();
    expect(code(run(e, { type: 'showChampion', bagTotal: '' }))).toBe('blocked');
    e = ok(run(e, { type: 'setResult', round: 1, teamId: teamId(e, 'A 2'), set: { kind: 'status', status: 'dns' } }));
    expect(names(e, publicView(e, derive(e)).standings.a!)).toEqual(['A 1', 'A 3', 'A 2']);
    expect(ok(run(e, { type: 'showChampion', bagTotal: '' })).championShown).toBe(true);
  });

  it('a pending penalty holds the champion back', () => {
    let e = locked({ A: 3 }, 4, { brackets: 'none', seedingRuns: 1 }, false);
    e = ok(run(e, { type: 'setPenaltiesEnabled', enabled: true }));
    e = ok(run(e, { type: 'openNextRound' }));
    for (const s of Object.keys(e.stations)) e = ok(run(e, { type: 'overrideStation', station: Number(s), state: 'ready' }));
    e = ok(run(e, { type: 'startRace' }));
    e = ok(run(e, { type: 'tapPenalty', teamId: teamId(e, 'A 1'), clientTapId: 'p1' }, referee(1)));
    for (const t of e.setup.teams) e = ok(run(e, { type: 'setResult', round: 1, teamId: t.id, set: { kind: 'time', rawMs: 100_000 } }));
    e = ok(run(e, { type: 'finishRace' }));
    expect(code(run(e, { type: 'showChampion', bagTotal: '' }))).toBe('penalties_pending');
  });
});

describe('referee_wins with a seeding rank rule', () => {
  it('predicts each race from the value the teams were ranked on', () => {
    // Best run, two runs. A 2 has the best single run but the worst total; ranked first.
    let e = setFormat(imported({ A: 4 }, 4), { seedingRank: 'best', brackets: 'finals' });
    e = ok(run(e, { type: 'setGrandChampionship', enabled: false }));
    e = ok(run(e, { type: 'suggestSetup' }));
    e = ok(run(e, { type: 'lockSetup' }));
    e = runRound(e, { 'A 1': 100_000, 'A 2': 90_000, 'A 3': 110_000, 'A 4': 120_000 }, 2_000_000);
    e = runRound(e, { 'A 1': 100_000, 'A 2': 900_000, 'A 3': 110_000, 'A 4': 120_000 }, 3_000_000);
    e = runRound(e, { 'A 2': 100_000, 'A 1': 101_000, 'A 3': 102_000, 'A 4': 103_000 }, 4_000_000);
    expect(names(e, derive(e).standings.a!)).toEqual(['A 2', 'A 1', 'A 3', 'A 4']);
    // Every team finished exactly where its seeding predicted, so no referee is ahead.
    const d = derive(e);
    const withJudges: LiveEvent = { ...e, assignments: { 3: [1, 2, 3, 4].map((n) => ({ deviceId: `dev${n}`, name: `Ref ${n}`, station: n, tables: [n] })) } };
    expect(fairnessWarnings(withJudges, d).filter((w) => w.kind === 'referee_wins')).toEqual([]);
  });
});
