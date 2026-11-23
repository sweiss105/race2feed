import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/preact';
import { ParticipantPage } from '../../src/pages/participant/ParticipantPage';
import { ProjectorPage } from '../../src/pages/projector/ProjectorPage';
import { timeText } from '../../src/ui/Time';
import { MemoryStorage } from '../lib/fakes';
import { previousEventDone, viewOf } from '../support/state';
import type { PublicView } from '../../src/lib/types';

const base = { status: 'finished', officialMs: 226_200, penaltiesMs: 15_000 };

describe('penalty text', () => {
  it('names approved reasons', () => {
    expect(timeText({ ...base, penaltyNotes: ['Started early'], penaltyPending: false, dq: null })).toBe('3:46.20 (incl. +15s · Started early)');
  });
  it('flags penalties under review', () => {
    expect(timeText({ ...base, penaltiesMs: 5000, penaltyNotes: [], penaltyPending: true, dq: null })).toBe('3:46.20 (incl. +5s) · pending: under review');
  });
  it('shows a disqualification with its reason', () => {
    expect(timeText({ ...base, status: 'dnf', officialMs: null, penaltyNotes: [], penaltyPending: false, dq: 'Unsafe conduct' })).toBe('DQ · Unsafe conduct');
  });
  it('keeps the projector short', () => {
    expect(timeText({ ...base, penaltyNotes: ['Started early'], penaltyPending: false, dq: null }, { short: true })).toBe('3:46.20 (+15s)');
    expect(timeText({ ...base, status: 'dnf', officialMs: null, penaltyNotes: [], penaltyPending: false, dq: 'Unsafe conduct' }, { short: true })).toBe('DQ');
  });
});

describe('champion screen', () => {
  let storage: MemoryStorage;
  beforeEach(() => { cleanup(); storage = new MemoryStorage(); });

  const done = (): PublicView => ({ ...viewOf(previousEventDone()), championShown: true, bagTotal: '1,234' });
  const noGrand = (v: PublicView): PublicView => ({ ...v, rounds: v.rounds.filter((r) => r.kind !== 'grand'), grandChampion: null });

  it('is hidden until race control shows it', () => {
    render(<ParticipantPage state={{ ...done(), championShown: false }} storage={storage} />);
    expect(screen.queryByRole('region', { name: 'Champion' })).toBeNull();
  });

  it('shows the grand champion and the bag count on phones', () => {
    render(<ParticipantPage state={done()} storage={storage} />);
    const card = screen.getByRole('region', { name: 'Champion' });
    expect(within(card).getByText('Grand Champion')).toBeTruthy();
    expect(within(card).getByText('Riverbend Middle School')).toBeTruthy();
    expect(within(card).getByText(/1,234 bags/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Final standings' })).toBeTruthy();
    expect(screen.getByRole('searchbox')).toBeTruthy();
  });

  it('highlights the remembered team in the final standings', () => {
    const v = done();
    const mine = Object.values(v.standings)[0]![1]!;
    storage.setItem('r2f.team', mine);
    render(<ParticipantPage state={v} storage={storage} />);
    const standings = screen.getByRole('region', { name: 'Final standings' });
    expect(standings.querySelector('li.me')?.textContent).toContain(v.teams.find((t) => t.id === mine)!.name);
  });

  it('lists each category winner when there is no grand round', () => {
    const v = noGrand(done());
    render(<ParticipantPage state={v} storage={storage} />);
    const card = screen.getByRole('region', { name: 'Champion' });
    for (const c of v.categories) {
      const winner = v.teams.find((t) => t.id === v.standings[c.id]?.[0])!;
      expect(within(card).getByText(`${c.name} champion`)).toBeTruthy();
      expect(within(card).getByText(winner.name)).toBeTruthy();
    }
  });

  it('says the event is complete once it has ended', () => {
    render(<ParticipantPage state={{ ...done(), championShown: true, ended: true }} storage={storage} />);
    expect(screen.getByText('Event complete')).toBeTruthy();
  });

  it('projector shows category winners when there is no grand round', () => {
    const v = { ...noGrand(done()), projector: 'champion' as const };
    render(<ProjectorPage state={v} serverNow={() => 0} siteUrl="https://x/" />);
    expect(screen.getAllByRole('heading', { name: /champion$/ }).length).toBe(v.categories.length);
    expect(screen.getByText(/1,234 bags/)).toBeTruthy();
  });
});
