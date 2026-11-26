import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, within, act } from '@testing-library/preact';
import { Brackets } from '../../src/pages/participant/Brackets';
import { ProjectorPage } from '../../src/pages/projector/ProjectorPage';
import { ConsolePage } from '../../src/pages/control/ConsolePage';
import { RunnerProvider } from '../../src/pages/control/runner';
import { Setup } from '../../src/pages/control/sections/Setup';
import { MemoryStorage } from '../lib/fakes';
import { ctlViewOf, heatsOpen, knockoutSeeded, lockedFour, lockedWith, openNext, runRound, secs, teamId, viewOf } from '../support/state';
import type { LiveEvent } from '../../../server/src/core/model';

const match = (name: string, root: HTMLElement = document.body) => within(root).getByRole('group', { name });
const rows = (el: HTMLElement) => [...el.querySelectorAll('.ko-row')].map((r) => r.textContent);
const stageTitles = () => [...document.querySelectorAll('.ko-tree h5.stage-title')].map((h) => h.textContent);

describe('knockout bracket tree on the phone', () => {
  beforeEach(() => cleanup());
  const phone = (e: LiveEvent, team: string | null = null) =>
    render(<Brackets state={viewOf(e)} teamId={team ? teamId(e, team) : null} storage={new MemoryStorage()} />);

  it('says brackets come later until the first knockout round opens', () => {
    phone(knockoutSeeded(5));
    expect(screen.getByText('Brackets appear once seeding is done and the first bracket round opens.')).toBeTruthy();
  });

  it('shows a column per stage, byes, placeholders and the third-place race', () => {
    phone(openNext(knockoutSeeded(5)));
    expect(stageTitles()).toEqual(['Quarter-final', 'Semi-finals', 'Final']);
    expect(rows(match('Quarter-final'))).toEqual(['4T4—', '5T5—']);
    // T1 has a bye: its name on one row, "Bye" on the other, and it is already in the semi-final.
    const byes = [...document.querySelectorAll('.ko-match.bye')].map((m) => rows(m as HTMLElement));
    expect(byes).toEqual([['1T1', 'Bye'], ['2T2', 'Bye'], ['3T3', 'Bye']]);
    expect(rows(match('Semi-final 1'))).toEqual(['1T1', 'Winner of Quarter-final']);
    expect(rows(match('Final'))).toEqual(['Winner of Semi-final 1', 'Winner of Semi-final 2']);
    expect(rows(match('Third place'))).toEqual(['Loser of Semi-final 1', 'Loser of Semi-final 2']);
    expect(screen.getByText('Third place')).toBeTruthy();
    // No Cards / Diagram choice: a knockout bracket is always the tree.
    expect(screen.queryByRole('tab')).toBeNull();
  });

  it('shows times once raced and marks the winner', () => {
    phone(runRound(knockoutSeeded(4), { T1: 90_000, T4: 80_000, T2: 81_000, T3: 95_000 }));
    const semi = match('Semi-final 1');
    expect(rows(semi)).toEqual(['1T11:30.00', '4T41:20.00']);
    expect([...semi.querySelectorAll('.ko-row')].map((r) => r.classList.contains('win'))).toEqual([false, true]);
  });

  it('highlights the remembered team in every match it is in, and marks its current match to scroll to', () => {
    let e = runRound(knockoutSeeded(4), secs(4));
    e = openNext(e);
    phone(e, 'T3');
    const mine = [...document.querySelectorAll('[aria-current="true"]')];
    expect(mine.map((el) => el.textContent)).toEqual(['3T31:42.00', '3T3—']);
    const current = document.querySelectorAll('[data-mine="true"]');
    expect(current).toHaveLength(1);
    expect(current[0]!.getAttribute('aria-label')).toBe('Third place');
  });

  it('a bracket of one team shows the team and that it has no race', () => {
    const e = openNext(runRound(lockedWith({ seedingRuns: 1, brackets: 'knockout' }, { counts: { A: 1, B: 2 } }), { 'A 1': 100_000, 'B 1': 101_000, 'B 2': 102_000 }));
    phone(e);
    expect(screen.getByText('No race: the only team in this bracket')).toBeTruthy();
    expect(rows(match('Final'))).toEqual(['1B 1—', '2B 2—']);
  });

  it('another format keeps its cards and diagram', () => {
    phone(heatsOpen());
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Cards', 'Diagram']);
    expect(document.querySelector('.ko-tree')).toBeNull();
  });
});

describe('knockout bracket tree on the projector', () => {
  beforeEach(() => cleanup());
  const show = (e: LiveEvent) => render(<ProjectorPage state={viewOf(e)} serverNow={() => 0} siteUrl="https://example.org/" />);

  it('shows the tree after a knockout round, one bracket a page, sized by its first stage', () => {
    const e = runRound(knockoutSeeded(8), secs(8));
    expect(viewOf(e).projector).toBe('brackets');
    show(e);
    expect(screen.getByRole('heading', { name: 'T Gold' })).toBeTruthy();
    expect(stageTitles()).toEqual(['Quarter-finals', 'Semi-finals', 'Final']);
    expect(rows(match('Quarter-final 1'))).toEqual(['1T11:40.00', '8T81:47.00']);
    const tree = document.querySelector('.ko-tree') as HTMLElement;
    expect([tree.style.getPropertyValue('--ko-first'), tree.style.getPropertyValue('--ko-cols')]).toEqual(['4', '3']);
    expect(document.querySelector('.proj-fit .ko-tree')).toBeTruthy();
  });

  it('pages through the brackets', () => {
    vi.useFakeTimers();
    try {
      const times = Object.fromEntries(['A 1', 'A 2', 'B 1', 'B 2'].map((n, i) => [n, 100_000 + i * 1000]));
      const e = openNext(runRound(lockedWith({ seedingRuns: 1, brackets: 'knockout' }, { counts: { A: 2, B: 2 } }), times));
      render(<ProjectorPage state={{ ...viewOf(e), projector: 'brackets' }} serverNow={() => 0} siteUrl="https://example.org/" />);
      const title = () => screen.getByRole('heading', { level: 2 }).textContent;
      expect(title()).toBe('A Gold');
      expect(screen.getByText('Brackets · 1 of 2')).toBeTruthy();
      act(() => { vi.advanceTimersByTime(12_000); });
      expect(title()).toBe('B Gold');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('knockout on the console', () => {
  beforeEach(() => cleanup());
  const consoleOf = (e: LiveEvent) =>
    render(<ConsolePage me={{ role: 'admin', label: 'race control' }} view={ctlViewOf(e)} send={async () => ({ ok: true })} serverNow={() => 0} status="open" />);

  it('Race Control shows the bracket tree, with the next round filled in, and Results lists the knockout races', () => {
    consoleOf(runRound(knockoutSeeded(8), secs(8)));
    const panel = screen.getByRole('region', { name: 'Brackets' });
    expect(rows(match('Semi-final 1', panel))).toEqual(['1T1—', '4T4—']);
    const results = screen.getByRole('region', { name: 'Results' });
    expect(within(results).getAllByText('T Gold · Quarter-final 1')).toHaveLength(2);
  });

  it('has no Brackets panel in another format', () => {
    consoleOf(heatsOpen());
    expect(screen.queryByRole('region', { name: 'Brackets' })).toBeNull();
  });

  it('Setup says which bracket sizes the format takes', () => {
    const setup = (e: LiveEvent) => render(<RunnerProvider send={async () => ({ ok: true })}><Setup view={ctlViewOf(e)} /></RunnerProvider>);
    setup(lockedWith({ brackets: 'knockout' }));
    expect(screen.getByText('A knockout bracket has 2 to 4 teams (as many as there are tables).')).toBeTruthy();
    expect((screen.getByLabelText('T tier 1 size') as HTMLInputElement).max).toBe('4');
    cleanup();
    setup(lockedFour());
    expect(screen.getByText('A bracket has 4 to 7 teams.')).toBeTruthy();
    expect((screen.getByLabelText('T tier 1 size') as HTMLInputElement).max).toBe('7');
  });
});
