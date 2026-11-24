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
