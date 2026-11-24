import { describe, it, expect } from 'vitest';
import { applyCommand } from '../../src/core/apply';
import { derive } from '../../src/core/results';
import { projectorScreen, publicView } from '../../src/core/views';
import { needsSnapshot } from '../../src/core/broadcast';
import { admin, ctx, lockedFour, ok, runRound } from './helpers';

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
});
