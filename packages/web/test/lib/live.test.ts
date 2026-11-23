import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LiveConnection } from '../../src/lib/live';
import { FakeWebSocket } from './fakes';

function make(opts: Partial<ConstructorParameters<typeof LiveConnection>[0]> = {}) {
  const messages: any[] = [];
  const statuses: string[] = [];
  const conn = new LiveConnection({
    url: 'wss://x/api/ws',
    onMessage: (m) => messages.push(m),
    onStatus: (s) => statuses.push(s),
    WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    random: () => 0.5,
    ...opts,
  });
  return { conn, messages, statuses };
}

describe('LiveConnection', () => {
  beforeEach(() => { FakeWebSocket.reset(); vi.useFakeTimers(); });
  afterEach(() => vi.useRealTimers());

  it('passes messages through and reports status', () => {
    const { conn, messages, statuses } = make();
    conn.start();
    FakeWebSocket.last().open();
    FakeWebSocket.last().message({ type: 'snapshot', view: { a: 1 } });
    expect(messages).toEqual([{ type: 'snapshot', view: { a: 1 } }]);
    expect(statuses).toEqual(['connecting', 'open']);
  });

  it('reconnects with growing, jittered delays', () => {
    const { conn } = make();
    conn.start();
    FakeWebSocket.last().emitClose(1006); // attempt 0 → 1000 ms
    vi.advanceTimersByTime(999);
    expect(FakeWebSocket.instances.length).toBe(1);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances.length).toBe(2);
    FakeWebSocket.last().emitClose(1006); // attempt 1 → 2000 ms
    vi.advanceTimersByTime(1999);
    expect(FakeWebSocket.instances.length).toBe(2);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances.length).toBe(3);
  });

  it('resets the backoff after 10 s connected', () => {
    const { conn } = make();
    conn.start();
    FakeWebSocket.last().emitClose(1006);
    vi.advanceTimersByTime(1000);
    FakeWebSocket.last().emitClose(1006);
    vi.advanceTimersByTime(2000);
    FakeWebSocket.last().open();
    vi.advanceTimersByTime(10_000);
    FakeWebSocket.last().emitClose(1006);
    vi.advanceTimersByTime(1000);
    expect(FakeWebSocket.instances.length).toBe(4);
  });

  it('stops for good on close code 4401', () => {
    const { conn, statuses } = make();
    conn.start();
    FakeWebSocket.last().open();
    FakeWebSocket.last().emitClose(4401);
    vi.advanceTimersByTime(120_000);
    expect(FakeWebSocket.instances.length).toBe(1);
    expect(statuses.at(-1)).toBe('signed-out');
  });

  it('stops when a failed connect turns out to be signed out', async () => {
    const checkAuth = vi.fn(async () => false);
    const { conn, statuses } = make({ checkAuth });
    conn.start();
    FakeWebSocket.last().emitClose(1006);
    await vi.runAllTimersAsync();
    expect(checkAuth).toHaveBeenCalledTimes(1);
    expect(FakeWebSocket.instances.length).toBe(1);
    expect(statuses.at(-1)).toBe('signed-out');
  });

  it('resolves commands on their ack and rejects when the socket drops', async () => {
    const { conn } = make();
    conn.start();
    const ws = FakeWebSocket.last();
    ws.open();
    const p = conn.command({ type: 'startRace' });
    const sent = ws.sent[0];
    expect(sent).toMatchObject({ type: 'cmd', cmd: { type: 'startRace' } });
    ws.message({ type: 'ack', id: sent.id, ok: true });
    await expect(p).resolves.toMatchObject({ ok: true });

    const q = conn.command({ type: 'finishRace' });
    ws.emitClose(1006);
    await expect(q).rejects.toBe('offline');
  });

  it('rejects commands while offline', async () => {
    const { conn } = make();
    conn.start();
    await expect(conn.command({ type: 'x' })).rejects.toBe('offline');
  });
});
