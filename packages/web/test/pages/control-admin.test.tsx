import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/preact';
import { RunnerProvider } from '../../src/pages/control/runner';
import { Teams } from '../../src/pages/control/sections/Teams';
import { Setup } from '../../src/pages/control/sections/Setup';
import { Devices } from '../../src/pages/control/sections/Devices';
import { Settings } from '../../src/pages/control/sections/Settings';
import { ctlViewOf, lockedFour } from '../support/state';
import { blank } from '../../../server/test/core/helpers';
import type { Ack } from '../../src/lib/types';

function withRunner(ui: preact.ComponentChildren, send: (cmd: any) => Promise<Ack>) {
  return render(<RunnerProvider send={send}>{ui}</RunnerProvider>);
}

describe('admin sections', () => {
  beforeEach(() => cleanup());
  afterEach(() => vi.unstubAllGlobals());

  it('imports pasted CSV and lists line errors', async () => {
    const send = vi.fn(async (cmd: any) => (cmd.type === 'importTeams'
      ? { ok: false, code: 'csv_invalid', message: 'The CSV has problems.', detail: ['line 3: team and category are both required'] }
      : { ok: true }));
    withRunner(<Teams view={ctlViewOf(blank(4))} role="admin" />, send);
    fireEvent.input(screen.getByLabelText('Paste CSV'), { target: { value: 'team,category\nA,X\n,Y' } });
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(send).toHaveBeenCalledWith({ type: 'importTeams', csv: 'team,category\nA,X\n,Y' }));
    expect(await screen.findByText('line 3: team and category are both required')).toBeTruthy();
  });

  it('race control can only rename teams', () => {
    withRunner(<Teams view={ctlViewOf(lockedFour())} role="control" />, async () => ({ ok: true }));
    expect(screen.queryByLabelText('Paste CSV')).toBeNull();
    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull();
    expect(screen.getAllByRole('button', { name: /Rename/ }).length).toBe(4);
  });

  it('shows every problem when locking fails', async () => {
    const send = vi.fn(async (cmd: any) => (cmd.type === 'lockSetup'
      ? { ok: false, code: 'setup_invalid', message: 'Setup has problems.', detail: ['T1 is not in a seeding group', 'X: size must be 4–7'] }
      : { ok: true }));
    const e = lockedFour();
    withRunner(<Setup view={ctlViewOf({ ...e, setupLocked: false })} />, send);
    fireEvent.click(screen.getByRole('button', { name: 'Lock setup' }));
    expect(await screen.findByText('T1 is not in a seeding group')).toBeTruthy();
    expect(screen.getByText('X: size must be 4–7')).toBeTruthy();
  });

  it('shows a pairing QR code for a station', async () => {
    const send = vi.fn(async () => ({ ok: true, reply: { code: 'ABC234', expiresAt: Date.now() + 600_000 } }));
    withRunner(<Devices view={ctlViewOf(lockedFour())} />, send);
    fireEvent.click(screen.getAllByRole('button', { name: /Pair tablet/ })[0]!);
    await waitFor(() => expect(send).toHaveBeenCalledWith({ type: 'createPairingCode', station: 1 }));
    const qr = await waitFor(() => document.querySelector('[data-qr]')!);
    expect(qr.getAttribute('data-qr')).toMatch(/\/ref\?code=ABC234$/);
    expect(screen.getByText('ABC234')).toBeTruthy();
  });

  it('lists a paired referee by name and station', () => {
    const view = ctlViewOf(lockedFour());
    view.devices = [{ id: 'd1', station: 1, label: 'Dana', created_at: 1, revoked_at: null, last_seen: null }] as typeof view.devices;
    withRunner(<Devices view={view} />, vi.fn(async () => ({ ok: true })));
    expect(screen.getByText('Dana — Tables 1 & 2')).toBeTruthy();
  });

  it('shows a new Companion key once', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200 })));
    const send = vi.fn(async (cmd: any) => (cmd.type === 'createApiKey' ? { ok: true, reply: { id: 'k1', key: 'secret-key-value' } } : { ok: true }));
    withRunner(<Settings view={ctlViewOf(lockedFour())} />, send);
    fireEvent.input(screen.getByLabelText('Key name'), { target: { value: 'Stream Deck' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create key' }));
    expect(await screen.findByText('secret-key-value')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByText('secret-key-value')).toBeNull();
  });

  it('has no penalty-seconds setting any more', () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200 })));
    withRunner(<Settings view={ctlViewOf(lockedFour())} />, vi.fn(async () => ({ ok: true })));
    expect(screen.queryByLabelText('Penalty (seconds)')).toBeNull();
  });

  it('saves the auto-finish delay in seconds, 30 by default', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200 })));
    const send = vi.fn(async () => ({ ok: true }));
    withRunner(<Settings view={ctlViewOf(lockedFour())} />, send);
    const field = screen.getByLabelText('Auto-finish delay (seconds)') as HTMLInputElement;
    expect(field.value).toBe('30');
    fireEvent.input(field, { target: { value: '45' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save auto-finish delay' }));
    await waitFor(() => expect(send).toHaveBeenCalledWith({ type: 'setSettings', autoFinishMs: 45_000 }));
  });

  it("has the Time penalties switch in the event's settings, flipping at once while the server confirms", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200 })));
    let resolve!: (a: Ack) => void;
    const send = vi.fn(() => new Promise<Ack>((r) => { resolve = r; }));
    withRunner(<Settings view={ctlViewOf(lockedFour())} />, send);
    const sw = screen.getByRole('switch', { name: 'Time penalties' }) as HTMLInputElement;
    expect(sw.checked).toBe(false);
    fireEvent.click(sw);
    expect(sw.checked).toBe(true);
    expect(send).toHaveBeenCalledWith({ type: 'setPenaltiesEnabled', enabled: true });
    resolve({ ok: true });
  });

  it('chooses how many tables each referee covers until setup is locked', async () => {
    const send = vi.fn(async () => ({ ok: true }));
    withRunner(<Setup view={ctlViewOf(blank(4))} />, send);
    const group = screen.getByRole('radiogroup', { name: 'Tables per referee' });
    expect(screen.getByRole('radio', { name: 'One referee per two tables' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('radio', { name: 'One referee per table' }));
    await waitFor(() => expect(send).toHaveBeenCalledWith({ type: 'setTablesPerReferee', count: 1 }));
    expect(group).toBeTruthy();
    cleanup();
    withRunner(<Setup view={ctlViewOf(lockedFour())} />, send);
    expect((screen.getByRole('radio', { name: 'One referee per table' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
