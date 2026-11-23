import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/preact';
import { Login } from '../../src/pages/control/Login';
import { ConsolePage } from '../../src/pages/control/ConsolePage';
import { ctlViewOf, heatsOpen, lockedFour, openNext, start, teamId } from '../support/state';
import type { Ack } from '../../src/lib/types';

const me = (role: 'admin' | 'control') => ({ role, label: role });

describe('console sign-in', () => {
  beforeEach(() => cleanup());

  it('signs in with the chosen role', async () => {
    const login = vi.fn(async () => ({ ok: true as const }));
    const onSignedIn = vi.fn();
    render(<Login login={login} onSignedIn={onSignedIn} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Race control' }));
    fireEvent.input(screen.getByLabelText('Password'), { target: { value: 'pw-123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(login).toHaveBeenCalledWith('control', 'pw-123456'));
    expect(onSignedIn).toHaveBeenCalled();
  });

  it('says so when the password is wrong', async () => {
    render(<Login login={async () => ({ ok: false as const, status: 401 })} onSignedIn={vi.fn()} />);
    fireEvent.input(screen.getByLabelText('Password'), { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Wrong password')).toBeTruthy();
  });
});

describe('console sections by role', () => {
  beforeEach(() => cleanup());
  it('race control does not see Setup or Settings', () => {
    render(<ConsolePage me={me('control')} view={ctlViewOf(lockedFour())} send={async () => ({ ok: true })} serverNow={() => 0} status="open" />);
    expect(screen.queryByRole('link', { name: 'Setup' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Settings' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Race' })).toBeTruthy();
  });
  it('admin sees every section', () => {
    render(<ConsolePage me={me('admin')} view={ctlViewOf(lockedFour())} send={async () => ({ ok: true })} serverNow={() => 0} status="open" />);
    for (const s of ['Race', 'Teams', 'Setup', 'Devices', 'Settings', 'Events', 'Log']) expect(screen.getByRole('link', { name: s })).toBeTruthy();
  });
});

describe('race section', () => {
  beforeEach(() => cleanup());

  it('sends one START however many times it is clicked', async () => {
    let resolve!: (a: Ack) => void;
    const send = vi.fn(() => new Promise<Ack>((r) => { resolve = r; }));
    const e = openNext(lockedFour());
    const ready = { ...e, stations: { 1: { ready: true, excluded: false }, 2: { ready: true, excluded: false } } };
    render(<ConsolePage me={me('control')} view={ctlViewOf(ready)} send={send} serverNow={() => 0} status="open" />);
    const startBtn = screen.getByRole('button', { name: 'Start' });
    fireEvent.click(startBtn);
    fireEvent.click(startBtn);
    fireEvent.click(startBtn);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ type: 'startRace' });
    resolve({ ok: true });
  });

  it('asks before a correction that changes later rounds, then confirms', async () => {
    const sent: any[] = [];
    const send = vi.fn(async (cmd: any) => {
      sent.push(cmd);
      return cmd.confirmUnlock ? { ok: true } : { ok: false, code: 'unlock_required', message: 'confirm', detail: { laterRounds: [2, 3], changedRounds: [3] } };
    });
    const e = heatsOpen();
    render(<ConsolePage me={me('control')} view={ctlViewOf(e)} send={send} serverNow={() => 0} status="open" />);
    fireEvent.change(screen.getByLabelText('Round'), { target: { value: '1' } });
    const row = await screen.findByTestId(`team-${teamId(e, 'T1')}`);
    fireEvent.click(row.querySelector('button[data-action="dnf"]')!);
    expect(await screen.findByText(/changes who races in Round 3/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Change anyway' }));
    await waitFor(() => expect(sent.at(-1)).toMatchObject({ type: 'setResult', round: 1, confirmUnlock: true, set: { kind: 'status', status: 'dnf' } }));
  });

  it('marks an outstanding team DNF', async () => {
    const send = vi.fn(async () => ({ ok: true }));
    const e = start(openNext(lockedFour()));
    render(<ConsolePage me={me('control')} view={ctlViewOf(e)} send={send} serverNow={() => 0} status="open" />);
    const outstanding = screen.getByRole('region', { name: 'Outstanding' });
    fireEvent.click(outstanding.querySelector(`[data-team="${teamId(e, 'T3')}"] button[data-action="dnf"]`)!);
    await waitFor(() => expect(send).toHaveBeenCalledWith({ type: 'setResult', round: 1, teamId: teamId(e, 'T3'), set: { kind: 'status', status: 'dnf' } }));
  });
});
