import { describe, it, expect, beforeEach } from 'vitest';
import { handleLifecycle } from '../../../server/src/core/lifecycle';
import { admin, blank, csvFor, ctx, ok, referee } from '../../../server/test/core/helpers';
import { handleSetup } from '../../../server/src/core/setup';
import type { LiveEvent } from '../../../server/src/core/model';
import { render, screen, cleanup, within } from '@testing-library/preact';
import { ProjectorPage } from '../../src/pages/projector/ProjectorPage';
import { heatsOpen, lockedFour, previousEventDone, runRound, seedTimes, start, teamId, viewOf, openNext } from '../support/state';
import type { PublicView } from '../../src/lib/types';

const SITE = 'https://r2f.weiss-audio.com/';
/** Results by team name: times as raw ms, or a status. */
const withResults = (e: LiveEvent, times: Record<string, number>, statuses: Record<string, 'dnf' | 'dns'> = {}): LiveEvent => ({
  ...e,
  overrides: [
    ...e.overrides,
    ...Object.entries(times).map(([n, rawMs]) => ({ round: e.round.current, teamId: teamId(e, n), at: 1, set: { kind: 'time' as const, rawMs } })),
    ...Object.entries(statuses).map(([n, status]) => ({ round: e.round.current, teamId: teamId(e, n), at: 1, set: { kind: 'status' as const, status } })),
  ],
});
const show = (state: PublicView, serverNow = 0) =>
  render(<ProjectorPage state={state} serverNow={() => serverNow} siteUrl={SITE} />);

describe('projector', () => {
  beforeEach(() => cleanup());

  it('welcome shows the event and a QR code to the site', () => {
    show(viewOf(lockedFour()));
    expect(screen.getByRole('heading', { name: 'Test' })).toBeTruthy();
    expect(document.querySelector('[data-qr]')?.getAttribute('data-qr')).toBe(SITE);
  });

  it('tables lists the open round', () => {
    show(viewOf(heatsOpen()));
    expect(screen.getByRole('heading', { name: /Round 3/ })).toBeTruthy();
    expect(screen.getAllByText('T4').length).toBeGreaterThan(0);
  });

  it('tables shows a green Ready dot for ready tables and a red Not ready dot for the rest', () => {
    const e = ok(handleLifecycle(heatsOpen(), { type: 'overrideStation', station: 1, state: 'ready' }, ctx(admin)));
    show(viewOf(e));
    const row = (name: string) => screen.getByText(name).closest('.row') as HTMLElement;
    for (const name of ['T1', 'T4']) {
      expect(row(name).querySelector('[aria-label="Ready"]')).not.toBeNull();
      expect(row(name).querySelector('[aria-label="Not ready"]')).toBeNull();
    }
    for (const name of ['T2', 'T3']) {
      expect(row(name).querySelector('[aria-label="Ready"]')).toBeNull();
      expect(row(name).querySelector('[aria-label="Not ready"]')).not.toBeNull();
    }
    expect(screen.getAllByRole('img', { name: 'Ready' }).length).toBe(2);
    expect([...document.querySelectorAll('.proj-tables .row .t')].map((t) => t.textContent)).toEqual(['1', '2', '3', '4']);
    expect(screen.queryByRole('img', { name: 'Racing' })).toBeNull();
    expect(screen.queryByRole('img', { name: 'Finished' })).toBeNull();
  });

  it('sizes the team list for its rows per column: 8 teams, 4 rows', () => {
    let e = ok(handleSetup(blank(8), { type: 'importTeams', csv: csvFor({ T: 8 }).replace(/T (\d)/g, 'T$1') }, ctx(admin)));
    e = ok(handleSetup(e, { type: 'setGrandChampionship', enabled: false }, ctx(admin)));
    e = ok(handleSetup(e, { type: 'suggestSetup' }, ctx(admin)));
    e = openNext(ok(handleSetup(e, { type: 'lockSetup' }, ctx(admin))));
    show(viewOf(e));
    expect(document.querySelectorAll('.proj-tables .row').length).toBe(8);
    expect((document.querySelector('.proj-tables') as HTMLElement).style.getPropertyValue('--rows')).toBe('4');
    cleanup();
    show(viewOf(withResults(start(e, 1_000_000), { T2: 221_200 })), 1_000_000);
    expect(screen.getByLabelText('Teams').style.getPropertyValue('--rows')).toBe('4');
  });

  it('a single table ready turns only its own team green', () => {
    const e = ok(handleLifecycle(openNext(lockedFour()), { type: 'stationReady', table: 2 }, ctx(referee(1))));
    show(viewOf(e));
    const ready = screen.getAllByRole('img', { name: 'Ready' }).map((d) => d.closest('.row')!.querySelector('.t')!.textContent);
    expect(ready).toEqual(['2']);
    expect(screen.getAllByRole('img', { name: 'Not ready' }).length).toBe(3);
  });

  it('the running screen is the big clock alone until a team is in', () => {
    const e = start(openNext(lockedFour()), 1_000_000);
    show(viewOf(e), 1_000_000);
    expect(screen.getByTestId('master-clock')).toBeTruthy();
    expect(screen.queryByLabelText('Teams')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Preliminary times' })).toBeNull();
    expect(screen.queryByRole('img', { name: /Ready/ })).toBeNull();
  });

  it('once a team is in, lists every team: Finished with its time, the rest Racing with their race label', () => {
    const e = withResults(start(openNext(lockedFour()), 1_000_000), { T2: 221_200 }, { T3: 'dnf' });
    show(viewOf(e), 1_000_000);
    expect(screen.getByRole('heading', { name: 'Preliminary times' })).toBeTruthy();
    const list = screen.getByLabelText('Teams');
    expect(list.querySelectorAll('.row').length).toBe(4);
    // T2 (3:41.20, table 2), then T3 DNF (table 3), then T1 and T4 still racing by table.
    expect([...list.querySelectorAll('.row .tbl')].map((t) => t.textContent)).toEqual(['(T2)', '(T3)', '(T1)', '(T4)']);
    // The red number is the finishing position: only the team with a time has one.
    expect([...list.querySelectorAll('.row .t')].map((t) => t.textContent)).toEqual(['1', '', '', '']);
    const row = (name: string) => within(list).getByText(name).closest('.row') as HTMLElement;
    expect(within(row('T2')).getByRole('img', { name: 'Finished' })).toBeTruthy();
    expect(row('T2').textContent).toContain('3:41.20');
    expect(within(row('T3')).getByRole('img', { name: 'Finished' })).toBeTruthy();
    expect(row('T3').textContent).toContain('DNF');
    for (const name of ['T1', 'T4']) {
      expect(within(row(name)).getByRole('img', { name: 'Racing' })).toBeTruthy();
      expect(row(name).querySelector('.lbl')!.textContent).not.toBe('');
    }
    expect(screen.queryByRole('img', { name: 'Ready' })).toBeNull();
    expect(screen.queryByRole('img', { name: 'Not ready' })).toBeNull();
    expect(document.querySelector('.chip')).toBeNull();
  });

  it('orders the running list: times fastest first, then DNF, then still racing', () => {
    const e = withResults(start(openNext(lockedFour()), 1_000_000), { T1: 190_000, T2: 185_000 }, { T4: 'dnf' });
    show(viewOf(e), 1_000_000);
    const rows = [...screen.getByLabelText('Teams').querySelectorAll('.row')].map((r) => [r.querySelector('.name')!.textContent, r.querySelector('.lbl')!.textContent]);
    expect(rows.map(([n]) => n)).toEqual(['T2', 'T1', 'T4', 'T3']);
    expect(rows.slice(0, 3).map(([, t]) => t)).toEqual(['3:05.00', '3:10.00', 'DNF']);
    expect([...screen.getByLabelText('Teams').querySelectorAll('.row .t')].map((t) => t.textContent)).toEqual(['1', '2', '', '']);
  });

  it('orders equal times by table, DNF before DNS', () => {
    const e = withResults(start(openNext(lockedFour()), 1_000_000), { T3: 190_000, T2: 190_000 }, { T4: 'dns', T1: 'dnf' });
    show(viewOf(e), 1_000_000);
    const list = screen.getByLabelText('Teams');
    expect([...list.querySelectorAll('.row .tbl')].map((t) => t.textContent)).toEqual(['(T2)', '(T3)', '(T1)', '(T4)']);
    // Equal times share a position.
    expect([...list.querySelectorAll('.row .t')].map((t) => t.textContent)).toEqual(['1', '1', '', '']);
  });

  it('keeps the list when a result is undone, and a new round starts big again', () => {
    const running = start(openNext(lockedFour()), 1_000_000);
    const { rerender } = show(viewOf(withResults(running, { T2: 221_200 })), 1_000_000);
    expect(screen.getByLabelText('Teams')).toBeTruthy();
    rerender(<ProjectorPage state={viewOf(running)} serverNow={() => 1_000_000} siteUrl={SITE} />);
    expect(screen.getByLabelText('Teams')).toBeTruthy();
    expect(screen.getAllByRole('img', { name: 'Racing' }).length).toBe(4);
    const next = viewOf(running);
    rerender(<ProjectorPage state={{ ...next, round: { ...next.round, current: 2 } }} serverNow={() => 1_000_000} siteUrl={SITE} />);
    expect(screen.queryByLabelText('Teams')).toBeNull();
  });

  it('clock counts from the start on the server clock', () => {
    const e = start(openNext(lockedFour()), 1_000_000);
    show(viewOf(e), 1_000_000 + 61_500);
    expect(screen.getByTestId('master-clock').textContent).toBe('1:01');
  });

  it('seeding results after a seeding round', () => {
    show(viewOf(runRound(lockedFour(), seedTimes)));
    expect(screen.getByRole('heading', { name: 'Seeding results' })).toBeTruthy();
  });

  it('champion after the grand round', () => {
    show(viewOf(previousEventDone()));
    expect(screen.getByRole('heading', { name: 'Grand Champion' })).toBeTruthy();
    expect(screen.getByText('Riverbend Middle School')).toBeTruthy();
  });

  it('pinned screens: standings and brackets', () => {
    const done = viewOf(previousEventDone());
    show({ ...done, projector: 'standings' });
    expect(screen.getByRole('heading', { name: 'Final standings' })).toBeTruthy();
    cleanup();
    show({ ...done, projector: 'brackets' });
    expect(screen.getByRole('heading', { name: /Brackets/ })).toBeTruthy();
  });

  it('follows the server after a reconnect snapshot', () => {
    const done = viewOf(previousEventDone());
    const { rerender } = show({ ...done, projector: 'clock' });
    rerender(<ProjectorPage state={{ ...done, projector: 'brackets' }} serverNow={() => 0} siteUrl={SITE} />);
    expect(screen.getByRole('heading', { name: /Brackets/ })).toBeTruthy();
  });
});
