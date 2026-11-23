import { describe, it, expect } from 'vitest';
import { applyCommand } from '../../src/core/apply';
import { eventCsv } from '../../src/core/export';
import type { Command, LiveEvent } from '../../src/core/model';
import { control, ctx, lockedFour, ok, referee, teamId } from './helpers';

const run = (e: LiveEvent, cmd: Command, actor = control, now = 2_000_000) => applyCommand(e, cmd, ctx(actor, now));

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
    e = ok(run(e, { type: 'finishRace' }, control, 2_000_001));
    e = ok(run(e, { type: 'notePenalty', tapId, reasonId: 'early', note: '=HYPERLINK("http://x","y")' }, referee(1)));

    const csv = eventCsv(e);
    expect(csv).toContain(`"'=HYPERLINK(""http://x"",""y"")"`);
    expect(csv).toContain(`'+Plus Team`);
    expect(csv).not.toMatch(/(^|,)"?[=+@-]/m);
  });
});
