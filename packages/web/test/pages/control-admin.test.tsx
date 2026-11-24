import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/preact';
import { RunnerProvider } from '../../src/pages/control/runner';
import { Teams } from '../../src/pages/control/sections/Teams';
import { Setup } from '../../src/pages/control/sections/Setup';
import { Devices } from '../../src/pages/control/sections/Devices';
import { Settings } from '../../src/pages/control/sections/Settings';
import { Events } from '../../src/pages/control/sections/Events';
import { App, EmergencyApp } from '../../src/pages/control/App';
import { FakeWebSocket } from '../lib/fakes';
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
    withRunner(<Teams view={ctlViewOf(blank(4))} />, send);
    fireEvent.input(screen.getByLabelText('Paste CSV'), { target: { value: 'team,category\nA,X\n,Y' } });
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(send).toHaveBeenCalledWith({ type: 'importTeams', csv: 'team,category\nA,X\n,Y' }));
    expect(await screen.findByText('line 3: team and category are both required')).toBeTruthy();
  });

  it('once setup is locked, teams can only be renamed', () => {
    withRunner(<Teams view={ctlViewOf(lockedFour())} />, async () => ({ ok: true }));
    expect(screen.queryByLabelText('Paste CSV')).toBeNull();
    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull();
    expect(screen.getAllByRole('button', { name: /Rename/ }).length).toBe(4);
  });

  it('settings has no console password', () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200 })));
    const { container } = withRunner(<Settings view={ctlViewOf(lockedFour())} />, vi.fn(async () => ({ ok: true })));
    expect(screen.queryByText('Console password')).toBeNull();
    expect(screen.queryByLabelText('New password')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save password' })).toBeNull();
    expect(container.querySelector('input[type="password"]')).toBeNull();
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

  it('explains the auto-finish delay under its field', () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200 })));
    withRunner(<Settings view={ctlViewOf(lockedFour())} />, vi.fn(async () => ({ ok: true })));
    expect(screen.getByText(/Never shorter than the referee undo window\. 0 turns auto-finish off\./)).toBeTruthy();
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

type Route = (url: string, init?: RequestInit) => Response;
const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function stubServer(route: Route) {
  const fetchFn = vi.fn(async (url: string, init?: RequestInit) => route(url, init));
  vi.stubGlobal('fetch', fetchFn);
  vi.stubGlobal('WebSocket', FakeWebSocket);
  return fetchFn;
}

describe('console sign-in', () => {
  beforeEach(() => { cleanup(); FakeWebSocket.reset(); });
  afterEach(() => vi.unstubAllGlobals());

  it('opens the console from Cloudflare Access, with Sign out going to the Access sign-out address', async () => {
    const fetchFn = stubServer((url) => (url === '/api/control/me' ? jsonResponse({ role: 'admin', label: 'a@b.c' }) : jsonResponse([])));
    render(<App />);
    const signOut = await screen.findByRole('link', { name: 'Sign out' });
    expect(signOut.getAttribute('href')).toBe('/cdn-cgi/access/logout');
    expect(fetchFn).toHaveBeenCalledWith('/api/control/me', { redirect: 'manual' });
    await waitFor(() => expect(FakeWebSocket.instances.at(-1)?.url).toMatch(/\/api\/control\/ws$/));
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });

  it('has no sign-in form: a signed-out browser is told to reload', async () => {
    stubServer(() => jsonResponse({ error: 'unauthorized' }, 401));
    render(<App />);
    expect(await screen.findByText('You are not signed in. Reload this page to sign in.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it('says so when Access is not set up', async () => {
    stubServer(() => jsonResponse({ error: 'access_not_configured' }, 503));
    render(<App />);
    expect(await screen.findByText('Console sign-in is not set up.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
  });

  it('fetches lists and exports from the console API it is given', async () => {
    const fetchFn = stubServer(() => jsonResponse([{ id: 'e1', name: 'Gala', date: '2026-12-01', active: true }]));
    withRunner(<Events view={null} />, vi.fn(async () => ({ ok: true })));
    expect((await screen.findByRole('link', { name: 'CSV' })).getAttribute('href')).toBe('/api/control/export?event=e1&format=csv');
    expect(screen.getByRole('link', { name: 'JSON' }).getAttribute('href')).toBe('/api/control/export?event=e1&format=json');
    expect(fetchFn).toHaveBeenCalledWith('/api/control/events');
    cleanup();
    withRunner(<Events view={null} api="/api/emergency" />, vi.fn(async () => ({ ok: true })));
    expect((await screen.findByRole('link', { name: 'CSV' })).getAttribute('href')).toBe('/api/emergency/export?event=e1&format=csv');
    expect(fetchFn).toHaveBeenCalledWith('/api/emergency/events');
    cleanup();
    withRunner(<Settings view={null} api="/api/emergency" />, vi.fn(async () => ({ ok: true })));
    await waitFor(() => expect(fetchFn).toHaveBeenCalledWith('/api/emergency/apikeys'));
  });
});

describe('emergency sign-in page', () => {
  beforeEach(() => { cleanup(); FakeWebSocket.reset(); });
  afterEach(() => vi.unstubAllGlobals());

  it('signs in with the password and opens the console against /api/emergency', async () => {
    let signedIn = false;
    const fetchFn = stubServer((url) => {
      if (url === '/api/emergency/login') { signedIn = true; return jsonResponse({ ok: true, role: 'admin' }); }
      if (url === '/api/emergency/me') return signedIn ? jsonResponse({ role: 'admin', label: 'emergency sign-in' }) : jsonResponse({ error: 'unauthorized' }, 401);
      return jsonResponse([]);
    });
    render(<EmergencyApp />);
    fireEvent.input(await screen.findByLabelText('Password'), { target: { value: 'the-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByRole('link', { name: 'Sign out' });
    expect(fetchFn).toHaveBeenCalledWith('/api/emergency/login', expect.objectContaining({ method: 'POST', body: JSON.stringify({ password: 'the-password' }) }));
    await waitFor(() => expect(FakeWebSocket.instances.at(-1)?.url).toMatch(/\/api\/emergency\/ws$/));

    fireEvent.click(screen.getByRole('link', { name: 'Sign out' }));
    expect(await screen.findByLabelText('Password')).toBeTruthy();
    expect(fetchFn).toHaveBeenCalledWith('/api/emergency/logout', expect.objectContaining({ method: 'POST' }));
  });

  it('says a wrong password is wrong', async () => {
    stubServer((url) => (url === '/api/emergency/login' ? jsonResponse({ error: 'invalid_login' }, 401) : jsonResponse({ error: 'unauthorized' }, 401)));
    render(<EmergencyApp />);
    fireEvent.input(await screen.findByLabelText('Password'), { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Wrong password')).toBeTruthy();
  });

  it('says emergency sign-in is not enabled when the login route answers 404', async () => {
    stubServer((url) => (url === '/api/emergency/login' ? jsonResponse({ error: 'not_found' }, 404) : jsonResponse({ error: 'unauthorized' }, 401)));
    render(<EmergencyApp />);
    fireEvent.input(await screen.findByLabelText('Password'), { target: { value: 'whatever' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Emergency sign-in is not enabled.')).toBeTruthy();
  });

  it('says emergency sign-in is not enabled when the routes are not there at all', async () => {
    stubServer(() => jsonResponse({ error: 'not_found' }, 404));
    render(<EmergencyApp />);
    expect(await screen.findByText('Emergency sign-in is not enabled.')).toBeTruthy();
    expect(screen.queryByLabelText('Password')).toBeNull();
  });
});
