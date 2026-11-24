import { describe, it, expect, vi, afterEach } from 'vitest';
import { applyCommand, PERMISSIONS } from '../../src/core/apply';
import { handleLifecycle } from '../../src/core/lifecycle';
import { admin, blank, companion, ctx, lockedFour, ok, referee } from './helpers';

const code = (r: ReturnType<typeof applyCommand>) => (r.ok ? 'ok' : r.code);

describe('applyCommand permissions', () => {
  it('referees cannot start races', () => {
    expect(code(applyCommand(lockedFour(), { type: 'startRace' }, ctx(referee(1))))).toBe('forbidden');
  });
  it('companion may start races (gates still apply)', () => {
    expect(code(applyCommand(lockedFour(), { type: 'startRace' }, ctx(companion)))).toBe('round_not_open');
  });
  it('referees and Companion are refused setup, round and champion commands', () => {
    const cmds = [
      { type: 'setBagTotal', text: '1' }, { type: 'addTeam', name: 'Z', category: 'T' },
      { type: 'setPenaltyReasons', reasons: [] }, { type: 'setTablesPerReferee', count: 1 },
      { type: 'openNextRound' }, { type: 'showChampion', bagTotal: 1 },
    ];
    for (const actor of [referee(1), companion]) {
      for (const cmd of cmds) expect(code(applyCommand(lockedFour(), cmd as never, ctx(actor))), `${actor.role} ${cmd.type}`).toBe('forbidden');
    }
    for (const type of ['startRace', 'finishRace', 'pinProjector'] as const) {
      expect(PERMISSIONS[type]).toContain('companion');
    }
    expect(PERMISSIONS.openNextRound).toEqual(['admin']);
  });
  it('every setup command is admin only', () => {
    const setup = ['importTeams', 'addTeam', 'renameTeam', 'removeTeam', 'setTableCount', 'setTablesPerReferee', 'suggestSetup', 'setGroups',
      'setBrackets', 'setGrandChampionship', 'lockSetup', 'unlockSetup', 'setSettings', 'setBagTotal', 'setPenaltyReasons'] as const;
    for (const t of setup) expect(PERMISSIONS[t], t).toEqual(['admin']);
  });
  it('the console role can change setup', () => {
    expect(code(applyCommand(lockedFour(), { type: 'setBagTotal', text: '1' }, ctx(admin)))).toBe('ok');
  });
  it('the console role can rename a team during the event', () => {
    const e = lockedFour();
    const r = applyCommand(e, { type: 'renameTeam', teamId: e.setup.teams[0]!.id, name: 'Renamed' }, ctx(admin));
    expect(r.ok && r.event.setup.teams[0]!.name).toBe('Renamed');
  });

  it('the console role can run the race', () => {
    expect(code(applyCommand(lockedFour(), { type: 'openNextRound' }, ctx(admin)))).toBe('ok');
  });
  it('fills the audit entry', () => {
    const r = applyCommand(lockedFour(), { type: 'openNextRound' }, ctx(admin));
    expect(r.ok && r.audit).toEqual({ action: 'openNextRound', actor: 'admin', detail: { type: 'openNextRound' } });
  });
  it('rejects unknown commands', () => {
    expect(code(applyCommand(lockedFour(), { type: 'nope' } as never, ctx(admin)))).toBe('unknown_command');
    expect(code(applyCommand(lockedFour(), { type: 'constructor' } as never, ctx(admin)))).toBe('unknown_command');
    expect(code(applyCommand(lockedFour(), { type: 'toString' } as never, ctx(admin)))).toBe('unknown_command');
  });
});

describe('applyCommand malformed commands', () => {
  afterEach(() => vi.restoreAllMocks());

  it('refuses a malformed command instead of throwing', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const cmd of [{ type: 'renameTeam', teamId: 'x', name: 5 }, { type: 'importTeams', csv: null }, { type: 'setBagTotal' }, { type: 'addTeam', name: {}, category: [] }]) {
      const r = applyCommand(blank(), cmd as never, ctx(admin));
      expect(r.ok ? 'ok' : r.code).toBe('invalid');
    }
  });

  it('reports a fault inside a tap handler as a retryable server error', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    let e = ok(applyCommand(lockedFour(), { type: 'openNextRound' }, ctx(admin)));
    for (const station of [1, 2]) e = ok(handleLifecycle(e, { type: 'overrideStation', station, state: 'ready' }, ctx(admin)));
    e = ok(applyCommand(e, { type: 'startRace' }, ctx(admin)));
    const broken = { ...e, lineups: { 1: {} as never } };
    const tap = { type: 'tapFinish' as const, teamId: e.setup.teams[0]!.id, atServerMs: 1_000_500, clientTapId: 'c1' };
    expect(code(applyCommand(broken, tap, ctx(referee(1), 1_000_600)))).toBe('server_error');
    expect(error).toHaveBeenCalledTimes(1);
  });
});
