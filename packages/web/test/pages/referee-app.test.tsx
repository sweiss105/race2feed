import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/preact';
import { App } from '../../src/pages/referee/App';

class FakeSocket {
  static OPEN = 1;
  readyState = 0;
  addEventListener() {}
  removeEventListener() {}
  send() {}
  close() {}
}

function fill(name: string) {
  fireEvent.input(screen.getByLabelText('Your name'), { target: { value: name } });
  fireEvent.click(screen.getByRole('button', { name: 'Start' }));
}

describe('referee App pairing', () => {
  beforeEach(() => {
    vi.stubGlobal('WebSocket', FakeSocket);
    history.replaceState(null, '', '/ref?code=ABC');
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('keeps the form, the name and the code in the URL when the network fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    render(<App />);
    await screen.findByLabelText('Your name');
    fill('Dana');
    expect(await screen.findByText("Can't reach the server. Check the connection and press Start again.")).toBeTruthy();
    expect((screen.getByLabelText('Your name') as HTMLInputElement).value).toBe('Dana');
    expect(location.search).toBe('?code=ABC');
    expect(screen.queryByText('Scan the station QR code')).toBeNull();
  });

  it('strips the code once the server has rejected it, and shows the live page if the device is still paired', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url === '/api/pair' ? new Response('{}', { status: 400 }) : new Response('{}', { status: 200 }))));
    render(<App />);
    await screen.findByLabelText('Your name');
    fill('Dana');
    await waitFor(() => expect(screen.queryByLabelText('Your name')).toBeNull());
    expect(location.search).toBe('');
    await waitFor(() => expect(document.querySelector('.ref')).toBeTruthy());
    expect(screen.queryByText('Scan the station QR code')).toBeNull();
  });

  it('shows the error and the scan prompt when the code is rejected and the device is not paired', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url === '/api/pair' ? new Response('{}', { status: 400 }) : new Response('{}', { status: 401 }))));
    render(<App />);
    await screen.findByLabelText('Your name');
    fill('Dana');
    expect(await screen.findByText('Scan the station QR code')).toBeTruthy();
    expect(screen.getByText(/invalid or already used/)).toBeTruthy();
  });
});

describe('referee App auto-lock notice', () => {
  const pairedFetch = () => vi.fn(async (url: string) => (url === '/api/pair'
    ? new Response(JSON.stringify({ station: 2 }), { status: 200, headers: { 'content-type': 'application/json' } })
    : new Response('{}', { status: 200 })));
  beforeEach(() => {
    vi.stubGlobal('WebSocket', FakeSocket);
    localStorage.clear();
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });

  it('after pairing, shows the notice until the box is ticked and Continue pressed, then the live page', async () => {
    history.replaceState(null, '', '/ref?code=ABC');
    localStorage.setItem('r2f.autoLockAck', '1');
    vi.stubGlobal('fetch', pairedFetch());
    render(<App />);
    await screen.findByLabelText('Your name');
    fill('Dana');
    expect(await screen.findByRole('heading', { name: 'Keep your screen on' })).toBeTruthy();
    // A new pairing clears the earlier acknowledgement.
    expect(localStorage.getItem('r2f.autoLockAck')).toBeNull();
    expect(screen.queryByText('Connecting…')).toBeNull();
    const cont = screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement;
    expect(cont.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("I've turned off auto-lock on this device"));
    expect(cont.disabled).toBe(false);
    fireEvent.click(cont);
    expect(await screen.findByText('Connecting…')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Keep your screen on' })).toBeNull();
    expect(localStorage.getItem('r2f.autoLockAck')).toBe('2');
  });

  it('a device already paired goes straight to the live page, acknowledged or not', async () => {
    history.replaceState(null, '', '/ref');
    vi.stubGlobal('fetch', pairedFetch());
    localStorage.setItem('r2f.autoLockAck', '2');
    render(<App />);
    expect(await screen.findByText('Connecting…')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Keep your screen on' })).toBeNull();
    cleanup();
    localStorage.clear();
    render(<App />);
    expect(await screen.findByText('Connecting…')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Keep your screen on' })).toBeNull();
  });
});
