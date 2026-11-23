import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/preact';
import { ParticipantPage } from '../../src/pages/participant/ParticipantPage';
import { MemoryStorage } from '../lib/fakes';
import { heatsOpen, teamId, viewOf } from '../support/state';

describe('participant page', () => {
  let storage: MemoryStorage;
  beforeEach(() => { cleanup(); storage = new MemoryStorage(); });

  it('remembers the team picked from search', () => {
    const e = heatsOpen();
    render(<ParticipantPage state={viewOf(e)} storage={storage} />);
    fireEvent.input(screen.getByRole('searchbox'), { target: { value: 'T1' } });
    fireEvent.click(screen.getByRole('button', { name: /T1/ }));
    expect(storage.getItem('r2f.team')).toBe(teamId(e, 'T1'));
    expect(screen.getByText('Your next race')).toBeTruthy();
    expect(screen.getByTestId('next-table').textContent).toBe('1');
  });

  it('shows a renamed team under its new name', () => {
    const e = heatsOpen();
    storage.setItem('r2f.team', teamId(e, 'T1'));
    const renamed = viewOf({ ...e, setup: { ...e.setup, teams: e.setup.teams.map((t) => (t.name === 'T1' ? { ...t, name: 'Team One' } : t)) } });
    render(<ParticipantPage state={renamed} storage={storage} />);
    expect(screen.getAllByText('Team One').length).toBeGreaterThan(0);
  });

  it('forgets a team that no longer exists', () => {
    const e = heatsOpen();
    storage.setItem('r2f.team', 'gone');
    render(<ParticipantPage state={viewOf(e)} storage={storage} />);
    expect(storage.getItem('r2f.team')).toBeNull();
    expect(screen.getByRole('searchbox')).toBeTruthy();
  });

  it('marks times that include penalties', () => {
    let e = heatsOpen();
    const t1 = teamId(e, 'T1');
    e = { ...e, taps: [{ id: 'p', kind: 'penalty', round: 1, teamId: t1, amountMs: 5000, source: 'control', createdAt: 1, removedAt: null }] };
    storage.setItem('r2f.team', t1);
    render(<ParticipantPage state={viewOf(e)} storage={storage} />);
    expect(screen.getByText(/1:45\.00 \(incl\. \+5s\)/)).toBeTruthy();
  });

  it('shows pending: under review beside a time with a pending referee penalty', () => {
    let e = heatsOpen();
    const t1 = teamId(e, 'T1');
    e = { ...e, taps: [{ id: 'p', kind: 'penalty', round: 1, teamId: t1, amountMs: 0, source: 'referee', createdAt: 1, removedAt: null, review: { status: 'pending' } }] };
    storage.setItem('r2f.team', t1);
    render(<ParticipantPage state={viewOf(e)} storage={storage} />);
    expect(screen.getByText(/1:40\.00 · pending: under review/)).toBeTruthy();
  });

  it('"Not you?" clears the team', () => {
    const e = heatsOpen();
    storage.setItem('r2f.team', teamId(e, 'T1'));
    render(<ParticipantPage state={viewOf(e)} storage={storage} />);
    fireEvent.click(screen.getByRole('button', { name: 'Not you?' }));
    expect(storage.getItem('r2f.team')).toBeNull();
  });
});
