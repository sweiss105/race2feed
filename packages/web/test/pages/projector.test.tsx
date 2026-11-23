import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/preact';
import { ProjectorPage } from '../../src/pages/projector/ProjectorPage';
import { heatsOpen, lockedFour, previousEventDone, runRound, seedTimes, start, viewOf, openNext } from '../support/state';
import type { PublicView } from '../../src/lib/types';

const SITE = 'https://r2f.weiss-audio.com/';
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
