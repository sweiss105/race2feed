import { describe, it, expect } from 'vitest';
import { applyCommand } from '../../src/core/apply';
import { derive } from '../../src/core/results';
import { projectorScreen, publicView } from '../../src/core/views';
import { needsSnapshot } from '../../src/core/broadcast';
import { handleSetup } from '../../src/core/setup';
import { admin, blank, csvFor, ctx, lockedFour, ok, runRound, teamId } from './helpers';

const times = { T1: 100_000, T2: 110_000, T3: 120_000, T4: 130_000 };
const code = (r: ReturnType<typeof applyCommand>) => (r.ok ? 'ok' : r.code);

describe('show champion', () => {
  it('is only possible once the last round is finished', () => {
    const e = runRound(lockedFour(), times);
    expect(code(applyCommand(e, { type: 'showChampion', bagTotal: '1,234' }, ctx(admin)))).toBe('not_finished');
  });

  it('sets the bag total and shows the champion screen everywhere', () => {
    let e = lockedFour();
    for (let i = 0; i < 4; i++) e = runRound(e, times);
    e = ok(applyCommand(e, { type: 'showChampion', bagTotal: ' 1,234 ' }, ctx(admin)));
    expect(e.bagTotal).toBe('1,234');
    const v = publicView(e, derive(e));
    expect(v).toMatchObject({ championShown: true, ended: false, bagTotal: '1,234', projector: 'champion' });
    e = ok(applyCommand(e, { type: 'hideChampion' }, ctx(admin)));
    expect(projectorScreen(e, derive(e))).toBe('brackets');
    expect(publicView(e, derive(e)).championShown).toBe(false);
  });

  it('refreshes every phone when shown or hidden', () => {
    const e = lockedFour();
    expect(needsSnapshot({ type: 'showChampion', bagTotal: '' }, e)).toBe(true);
    expect(needsSnapshot({ type: 'hideChampion' }, e)).toBe(true);
  });

  it('an ended event shows the champion screen', () => {
    const e = { ...lockedFour(), endedAt: 5 };
    expect(projectorScreen(e, derive(e))).toBe('champion');
    expect(publicView(e, derive(e)).ended).toBe(true);
  });

  describe('while a tie that decides the champion is undecided', () => {
    /** Two categories of one team each on two tables, Grand Championship on: rounds 1–2 seeding, 3 brackets, 4 grand. */
    function grandTied() {
      let e = ok(handleSetup(blank(2), { type: 'importTeams', csv: csvFor({ A: 1, B: 1 }) }, ctx(admin)));
      e = ok(handleSetup(e, { type: 'suggestSetup' }, ctx(admin)));
      e = ok(handleSetup(e, { type: 'lockSetup' }, ctx(admin)));
      for (let i = 0; i < 3; i++) e = runRound(e, { 'A 1': 100_000, 'B 1': 110_000 });
      expect(derive(e).rounds.map((r) => r.spec.kind)).toEqual(['seeding', 'seeding', 'heats', 'grand']);
      // Both finalists share the official time to the hundredth.
      return runRound(e, { 'A 1': 90_001, 'B 1': 90_008 });
    }

    it('with a Grand Championship: the projector stays on brackets and the reveal is refused until the tie is decided', () => {
      let e = grandTied();
      expect(e.round).toMatchObject({ current: 4, phase: 'finished' });
      expect(derive(e).grandChampion).toBeNull();
      expect(projectorScreen(e, derive(e))).toBe('brackets');
      expect(publicView(e, derive(e))).toMatchObject({ projector: 'brackets', championShown: false, grandChampion: null });
      const refused = applyCommand(e, { type: 'showChampion', bagTotal: '' }, ctx(admin));
      expect(code(refused)).toBe('tie_undecided');
      if (!refused.ok) expect(refused.message).toBe('Decide the tie before showing the champion.');
      const [a, b] = [teamId(e, 'A 1'), teamId(e, 'B 1')];
      e = ok(applyCommand(e, { type: 'decideTie', raceId: 'r4:grand', order: [b, a] }, ctx(admin)));
      expect(projectorScreen(e, derive(e))).toBe('champion');
      e = ok(applyCommand(e, { type: 'showChampion', bagTotal: '' }, ctx(admin)));
      expect(publicView(e, derive(e))).toMatchObject({ projector: 'champion', championShown: true, grandChampion: b });
    });

    it('without a Grand Championship: a tie in a bracket\'s deciding race refuses the reveal until decided', () => {
      let e = lockedFour();
      for (let i = 0; i < 3; i++) e = runRound(e, times);
      // Winners race: T1 v T2 tied at the hundredth.
      e = runRound(e, { T1: 90_001, T2: 90_008, T3: 95_000, T4: 96_000 });
      expect(derive(e).standings.t).toEqual([null, null, null, null]);
      expect(projectorScreen(e, derive(e))).toBe('brackets');
      expect(code(applyCommand(e, { type: 'showChampion', bagTotal: '' }, ctx(admin)))).toBe('tie_undecided');
      e = ok(applyCommand(e, { type: 'decideTie', raceId: 'r4:t:0:winners', order: [teamId(e, 'T2'), teamId(e, 'T1')] }, ctx(admin)));
      e = ok(applyCommand(e, { type: 'showChampion', bagTotal: '' }, ctx(admin)));
      expect(publicView(e, derive(e)).standings.t![0]).toBe(teamId(e, 'T2'));
    });
  });
});
