import { describe, it, expect } from 'vitest';
import { applyCommand } from '../../src/core/apply';
import { admin, companion, control, ctx, lockedFour, referee } from './helpers';

const code = (r: ReturnType<typeof applyCommand>) => (r.ok ? 'ok' : r.code);

describe('applyCommand permissions', () => {
  it('referees cannot start races', () => {
    expect(code(applyCommand(lockedFour(), { type: 'startRace' }, ctx(referee(1))))).toBe('forbidden');
  });
  it('companion may start races (gates still apply)', () => {
    expect(code(applyCommand(lockedFour(), { type: 'startRace' }, ctx(companion)))).toBe('round_not_open');
  });
  it('race control cannot change setup; admin can', () => {
    expect(code(applyCommand(lockedFour(), { type: 'setBagTotal', text: '1' }, ctx(control)))).toBe('forbidden');
    expect(code(applyCommand(lockedFour(), { type: 'setBagTotal', text: '1' }, ctx(admin)))).toBe('ok');
  });
  it('race control can rename a team during the event, but not change other setup', () => {
    const e = lockedFour();
    const r = applyCommand(e, { type: 'renameTeam', teamId: e.setup.teams[0]!.id, name: 'Renamed' }, ctx(control));
    expect(r.ok && r.event.setup.teams[0]!.name).toBe('Renamed');
    expect(code(applyCommand(e, { type: 'addTeam', name: 'Z', category: 'T' }, ctx(control)))).toBe('forbidden');
  });

  it('admin can do anything race control can', () => {
    expect(code(applyCommand(lockedFour(), { type: 'openNextRound' }, ctx(admin)))).toBe('ok');
  });
  it('fills the audit entry', () => {
    const r = applyCommand(lockedFour(), { type: 'openNextRound' }, ctx(control));
    expect(r.ok && r.audit).toEqual({ action: 'openNextRound', actor: 'control', detail: { type: 'openNextRound' } });
  });
  it('rejects unknown commands', () => {
    expect(code(applyCommand(lockedFour(), { type: 'nope' } as never, ctx(admin)))).toBe('unknown_command');
    expect(code(applyCommand(lockedFour(), { type: 'constructor' } as never, ctx(admin)))).toBe('unknown_command');
    expect(code(applyCommand(lockedFour(), { type: 'toString' } as never, ctx(admin)))).toBe('unknown_command');
  });
});
