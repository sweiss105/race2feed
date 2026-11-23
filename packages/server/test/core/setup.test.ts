import { describe, it, expect } from 'vitest';
import { handleSetup } from '../../src/core/setup';
import { admin, blank, csvFor, ctx, ok } from './helpers';

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

  it('importTeams rejects a CSV with errors', () => {
    const r = handleSetup(blank(), { type: 'importTeams', csv: 'nope' }, ctx(admin));
    expect(r.ok).toBe(false);
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
    e = ok(handleSetup(e, { type: 'setSettings', penaltyMs: 3000 }, ctx(admin)));
    expect(e.settings).toEqual({ penaltiesEnabled: false, penaltyMs: 3000, undoWindowMs: 10_000 });
    e = ok(handleSetup(e, { type: 'setTableCount', tableCount: 10 }, ctx(admin)));
    expect(e.setup.tableCount).toBe(10);
  });
});
