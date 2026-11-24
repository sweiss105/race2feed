import { describe, it, expect } from 'vitest';
import { applyCommand } from '../../src/core/apply';
import { eventCsv } from '../../src/core/export';
import type { Command, LiveEvent } from '../../src/core/model';
import { admin, ctx, lockedFour, ok, referee, teamId } from './helpers';

const run = (e: LiveEvent, cmd: Command, actor = admin, now = 2_000_000) => applyCommand(e, cmd, ctx(actor, now));

describe('eventCsv', () => {
  it('neutralises text that a spreadsheet would read as a formula', () => {
    let e = lockedFour();
    e = ok(run(e, { type: 'renameTeam', teamId: teamId(e, 'T2'), name: '+Plus Team' }));
    e = ok(run(e, { type: 'setPenaltiesEnabled', enabled: true }));
    e = ok(run(e, { type: 'openNextRound' }));
    for (const [s, st] of Object.entries(e.stations)) if (!st.excluded) e = ok(run(e, { type: 'overrideStation', station: Number(s), state: 'ready' }));
    e = ok(run(e, { type: 'startRace' }));
    e = ok(run(e, { type: 'tapPenalty', teamId: teamId(e, 'T1'), clientTapId: 'p1' }, referee(1)));
    const tapId = e.taps.at(-1)!.id;
    for (const t of e.setup.teams) e = ok(run(e, { type: 'setResult', round: 1, teamId: t.id, set: { kind: 'time', rawMs: 150_000 } }));
    e = ok(run(e, { type: 'finishRace' }, admin, 2_000_001));
    e = ok(run(e, { type: 'notePenalty', tapId, reasonId: 'early', note: '=HYPERLINK("http://x","y")' }, referee(1)));

    const csv = eventCsv(e);
    expect(csv).toContain(`"'=HYPERLINK(""http://x"",""y"")"`);
    expect(csv).toContain(`'+Plus Team`);
    expect(csv).not.toMatch(/(^|,)"?[=+@-]/m);
  });

  it('prefixes every formula-leading character in team names but leaves numbers alone', () => {
    let e = lockedFour();
    const renames: [string, string][] = [['T1', '@At'], ['T2', '-Dash'], ['T3', '=Eq'], ['T4', '+Plus']];
    for (const [from, name] of renames) e = ok(run(e, { type: 'renameTeam', teamId: teamId(e, from), name }));
    e = ok(run(e, { type: 'setPenaltiesEnabled', enabled: true }));
    e = ok(run(e, { type: 'openNextRound' }));
    for (const [s, st] of Object.entries(e.stations)) if (!st.excluded) e = ok(run(e, { type: 'overrideStation', station: Number(s), state: 'ready' }));
    e = ok(run(e, { type: 'startRace' }));
    e = ok(run(e, { type: 'tapPenalty', teamId: teamId(e, '@At'), clientTapId: 'p1' }, referee(1)));
    for (const t of e.setup.teams) e = ok(run(e, { type: 'setResult', round: 1, teamId: t.id, set: { kind: 'time', rawMs: 150_000 } }));
    e = ok(run(e, { type: 'finishRace' }, admin, 2_000_001));
    e = ok(run(e, { type: 'decidePenalty', tapId: e.taps.at(-1)!.id, decision: 'approve', reasonId: 'early' }));

    const rows = eventCsv(e).split('\n').map((l) => l.split(','));
    for (const name of ['@At', '-Dash', '=Eq', '+Plus']) expect(rows.some((r) => r[1] === `'${name}`)).toBe(true);
    const penalised = rows.find((r) => r[1] === "'@At")!;
    expect(penalised[6]).toBe('10000');
    expect(penalised[6]).not.toContain("'");
  });
});
