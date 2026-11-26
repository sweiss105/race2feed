import { describe, it, expect } from 'vitest';
import { handleSetup } from '../../src/core/setup';
import { handleLifecycle } from '../../src/core/lifecycle';
import { derive } from '../../src/core/results';
import type { CommandResult } from '../../src/core/model';
import { admin, blank, csvFor, ctx, ok, runRound } from './helpers';

const code = (r: CommandResult) => (r.ok ? 'ok' : r.code);

const importTeams = (csv: string, tables = 26) =>
  ok(handleSetup(blank(tables), { type: 'importTeams', csv }, ctx(admin)));

describe('setup commands', () => {
  it('importTeams orders categories by first appearance with slug ids', () => {
    const e = importTeams('team,category\nA,High School\nB,Corporate\nC,High School\n');
    expect(e.setup.categories).toEqual([
      { id: 'high-school', name: 'High School' },
      { id: 'corporate', name: 'Corporate' },
    ]);
    expect(e.setup.teams.map((t) => [t.name, t.categoryId, t.order])).toEqual([
      ['A', 'high-school', 0], ['B', 'corporate', 1], ['C', 'high-school', 2],
    ]);
  });

  it('keeps categories apart when their names differ only in symbols or script', () => {
    const e = ok(handleSetup(blank(), { type: 'importTeams', csv: 'team,category\nOne,A\nTwo,A+\nThree,中学\nFour,高校\nFive,a' }, ctx(admin)));
    expect(e.setup.categories.map((c) => c.name)).toEqual(['A', 'A+', '中学', '高校']);
    expect(new Set(e.setup.categories.map((c) => c.id)).size).toBe(4);
    expect(e.setup.categories.every((c) => c.id.length > 0)).toBe(true);
    expect(e.setup.teams[4]!.categoryId).toBe(e.setup.categories[0]!.id); // 'a' joins 'A'
  });

  it('importTeams rejects a CSV with errors', () => {
    const r = handleSetup(blank(), { type: 'importTeams', csv: 'nope' }, ctx(admin));
    expect(r.ok).toBe(false);
  });

  it('importTeams lists names over 35 characters by line and imports nothing', () => {
    const long = 'L'.repeat(36);
    const r = handleSetup(blank(), { type: 'importTeams', csv: `team,category\n${'A'.repeat(35)},HS\n${long},HS\n` }, ctx(admin));
    expect(r).toMatchObject({ ok: false, code: 'csv_invalid', detail: [`line 3: "${long}" is 36 characters; team names can be at most 35`] });
  });

  it('addTeam and renameTeam refuse a name over 35 characters and accept exactly 35', () => {
    let e = importTeams('team,category\nA,HS\n');
    const long = 'L'.repeat(36);
    expect(handleSetup(e, { type: 'addTeam', name: long, category: 'HS' }, ctx(admin))).toMatchObject({ ok: false, code: 'invalid' });
    expect(handleSetup(e, { type: 'renameTeam', teamId: e.setup.teams[0]!.id, name: long }, ctx(admin))).toMatchObject({ ok: false, code: 'invalid' });
    e = ok(handleSetup(e, { type: 'renameTeam', teamId: e.setup.teams[0]!.id, name: 'B'.repeat(35) }, ctx(admin)));
    expect(e.setup.teams[0]!.name).toHaveLength(35);
  });

  it('suggestSetup fills groups and brackets', () => {
    let e = importTeams(csvFor({ 'High School': 14, Community: 16, Corporate: 20 }));
    e = ok(handleSetup(e, { type: 'suggestSetup' }, ctx(admin)));
    expect(e.setup.groups.length).toBe(2);
    expect(e.setup.brackets.length).toBe(12);
    expect(Object.keys(e.setup.tableOf).length).toBe(50);
  });

  it('lockSetup reports validation errors naming the team', () => {
    let e = importTeams(csvFor({ 'High School': 4 }), 4);
    e = ok(handleSetup(e, { type: 'suggestSetup' }, ctx(admin)));
    const missing = e.setup.groups[0]!.teamIds.pop()!;
    const name = e.setup.teams.find((t) => t.id === missing)!.name;
    const r = handleSetup(e, { type: 'lockSetup' }, ctx(admin));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('setup_invalid');
      expect(JSON.stringify(r.detail)).toContain(name);
    }
  });

  it('lockSetup rejects an event with no teams', () => {
    const r = handleSetup(blank(), { type: 'lockSetup' }, ctx(admin));
    expect(r.ok).toBe(false);
  });

  it('setup commands that change who races are refused once locked', () => {
    let e = importTeams(csvFor({ 'High School': 4 }), 4);
    e = ok(handleSetup(e, { type: 'suggestSetup' }, ctx(admin)));
    e = ok(handleSetup(e, { type: 'lockSetup' }, ctx(admin)));
    expect(e.setupLocked).toBe(true);
    const r = handleSetup(e, { type: 'addTeam', name: 'Late', category: 'High School' }, ctx(admin));
    expect(r.ok ? null : r.code).toBe('setup_locked');
    expect(handleSetup(e, { type: 'setBagTotal', text: '9,816' }, ctx(admin)).ok).toBe(true);
    expect(handleSetup(e, { type: 'unlockSetup' }, ctx(admin)).ok).toBe(true);
  });

  it('team names and settings can still change once locked', () => {
    let e = importTeams(csvFor({ 'High School': 4 }), 4);
    e = ok(handleSetup(e, { type: 'suggestSetup' }, ctx(admin)));
    e = ok(handleSetup(e, { type: 'lockSetup' }, ctx(admin)));
    e = ok(handleSetup(e, { type: 'renameTeam', teamId: e.setup.teams[0]!.id, name: 'Fixed Name' }, ctx(admin)));
    e = ok(handleSetup(e, { type: 'setSettings', undoWindowMs: 15_000 }, ctx(admin)));
    expect(e.setup.teams[0]!.name).toBe('Fixed Name');
    expect(e.settings.undoWindowMs).toBe(15_000);
  });

  it('rejects malformed groups and brackets', () => {
    const e = importTeams(csvFor({ 'High School': 4 }), 4);
    expect(handleSetup(e, { type: 'setGroups', groups: 'x', tableOf: {} } as never, ctx(admin)).ok).toBe(false);
    expect(handleSetup(e, { type: 'setGroups', groups: [{ id: 'A', teamIds: [1] }], tableOf: {} } as never, ctx(admin)).ok).toBe(false);
    expect(handleSetup(e, { type: 'setBrackets', brackets: [{ id: 'b' }] } as never, ctx(admin)).ok).toBe(false);
  });

  it('unlockSetup is refused after rounds start', () => {
    let e = importTeams(csvFor({ 'High School': 4 }), 4);
    e = ok(handleSetup(e, { type: 'suggestSetup' }, ctx(admin)));
    e = ok(handleSetup(e, { type: 'lockSetup' }, ctx(admin)));
    e = { ...e, round: { ...e.round, current: 1 } };
    const r = handleSetup(e, { type: 'unlockSetup' }, ctx(admin));
    expect(r.ok ? null : r.code).toBe('rounds_started');
  });

  it('add, rename, remove teams and settings', () => {
    let e = importTeams('team,category\nA,HS\n');
    e = ok(handleSetup(e, { type: 'addTeam', name: 'B', category: 'HS' }, ctx(admin)));
    const b = e.setup.teams.find((t) => t.name === 'B')!;
    e = ok(handleSetup(e, { type: 'renameTeam', teamId: b.id, name: 'Bee' }, ctx(admin)));
    expect(e.setup.teams.map((t) => t.name)).toEqual(['A', 'Bee']);
    e = ok(handleSetup(e, { type: 'removeTeam', teamId: b.id }, ctx(admin)));
    expect(e.setup.teams.length).toBe(1);
    e = ok(handleSetup(e, { type: 'setSettings', undoWindowMs: 3000 }, ctx(admin)));
    expect(e.settings).toEqual({ penaltiesEnabled: false, undoWindowMs: 3000, rotateReferees: false });
    e = ok(handleSetup(e, { type: 'setTableCount', tableCount: 10 }, ctx(admin)));
    expect(e.setup.tableCount).toBe(10);
  });

  it('changing the number of tables clears groups, tables and brackets; Suggest rebuilds them', () => {
    let e = ok(handleSetup(importTeams(csvFor({ 'High School': 8 }), 4), { type: 'suggestSetup' }, ctx(admin)));
    expect(e.setup.groups).toHaveLength(2);
    expect(e.setup.brackets.length).toBeGreaterThan(0);
    // The same number changes nothing.
    expect(ok(handleSetup(e, { type: 'setTableCount', tableCount: 4 }, ctx(admin))).setup).toEqual(e.setup);
    e = ok(handleSetup(e, { type: 'setTableCount', tableCount: 8 }, ctx(admin)));
    expect(e.setup).toMatchObject({ tableCount: 8, groups: [], tableOf: {}, brackets: [] });
    expect(e.setup.teams).toHaveLength(8);
    e = ok(handleSetup(e, { type: 'suggestSetup' }, ctx(admin)));
    expect(e.setup.groups).toHaveLength(1);
    expect(ok(handleSetup(e, { type: 'lockSetup' }, ctx(admin))).setupLocked).toBe(true);
  });

  it('refuses a table count that is not a whole number of at least 1, and any change once locked', () => {
    const e = importTeams(csvFor({ 'High School': 4 }), 4);
    for (const tableCount of [0, -2, 2.5, Number.NaN]) {
      expect(handleSetup(e, { type: 'setTableCount', tableCount }, ctx(admin))).toMatchObject({ ok: false, code: 'invalid' });
    }
    const locked = ok(handleSetup(ok(handleSetup(e, { type: 'suggestSetup' }, ctx(admin))), { type: 'lockSetup' }, ctx(admin)));
    expect(handleSetup(locked, { type: 'setTableCount', tableCount: 6 }, ctx(admin))).toMatchObject({ ok: false, code: 'setup_locked' });
  });

  describe('removing the last team of a category', () => {
    /** Three tables, two A teams and one B team, Grand Championship on, suggested groups and brackets; then B's only team is removed. */
    function lastTeamRemoved() {
      let e = importTeams(csvFor({ A: 2, B: 1 }), 3);
      expect(e.setup.grandChampionship).toBe(true);
      e = ok(handleSetup(e, { type: 'suggestSetup' }, ctx(admin)));
      expect(e.setup.brackets.map((b) => b.id)).toEqual(['a:0', 'b:0']);
      return ok(handleSetup(e, { type: 'removeTeam', teamId: e.setup.teams.find((t) => t.name === 'B 1')!.id }, ctx(admin)));
    }

    it('removes the category and its bracket, so no one-team Grand Championship is scheduled', () => {
      let e = lastTeamRemoved();
      expect(e.setup.categories.map((c) => c.id)).toEqual(['a']);
      expect(e.setup.brackets.map((b) => b.id)).toEqual(['a:0']);
      // Locked without suggesting again, then qualifying raced.
      e = ok(handleSetup(e, { type: 'lockSetup' }, ctx(admin)));
      expect(derive(e).rounds.map((r) => r.spec.kind)).toEqual(['seeding', 'seeding', 'heats']);
      for (let i = 0; i < 3; i++) e = runRound(e, { 'A 1': 100_000, 'A 2': 110_000 });
      expect(derive(e).rounds.some((r) => r.spec.kind === 'grand')).toBe(false);
      expect(code(handleLifecycle(e, { type: 'openNextRound' }, ctx(admin)))).toBe('event_complete');
    });

    it('removes a seeding group left empty, with its table assignments', () => {
      // Two tables: group A holds A 1 and A 2, group B holds only B 1.
      let e = ok(handleSetup(importTeams(csvFor({ A: 2, B: 1 }), 2), { type: 'suggestSetup' }, ctx(admin)));
      expect(e.setup.groups.map((g) => g.teamIds.length)).toEqual([2, 1]);
      const b1 = e.setup.teams.find((t) => t.name === 'B 1')!.id;
      e = ok(handleSetup(e, { type: 'removeTeam', teamId: b1 }, ctx(admin)));
      expect(e.setup.groups.map((g) => g.id)).toEqual(['A']);
      expect(Object.keys(e.setup.tableOf)).not.toContain(b1);
      e = ok(handleSetup(e, { type: 'lockSetup' }, ctx(admin)));
      expect(derive(e).rounds.map((r) => r.spec.kind)).toEqual(['seeding', 'seeding', 'heats']);
    });

    it('a team removed from a category that keeps others leaves the brackets for lock to report', () => {
      let e = ok(handleSetup(importTeams(csvFor({ A: 2, B: 1 }), 3), { type: 'suggestSetup' }, ctx(admin)));
      e = ok(handleSetup(e, { type: 'removeTeam', teamId: e.setup.teams.find((t) => t.name === 'A 2')!.id }, ctx(admin)));
      expect(e.setup.brackets.map((b) => b.id)).toEqual(['a:0', 'b:0']);
      const r = handleSetup(e, { type: 'lockSetup' }, ctx(admin));
      expect(r.ok ? [] : r.detail).toEqual(['A: brackets hold 2 teams but the category has 1']);
    });

    it('lock reports a bracket whose category has no teams', () => {
      // The state an event stored before the fix can be in: the category is gone, its bracket is not.
      const e = lastTeamRemoved();
      const stale = { ...e, setup: { ...e.setup, brackets: [...e.setup.brackets, { id: 'b:0', categoryId: 'b', tierIndex: 0, tierName: 'Gold', firstSeed: 1, size: 1 }] } };
      const r = handleSetup(stale, { type: 'lockSetup' }, ctx(admin));
      expect(r.ok ? 'ok' : r.code).toBe('setup_invalid');
      expect(r.ok ? [] : r.detail).toEqual(['Gold bracket "b:0": its category has no teams. Remove it, or suggest groups and brackets again.']);
      // setBrackets can name a category that does not exist: the same report.
      const set = ok(handleSetup(e, { type: 'setBrackets', brackets: stale.setup.brackets }, ctx(admin)));
      expect(code(handleSetup(set, { type: 'lockSetup' }, ctx(admin)))).toBe('setup_invalid');
    });
  });
});
