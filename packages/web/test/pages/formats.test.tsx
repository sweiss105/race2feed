import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/preact';
import { ParticipantPage } from '../../src/pages/participant/ParticipantPage';
import { ProjectorPage } from '../../src/pages/projector/ProjectorPage';
import { Race } from '../../src/pages/control/sections/Race';
import { RunnerProvider } from '../../src/pages/control/runner';
import { applyRoundUpdate } from '../../src/lib/publicState';
import { publicRoundUpdate } from '../../../server/src/core/views';
import { derive } from '../../../server/src/core/results';
import { handleLifecycle } from '../../../server/src/core/lifecycle';
import { admin, ctx, ok } from '../../../server/test/core/helpers';
import type { LiveEvent } from '../../../server/src/core/model';
import { MemoryStorage } from '../lib/fakes';
import { ctlViewOf, lockedFour, lockedWith, openNext, runRound, runRounds, start, teamId, viewOf } from '../support/state';
import type { PublicView } from '../../src/lib/types';

const sec = (...s: number[]) => Object.fromEntries(s.map((v, i) => [`T${i + 1}`, v * 1000]));
const projector = (state: PublicView) => render(<ProjectorPage state={state} serverNow={() => 0} siteUrl="https://x/" />);
const phone = (e: LiveEvent, team: string | null, state: PublicView = viewOf(e)) => {
  const storage = new MemoryStorage();
  if (team) storage.setItem('r2f.team', teamId(e, team));
  return render(<ParticipantPage state={state} storage={storage} />);
};
const rowOf = (name: string) => screen.getByText(name).closest('.row') as HTMLElement;
const cells = (row: HTMLElement) => [...row.children].map((c) => c.textContent);
const headings = () => cells(document.querySelector('.proj-columns .row.head') as HTMLElement);
const showChampion = (e: LiveEvent) => ok(handleLifecycle(e, { type: 'showChampion', bagTotal: '' }, ctx(admin)));

describe('projector seeding results in every format', () => {
  beforeEach(() => cleanup());

  it('standard: a column per run, then the total, in seed order', () => {
    projector(viewOf(runRounds(lockedFour(), [sec(130, 120, 110, 100), sec(100, 100, 100, 200.5)])));
    expect(headings()).toEqual(['', '', 'Run 1', 'Run 2', 'Total']);
    expect([...document.querySelectorAll('.proj-columns .row:not(.head)')].map((r) => cells(r as HTMLElement))).toEqual([
      ['1', 'T3', '1:50.00', '1:40.00', '3:30.00'],
      ['2', 'T2', '2:00.00', '1:40.00', '3:40.00'],
      ['3', 'T1', '2:10.00', '1:40.00', '3:50.00'],
      ['4', 'T4', '1:40.00', '3:20.50', '5:00.50'],
    ]);
  });

  it('after the first of two runs: the run still to come is a dash', () => {
    projector(viewOf(runRound(lockedFour(), sec(130, 120, 110, 100))));
    expect(cells(rowOf('T4'))).toEqual(['1', 'T4', '1:40.00', '—', '1:40.00']);
  });

  it('one run: just the time', () => {
    projector(viewOf(runRound(lockedWith({ seedingRuns: 1, brackets: 'finals' }), sec(100, 110, 120, 130))));
    expect(headings()).toEqual(['', '', 'Time']);
    expect(cells(rowOf('T2'))).toEqual(['2', 'T2', '1:50.00']);
    expect(screen.queryByText('Run 1')).toBeNull();
    expect(screen.queryByText('Total')).toBeNull();
  });

  it('best run: headed Best run, ranked on it', () => {
    projector(viewOf(runRounds(lockedWith({ seedingRuns: 2, seedingRank: 'best' }), [sec(100, 110, 120, 130), sec(200, 90, 120, 130)])));
    expect(headings()).toEqual(['', '', 'Run 1', 'Run 2', 'Best run']);
    expect(cells(rowOf('T2'))).toEqual(['1', 'T2', '1:50.00', '1:30.00', '1:30.00']);
    expect(cells(rowOf('T1'))).toEqual(['2', 'T1', '1:40.00', '3:20.00', '1:40.00']);
  });

  it('drop the slowest: headed Best two, the run left out struck through and labelled', () => {
    const e = runRounds(lockedWith({ seedingRuns: 3, seedingRank: 'dropSlowest', brackets: 'none' }), [sec(60, 60, 50, 70), sec(61, 62, 55, 71), sec(90, 61, 40, 72)]);
    projector(viewOf(e));
    expect(headings()).toEqual(['', '', 'Run 1', 'Run 2', 'Run 3', 'Best two']);
    const t1 = rowOf('T1');
    expect(cells(t1).slice(0, 2)).toEqual(['2', 'T1']);
    expect(cells(t1).at(-1)).toBe('2:01.00');
    const dropped = t1.querySelectorAll('s');
    expect(dropped.length).toBe(1);
    expect(dropped[0]!.textContent).toBe('1:30.00 not counted');
    expect(within(dropped[0] as HTMLElement).getByText('not counted').className).toBe('visually-hidden');
    expect(rowOf('T3').querySelector('s')!.textContent).toContain('0:55.00');
    expect(document.querySelectorAll('.proj-columns s').length).toBe(4);
  });

  it('a live round update moves the score and the order without a snapshot', () => {
    let e = start(openNext(runRound(lockedWith({ seedingRuns: 2, seedingRank: 'best', brackets: 'none' }), sec(100, 110, 120, 130))));
    const snapshot = { ...viewOf(e), projector: 'seeding-results' as const };
    const { rerender } = projector(snapshot);
    expect(cells(rowOf('T4'))).toEqual(['4', 'T4', '2:10.00', '—', '2:10.00']);
    e = { ...e, overrides: [...e.overrides, { round: 2, teamId: teamId(e, 'T4'), at: 5, set: { kind: 'time', rawMs: 80_000 } }] };
    const live = { ...applyRoundUpdate(snapshot, publicRoundUpdate(e, derive(e))), projector: 'seeding-results' as const };
    rerender(<ProjectorPage state={live} serverNow={() => 0} siteUrl="https://x/" />);
    expect(cells(rowOf('T4'))).toEqual(['1', 'T4', '2:10.00', '1:20.00', '1:20.00']);
  });
});

describe('projector brackets and standings in every format', () => {
  beforeEach(() => cleanup());

  it('finals only: each bracket is one race, the Final, in finishing order', () => {
    const e = runRounds(lockedWith({ seedingRuns: 1, brackets: 'finals' }), [sec(100, 110, 120, 130), sec(140, 110, 120, 130)]);
    const v = viewOf(e);
    expect(v.projector).toBe('brackets');
    projector(v);
    expect(screen.getByText('Round 2 · Final')).toBeTruthy();
    expect(screen.queryByText(/Placement/)).toBeNull();
    expect(screen.queryByText('Final places')).toBeNull();
    expect([...document.querySelectorAll('.race-row')].map((r) => r.textContent)).toEqual(['4T12:20.00', '1T21:50.00', '2T32:00.00', '3T42:10.00']);
  });

  it('seeding only, in progress: a pinned brackets screen is the standings, which say seeding decides them', () => {
    const e = runRound(lockedWith({ seedingRuns: 2, brackets: 'none' }), sec(100, 110, 120, 130));
    projector({ ...viewOf(e), projector: 'brackets' });
    expect(screen.getByRole('heading', { name: 'Standings' })).toBeTruthy();
    expect(screen.getByText('Standings are decided by seeding')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /Brackets/ })).toBeNull();
    cleanup();
    projector({ ...viewOf(e), projector: 'standings' });
    expect(screen.getByText('Standings are decided by seeding')).toBeTruthy();
  });

  it('seeding only, complete: brackets and standings both show the final standings in seed order', () => {
    const e = runRounds(lockedWith({ seedingRuns: 2, brackets: 'none' }), [sec(100, 110, 120, 130), sec(140, 100, 120, 130)]);
    for (const pinned of ['brackets', 'standings'] as const) {
      cleanup();
      projector({ ...viewOf(e), projector: pinned });
      expect(screen.getByRole('heading', { name: 'Final standings' })).toBeTruthy();
      expect(screen.queryByText('Standings are decided by seeding')).toBeNull();
      expect([...document.querySelectorAll('.proj-columns .row')].map((r) => cells(r as HTMLElement).slice(0, 2))).toEqual([['1', 'T2'], ['2', 'T1'], ['3', 'T3'], ['4', 'T4']]);
    }
  });

  it('standard standings say nothing about seeding', () => {
    projector({ ...viewOf(runRound(lockedFour(), sec(100, 110, 120, 130))), projector: 'standings' });
    expect(screen.getByRole('heading', { name: 'Final standings' })).toBeTruthy();
    expect(screen.queryByText('Standings are decided by seeding')).toBeNull();
  });

  it('champion screen for a seeding-only event with one category: its top seed', () => {
    const e = showChampion(runRounds(lockedWith({ seedingRuns: 2, brackets: 'none' }), [sec(100, 110, 120, 130), sec(140, 100, 120, 130)]));
    const v = viewOf(e);
    expect(v.projector).toBe('champion');
    projector(v);
    expect(screen.getByRole('heading', { name: 'T champion' })).toBeTruthy();
    expect(screen.getByText('T2')).toBeTruthy();
    expect(screen.queryByText('To be decided')).toBeNull();
  });

  it('champion screen after a finals-only event', () => {
    const e = showChampion(runRounds(lockedWith({ seedingRuns: 1, brackets: 'finals' }), [sec(100, 110, 120, 130), sec(140, 110, 120, 130)]));
    projector(viewOf(e));
    expect(screen.getByRole('heading', { name: 'T champion' })).toBeTruthy();
    expect(screen.getByText('T2')).toBeTruthy();
  });

  it('grand champion of a seeding-only event is named as a top seed', () => {
    let e = lockedWith({ seedingRuns: 1, brackets: 'none' }, { counts: { A: 2, B: 2 }, grand: true });
    e = runRounds(e, [{ 'A 1': 100_000, 'A 2': 90_000, 'B 1': 80_000, 'B 2': 85_000 }, { 'A 2': 100_000, 'B 1': 95_000 }]);
    projector(viewOf(e));
    expect(screen.getByRole('heading', { name: 'Grand Champion' })).toBeTruthy();
    expect(screen.getByText('B 1')).toBeTruthy();
    expect(screen.getByText('B top seed')).toBeTruthy();
    expect(screen.queryByText(/Bracket winner/)).toBeNull();
  });
});

describe('phone in every format', () => {
  beforeEach(() => cleanup());
  const seeding = () => screen.getByRole('list', { name: 'Seeding' });
  const lines = () => [...seeding().querySelectorAll('li')].map((li) => [...li.children].map((c) => c.textContent));

  it('standard: rank, each run and the total', () => {
    const e = openNext(runRounds(lockedFour(), [sec(130, 120, 110, 100), sec(100, 100, 100, 200.5)]));
    phone(e, 'T4');
    expect(lines()).toEqual([['Rank in category', '4'], ['Run 1', '1:40.00'], ['Run 2', '3:20.50'], ['Total', '5:00.50']]);
  });

  it('one run: rank and the time', () => {
    const e = runRound(lockedWith({ seedingRuns: 1, brackets: 'finals' }), sec(100, 110, 120, 130));
    phone(e, 'T2');
    expect(lines()).toEqual([['Rank in category', '2'], ['Time', '1:50.00']]);
  });

  it('best run', () => {
    const e = runRounds(lockedWith({ seedingRuns: 2, seedingRank: 'best' }), [sec(100, 110, 120, 130), sec(200, 90, 120, 130)]);
    phone(e, 'T1');
    expect(lines()).toEqual([['Rank in category', '2'], ['Run 1', '1:40.00'], ['Run 2', '3:20.00'], ['Best run', '1:40.00']]);
  });

  it('drop the slowest: best two, with the run left out struck through and labelled', () => {
    const e = runRounds(lockedWith({ seedingRuns: 3, seedingRank: 'dropSlowest', brackets: 'none' }), [sec(60, 60, 50, 70), sec(61, 62, 55, 71), sec(90, 61, 40, 72)]);
    phone(e, 'T1');
    expect(lines()).toEqual([['Rank in category', '2'], ['Run 1', '1:00.00'], ['Run 2', '1:01.00'], ['Run 3', '1:30.00 not counted'], ['Best two', '2:01.00']]);
    expect(seeding().querySelectorAll('s').length).toBe(1);
  });

  it('before any run: dashes', () => {
    phone(lockedFour(), 'T1');
    expect(lines()).toEqual([['Rank in category', '—'], ['Run 1', '—'], ['Run 2', '—'], ['Total', '—']]);
  });

  it('a live round update changes the score without a snapshot', () => {
    let e = start(openNext(runRound(lockedWith({ seedingRuns: 2, seedingRank: 'best', brackets: 'none' }), sec(100, 110, 120, 130))));
    const snapshot = viewOf(e);
    e = { ...e, overrides: [...e.overrides, { round: 2, teamId: teamId(e, 'T4'), at: 5, set: { kind: 'time', rawMs: 80_000 } }] };
    phone(e, 'T4', applyRoundUpdate(snapshot, publicRoundUpdate(e, derive(e))));
    expect(lines().slice(1)).toEqual([['Run 1', '2:10.00'], ['Run 2', '1:20.00'], ['Best run', '1:20.00']]);
  });

  it('finals only: the Brackets tab shows each bracket as one race, the Final', () => {
    const e = runRounds(lockedWith({ seedingRuns: 1, brackets: 'finals' }), [sec(100, 110, 120, 130), sec(140, 110, 120, 130)]);
    phone(e, 'T2');
    fireEvent.click(screen.getByRole('tab', { name: 'Brackets' }));
    expect(screen.getByText('Round 2 · Final')).toBeTruthy();
    expect(screen.queryByText(/Placement/)).toBeNull();
    expect(screen.queryByText('Final places')).toBeNull();
    expect(document.querySelector('.race-row.me')!.textContent).toContain('T2');
    fireEvent.click(screen.getByRole('tab', { name: 'Diagram' }));
    expect(document.querySelectorAll('.bracket-diagram .col').length).toBe(1);
  });

  it('seeding only: a Standings tab in place of Brackets, which says seeding decides them while it is in progress', () => {
    const e = runRound(lockedWith({ seedingRuns: 2, brackets: 'none' }), sec(100, 110, 120, 130));
    phone(e, 'T2');
    expect(screen.queryByRole('tab', { name: 'Brackets' })).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Standings' }));
    expect(screen.getByText('Standings are decided by seeding')).toBeTruthy();
    expect(screen.queryByText(/Brackets appear/)).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Final standings' })).toBeNull();
  });

  it('seeding only: the Standings tab lists the final standings once seeding is complete', () => {
    const e = runRounds(lockedWith({ seedingRuns: 2, brackets: 'none' }), [sec(100, 110, 120, 130), sec(140, 100, 120, 130)]);
    phone(e, 'T1');
    fireEvent.click(screen.getByRole('tab', { name: 'Standings' }));
    expect(screen.queryByText('Standings are decided by seeding')).toBeNull();
    const list = screen.getByRole('region', { name: 'Final standings' });
    expect([...list.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['1T2', '2T1', '3T3', '4T4']);
    expect(list.querySelector('li.me')!.textContent).toBe('2T1');
  });

  it('seeding only: the search line does not promise brackets', () => {
    phone(lockedWith({ brackets: 'none' }), null);
    expect(screen.queryByText(/brackets/i)).toBeNull();
    cleanup();
    phone(lockedFour(), null);
    expect(screen.getByText('See your table, your times and where you are in the brackets.')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Brackets' })).toBeTruthy();
  });

  it('champion card and final standings for a seeding-only event with one category', () => {
    const e = showChampion(runRounds(lockedWith({ seedingRuns: 2, brackets: 'none' }), [sec(100, 110, 120, 130), sec(140, 100, 120, 130)]));
    phone(e, 'T3');
    const card = screen.getByRole('region', { name: 'Champion' });
    expect(within(card).getByText('T champion')).toBeTruthy();
    expect(within(card).getByText('T2')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Final standings' }).querySelector('li.me')!.textContent).toBe('3T3');
  });
});

describe('console projector menu', () => {
  beforeEach(() => cleanup());
  const options = (e: LiveEvent) => {
    render(<RunnerProvider send={async () => ({ ok: true })}><Race view={ctlViewOf(e)} serverNow={() => 0} /></RunnerProvider>);
    return [...(screen.getByLabelText('Projector screen') as HTMLSelectElement).options].map((o) => o.value);
  };
  it('offers no brackets screen in seeding only', () => {
    expect(options(lockedWith({ brackets: 'none' }))).toEqual(['', 'welcome', 'tables', 'clock', 'seeding-results', 'standings', 'champion']);
    cleanup();
    expect(options(lockedFour())).toContain('brackets');
  });
});
