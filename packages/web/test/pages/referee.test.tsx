import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/preact';
import { RefereePage } from '../../src/pages/referee/RefereePage';
import { codeFromUrl, pair } from '../../src/pages/referee/pairing';
import { TapQueue } from '../../src/lib/queue';
import { MemoryStorage } from '../lib/fakes';
import { lockedFour, openNext, refViewOf, start, teamId } from '../support/state';
import type { LiveEvent, PenaltyReview } from '../../../server/src/core/model';
import { handleLifecycle } from '../../../server/src/core/lifecycle';
import { admin, ctx, ok, referee } from '../../../server/test/core/helpers';

const NOW = 1_000_000 + 200_000;

/** Tap buttons enable once saved taps are flushed; wait for that like a referee would. */
async function enabledButton(name: RegExp) {
  const b = (await screen.findByRole('button', { name })) as HTMLButtonElement;
  await waitFor(() => expect(b.disabled).toBe(false));
  return b;
}

function setup(e: LiveEvent, opts: { synced?: boolean; queue?: TapQueue } = {}) {
  const sent: any[] = [];
  const send = vi.fn(async (cmd: any) => { sent.push(cmd); return { ok: true }; });
  const queue = opts.queue ?? new TapQueue(new MemoryStorage());
  const clock = { synced: () => opts.synced ?? true, serverNow: () => NOW };
  let n = 0;
  const utils = render(
    <RefereePage view={refViewOf(e)} status="open" clock={clock} queue={queue} send={send} newId={() => `tap-${++n}`} />,
  );
  return { sent, send, queue, clock, utils };
}

describe('referee page', () => {
  beforeEach(() => cleanup());

  it('shows a Ready per table for two teams, each sending its table', async () => {
    const { sent } = setup(openNext(lockedFour()));
    expect(screen.queryByRole('button', { name: 'Ready' })).toBeNull();
    const second = await screen.findByRole('button', { name: 'Ready: Table 2, T2' });
    expect(second.textContent).toBe('ReadyTable 2 · T2');
    fireEvent.click(second);
    await waitFor(() => expect(sent).toContainEqual({ type: 'stationReady', table: 2 }));
    fireEvent.click(screen.getByRole('button', { name: 'Ready: Table 1, T1' }));
    await waitFor(() => expect(sent).toContainEqual({ type: 'stationReady', table: 1 }));
  });

  it('a readied table shows Ready ✓ while the other stays pressable', async () => {
    const e = ok(handleLifecycle(openNext(lockedFour()), { type: 'stationReady', table: 1 }, ctx(referee(1))));
    setup(e);
    expect(await screen.findByText('Ready ✓')).toBeTruthy();
    expect(screen.getByText('Table 1 · T1')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Table 1/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Ready: Table 2, T2' })).toBeTruthy();
    expect(screen.queryByText('Waiting for the start')).toBeNull();
  });

  it('both tables ready: Ready ✓ and waiting for the start', async () => {
    let e = ok(handleLifecycle(openNext(lockedFour()), { type: 'stationReady', table: 1 }, ctx(referee(1))));
    e = ok(handleLifecycle(e, { type: 'stationReady', table: 2 }, ctx(referee(1))));
    setup(e);
    expect(await screen.findByText('Waiting for the start')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Ready/ })).toBeNull();
  });

  it('one team at the station: one plain Ready that sends its table', async () => {
    const e = openNext(lockedFour());
    const v = refViewOf(e);
    const sent: any[] = [];
    render(<RefereePage view={{ ...v, teams: [v.teams[1]!] }} status="open" clock={{ synced: () => true, serverNow: () => NOW }}
      queue={new TapQueue(new MemoryStorage())} send={async (cmd: any) => { sent.push(cmd); return { ok: true }; }} newId={() => 'x'} />);
    const b = await screen.findByRole('button', { name: 'Ready' });
    expect(b.textContent).toBe('Ready');
    fireEvent.click(b);
    await waitFor(() => expect(sent).toContainEqual({ type: 'stationReady', table: 2 }));
  });

  it('shows one big button per team, and Penalty only when penalties are on', async () => {
    const e = start(openNext(lockedFour()));
    setup(e);
    expect((await screen.findAllByRole('button', { name: /^T[12]/ })).length).toBe(2);
    expect(screen.getByLabelText('Race clock')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Penalty for/ })).toBeNull();
    cleanup();
    setup({ ...e, settings: { ...e.settings, penaltiesEnabled: true } });
    expect(await screen.findByRole('button', { name: 'Penalty for T1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Penalty for T2' })).toBeTruthy();
    expect(screen.queryAllByRole('button').filter((b) => (b.getAttribute('aria-label') ?? b.textContent ?? '').includes('+5s'))).toEqual([]);
  });

  it('stamps a tap with the server clock, queues it, and offers undo', async () => {
    const e = start(openNext(lockedFour()));
    const { sent, queue, utils } = setup(e);
    fireEvent.click(await enabledButton(/^T1/));
    await waitFor(() => expect(sent).toContainEqual({ type: 'tapFinish', teamId: teamId(e, 'T1'), atServerMs: NOW, clientTapId: 'tap-1' }));
    expect(queue.all()).toEqual([]);
    // The server's next view carries the tap; Undo targets it.
    const withTap = { ...e, taps: [{ id: 'srv-1', clientTapId: 'tap-1', kind: 'finish' as const, round: 1, teamId: teamId(e, 'T1'), elapsedMs: 200_000, source: 'referee' as const, deviceId: 'dev1', createdAt: NOW, removedAt: null }] };
    utils.rerender(<RefereePage view={refViewOf(withTap)} status="open" clock={{ synced: () => true, serverNow: () => NOW }} queue={queue} send={async (c: any) => { sent.push(c); return { ok: true }; }} newId={() => 'x'} />);
    fireEvent.click(await screen.findByRole('button', { name: /Undo T1 finished/ }));
    await waitFor(() => expect(sent).toContainEqual({ type: 'undoTap', tapId: 'srv-1' }));
  });

  it('keeps a tap queued when the network is down', async () => {
    const e = start(openNext(lockedFour()));
    const queue = new TapQueue(new MemoryStorage());
    render(<RefereePage view={refViewOf(e)} status="open" clock={{ synced: () => true, serverNow: () => NOW }} queue={queue}
      send={async () => { throw 'offline'; }} newId={() => 'tap-9'} />);
    fireEvent.click(await enabledButton(/^T1/));
    await waitFor(() => expect(queue.all().map((q) => q.clientTapId)).toEqual(['tap-9']));
  });

  it('still accepts taps during a dropout and sends them on reconnect', async () => {
    const e = start(openNext(lockedFour()));
    const queue = new TapQueue(new MemoryStorage());
    const sent: any[] = [];
    let online = true;
    const send = async (cmd: any) => { if (!online) throw 'offline'; sent.push(cmd); return { ok: true }; };
    const props = { view: refViewOf(e), clock: { synced: () => true, serverNow: () => NOW }, queue, send, newId: () => 'tap-off' };
    const { rerender } = render(<RefereePage {...props} status="open" />);
    await enabledButton(/^T1/);
    online = false;
    rerender(<RefereePage {...props} status="offline" />);
    fireEvent.click(await enabledButton(/^T1/));
    await waitFor(() => expect(queue.all().map((q) => q.clientTapId)).toEqual(['tap-off']));
    online = true;
    rerender(<RefereePage {...props} status="open" />);
    await waitFor(() => expect(sent.filter((c) => c.clientTapId === 'tap-off').length).toBe(1));
    expect(queue.all()).toEqual([]);
  });

  it('shows taps waiting to send, so a referee does not tap twice', async () => {
    let e = start(openNext(lockedFour()));
    e = { ...e, settings: { ...e.settings, penaltiesEnabled: true } };
    const queue = new TapQueue(new MemoryStorage());
    let n = 0;
    render(<RefereePage view={refViewOf(e)} status="offline" clock={{ synced: () => true, serverNow: () => NOW }} queue={queue}
      send={async () => { throw 'offline'; }} newId={() => `q-${++n}`} />);
    // First load still needs one flush; status starts offline here, so seed it as already flushed by allowing taps after sync.
    const pen = await screen.findByRole('button', { name: /Penalty for T1/ });
    await waitFor(() => expect((pen as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(pen);
    await waitFor(() => expect(pen.textContent).toContain('×1'));
    fireEvent.click(await enabledButton(/^T1/));
    const t1 = await screen.findByRole('button', { name: /^T1/ });
    await waitFor(() => expect(t1.textContent).toContain('Waiting to send'));
    expect((t1 as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/2 taps waiting to send/)).toBeTruthy();
  });

  it('keeps retrying a tap that timed out while still connected', async () => {
    const e = start(openNext(lockedFour()));
    const queue = new TapQueue(new MemoryStorage());
    let calls = 0;
    const send = async () => { calls++; if (calls <= 2) throw 'timeout'; return { ok: true }; };
    render(<RefereePage view={refViewOf(e)} status="open" clock={{ synced: () => true, serverNow: () => NOW }} queue={queue}
      send={send} newId={() => 'slow-1'} retryMs={40} />);
    fireEvent.click(await enabledButton(/^T1/));
    await waitFor(() => expect(queue.all()).toEqual([]), { timeout: 2000 });
  });

  it('drops queued taps from an earlier round instead of sending them now', async () => {
    const e = start(openNext(lockedFour()));
    const storage = new MemoryStorage();
    new TapQueue(storage).add({ clientTapId: 'old-round', round: 0, cmd: { type: 'tapPenalty', teamId: 'x', clientTapId: 'old-round' } });
    const { sent } = setup(e, { queue: new TapQueue(storage) });
    await enabledButton(/^T1/);
    expect(sent.find((c) => c.clientTapId === 'old-round')).toBeUndefined();
    expect(new TapQueue(storage).all()).toEqual([]);
  });

  it('undoes its own tap even if race control added one after it', async () => {
    let e = start(openNext(lockedFour()));
    e = { ...e, settings: { ...e.settings, penaltiesEnabled: true } };
    const queue = new TapQueue(new MemoryStorage());
    const sent: any[] = [];
    const send = async (c: any) => { sent.push(c); return { ok: true }; };
    const clock = { synced: () => true, serverNow: () => NOW };
    const { rerender } = render(<RefereePage view={refViewOf(e)} status="open" clock={clock} queue={queue} send={send} newId={() => 'mine'} />);
    const pen = await screen.findByRole('button', { name: /Penalty for T1/ });
    await waitFor(() => expect((pen as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(pen);
    await waitFor(() => expect(sent).toContainEqual(expect.objectContaining({ type: 'tapPenalty', clientTapId: 'mine' })));
    const t1 = teamId(e, 'T1');
    const withTaps = { ...e, taps: [
      { id: 'srv-ref', clientTapId: 'mine', kind: 'penalty' as const, round: 1, teamId: t1, amountMs: 5000, source: 'referee' as const, deviceId: 'dev1', createdAt: NOW, removedAt: null, review: { status: 'pending' as const } },
      { id: 'srv-ctl', kind: 'penalty' as const, round: 1, teamId: t1, amountMs: 5000, source: 'control' as const, createdAt: NOW + 1, removedAt: null },
    ] };
    rerender(<RefereePage view={refViewOf(withTaps)} status="open" clock={clock} queue={queue} send={send} newId={() => 'x'} />);
    fireEvent.click(await screen.findByRole('button', { name: /Undo/ }));
    await waitFor(() => expect(sent).toContainEqual({ type: 'undoTap', tapId: 'srv-ref' }));
  });

  const serverTap = (e: LiveEvent, name: string, id: string, clientTapId: string, createdAt = NOW) => ({
    id, clientTapId, kind: 'finish' as const, round: 1, teamId: teamId(e, name), elapsedMs: 200_000,
    source: 'referee' as const, deviceId: 'dev1', createdAt, removedAt: null,
  });

  it('offers a separate undo for each recent tap', async () => {
    const e = start(openNext(lockedFour()));
    const { sent, queue, clock, utils } = setup(e);
    fireEvent.click(await enabledButton(/^T1/));
    await waitFor(() => expect(queue.all()).toEqual([]));
    fireEvent.click(await enabledButton(/^T2/));
    await waitFor(() => expect(sent.filter((c) => c.type === 'tapFinish').length).toBe(2));
    const withTaps = { ...e, taps: [serverTap(e, 'T1', 'srv-1', 'tap-1'), serverTap(e, 'T2', 'srv-2', 'tap-2')] };
    utils.rerender(<RefereePage view={refViewOf(withTaps)} status="open" clock={clock} queue={queue}
      send={async (c: any) => { sent.push(c); return { ok: true }; }} newId={() => 'x'} />);
    expect(await screen.findByRole('button', { name: 'Undo T2 finished' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Undo T1 finished' }));
    await waitFor(() => expect(sent).toContainEqual({ type: 'undoTap', tapId: 'srv-1' }));
  });

  it('offers undo for a tap that the queue delivered after a dropout', async () => {
    const e = start(openNext(lockedFour()));
    const storage = new MemoryStorage();
    new TapQueue(storage).add({ clientTapId: 'old-1', round: 1, cmd: { type: 'tapFinish', teamId: teamId(e, 'T1'), atServerMs: 1, clientTapId: 'old-1' } });
    const withTap = { ...e, taps: [serverTap(e, 'T1', 'srv-9', 'old-1')] };
    setup(withTap, { queue: new TapQueue(storage) });
    expect(await screen.findByRole('button', { name: 'Undo T1 finished' })).toBeTruthy();
  });

  it('keeps the undo and says so when the undo cannot be sent', async () => {
    const e = start(openNext(lockedFour()));
    const queue = new TapQueue(new MemoryStorage());
    const send = vi.fn(async (cmd: any) => { if (cmd.type === 'undoTap') throw 'offline'; return { ok: true }; });
    const clock = { synced: () => true, serverNow: () => NOW };
    const withTap = { ...e, taps: [serverTap(e, 'T1', 'srv-1', 'tap-1')] };
    const { rerender } = render(<RefereePage view={refViewOf(e)} status="open" clock={clock} queue={queue} send={send} newId={() => 'tap-1'} />);
    fireEvent.click(await enabledButton(/^T1/));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    rerender(<RefereePage view={refViewOf(withTap)} status="open" clock={clock} queue={queue} send={send} newId={() => 'x'} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Undo T1 finished' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Could not undo — not connected. Try again.');
    expect(screen.getByRole('button', { name: 'Undo T1 finished' })).toBeTruthy();
  });

  it('sends one undo for two quick presses, and a tap already gone is no error', async () => {
    const e = start(openNext(lockedFour()));
    const queue = new TapQueue(new MemoryStorage());
    let answer!: (a: { ok: boolean; code?: string }) => void;
    const send = vi.fn((cmd: any) => cmd.type === 'undoTap' ? new Promise((r) => { answer = r; }) : Promise.resolve({ ok: true }));
    const clock = { synced: () => true, serverNow: () => NOW };
    const withTap = { ...e, taps: [serverTap(e, 'T1', 'srv-1', 'tap-1')] };
    const { rerender } = render(<RefereePage view={refViewOf(e)} status="open" clock={clock} queue={queue} send={send as never} newId={() => 'tap-1'} />);
    fireEvent.click(await enabledButton(/^T1/));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    rerender(<RefereePage view={refViewOf(withTap)} status="open" clock={clock} queue={queue} send={send as never} newId={() => 'x'} />);
    const undo = await screen.findByRole('button', { name: 'Undo T1 finished' });
    fireEvent.click(undo);
    fireEvent.click(undo);
    expect(send.mock.calls.filter(([c]) => c.type === 'undoTap')).toEqual([[{ type: 'undoTap', tapId: 'srv-1' }]]);
    answer({ ok: false, code: 'not_found' });
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('hides undo once the window has passed', async () => {
    const e = start(openNext(lockedFour()));
    const storage = new MemoryStorage();
    new TapQueue(storage).add({ clientTapId: 'old-1', round: 1, cmd: { type: 'tapFinish', teamId: teamId(e, 'T1'), atServerMs: 1, clientTapId: 'old-1' } });
    const late = { ...e, settings: { ...e.settings, undoWindowMs: 10_000 }, taps: [serverTap(e, 'T1', 'srv-9', 'old-1', NOW - 10_001)] };
    const queue = new TapQueue(storage);
    const { send } = setup(late, { queue });
    await waitFor(() => expect(send).toHaveBeenCalled());
    await waitFor(() => expect(queue.all()).toEqual([]));
    expect(screen.queryByRole('button', { name: /Undo/ })).toBeNull();
  });

  it('reports a saved tap the server refused for good', async () => {
    const e = start(openNext(lockedFour()));
    const storage = new MemoryStorage();
    new TapQueue(storage).add({ clientTapId: 'old-1', round: 1, cmd: { type: 'tapFinish', teamId: teamId(e, 'T1'), atServerMs: 1, clientTapId: 'old-1' } });
    const queue = new TapQueue(storage);
    const clock = { synced: () => true, serverNow: () => NOW };
    render(<RefereePage view={refViewOf(e)} status="open" clock={clock} queue={queue}
      send={async () => ({ ok: false, code: 'already_finished', message: 'That team already has a result.' })} newId={() => 'x'} />);
    expect((await screen.findByRole('alert')).textContent).toBe('The saved tap for T1 in round 1 was refused: That team already has a result.');
    expect(queue.all()).toEqual([]);
  });

  it('reports a refused saved tap even if the round changed while it was being sent', async () => {
    const e = start(openNext(lockedFour()));
    const storage = new MemoryStorage();
    new TapQueue(storage).add({ clientTapId: 'old-1', round: 1, cmd: { type: 'tapFinish', teamId: teamId(e, 'T1'), atServerMs: 1, clientTapId: 'old-1' } });
    const queue = new TapQueue(storage);
    const clock = { synced: () => true, serverNow: () => NOW };
    let answer!: (a: { ok: false; code: string; message: string }) => void;
    const send = vi.fn(() => new Promise<any>((r) => { answer = r; }));
    const props = { status: 'open' as const, clock, queue, send, newId: () => 'x' };
    const { rerender } = render(<RefereePage {...props} view={refViewOf(e)} />);
    await waitFor(() => expect(send).toHaveBeenCalled());
    const round2 = refViewOf(e);
    rerender(<RefereePage {...props} view={{ ...round2, round: { ...round2.round, current: 2 } }} />);
    answer({ ok: false, code: 'already_finished', message: 'That team already has a result.' });
    expect((await screen.findByRole('alert')).textContent).toBe('The saved tap for T1 in round 1 was refused: That team already has a result.');
  });

  it('does not leave a no-connection error on screen after the tap is delivered', async () => {
    const e = start(openNext(lockedFour()));
    const queue = new TapQueue(new MemoryStorage());
    render(<RefereePage view={refViewOf(e)} status="open" clock={{ synced: () => true, serverNow: () => NOW }} queue={queue}
      send={async () => { throw 'offline'; }} newId={() => 'tap-9'} />);
    fireEvent.click(await enabledButton(/^T1/));
    await waitFor(() => expect(queue.all().length).toBe(1));
    expect(await screen.findByRole('status')).toBeTruthy();
    expect(screen.getByText(/1 tap waiting to send/)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('blocks taps until the clock is synced', async () => {
    setup(start(openNext(lockedFour())), { synced: false });
    const buttons = await screen.findAllByRole('button', { name: /^T[12]/ });
    for (const b of buttons) expect((b as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Syncing clock/)).toBeTruthy();
  });

  it('sends taps queued before a reload exactly once, before new taps', async () => {
    const e = start(openNext(lockedFour()));
    const storage = new MemoryStorage();
    new TapQueue(storage).add({ clientTapId: 'old', cmd: { type: 'tapFinish', teamId: 'x', atServerMs: 1, clientTapId: 'old' } });
    const { sent } = setup(e, { queue: new TapQueue(storage) });
    await waitFor(() => expect(sent.filter((c) => c.clientTapId === 'old').length).toBe(1));
    expect(new TapQueue(storage).all()).toEqual([]);
  });

  it('says so when no teams are at its tables', async () => {
    const e = start(openNext(lockedFour()));
    render(<RefereePage view={{ ...refViewOf(e), station: { number: 3, tables: [5, 6], ready: false, excluded: true, readyTables: [], assigned: true, moved: false }, teams: [] }} status="open"
      clock={{ synced: () => true, serverNow: () => NOW }} queue={new TapQueue(new MemoryStorage())} send={async () => ({ ok: true })} newId={() => 'x'} />);
    expect(await screen.findByText(/No teams at your tables/)).toBeTruthy();
  });
});

describe('pairing', () => {
  it('reads the code from the URL', () => {
    expect(codeFromUrl('https://r2f.test/ref?code=ABC123')).toBe('ABC123');
  });

  it('has no code when the URL carries none', () => {
    expect(codeFromUrl('https://r2f.test/ref')).toBeNull();
  });

  it('pairs with the code and the name', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ ok: true, station: 4 }), { status: 200 }));
    const result = await pair('ABC123', 'Dana', fetchFn as unknown as typeof fetch);
    expect(fetchFn).toHaveBeenCalledWith('/api/pair', expect.objectContaining({ method: 'POST', body: JSON.stringify({ code: 'ABC123', name: 'Dana' }) }));
    expect(result).toEqual({ paired: true, station: 4 });
  });

  it('reports a bad or used code as final', async () => {
    const fetchFn = vi.fn(async () => new Response('{}', { status: 400 }));
    expect(await pair('NOPE', 'Dana', fetchFn as unknown as typeof fetch)).toEqual({ paired: false, retry: false, error: 'This pairing code is invalid or already used. Ask race control for a new one.' });
  });

  it('asks to retry when the request throws', async () => {
    const fetchFn = vi.fn(async () => { throw new TypeError('offline'); });
    expect(await pair('ABC', 'Dana', fetchFn as unknown as typeof fetch)).toEqual({ paired: false, retry: true, error: "Can't reach the server. Check the connection and press Start again." });
  });

  it('asks to retry on a 503 and on a 429', async () => {
    for (const status of [503, 429]) {
      const fetchFn = vi.fn(async () => new Response('{}', { status }));
      expect(await pair('ABC', 'Dana', fetchFn as unknown as typeof fetch)).toMatchObject({ paired: false, retry: true });
    }
  });

  describe('penalty notes', () => {
    beforeEach(() => cleanup());
    const finishedWith = (review: PenaltyReview): LiveEvent => {
      const e = start(openNext(lockedFour()));
      return {
        ...e,
        round: { ...e.round, phase: 'finished' as const },
        taps: [{ id: 'pen-1', kind: 'penalty' as const, round: 1, teamId: teamId(e, 'T1'), amountMs: 5000, source: 'referee' as const, deviceId: 'dev1', createdAt: 1, removedAt: null, review }],
      };
    };

    describe('while the race is running', () => {
      /** Round 1 running with penalties on; this tablet gave T1 a pending penalty (tap `pen-mine`) at `penAt`. */
      const runningWith = (penAt: number, extra: (e: LiveEvent) => Partial<LiveEvent> = () => ({})): LiveEvent => {
        const e = start(openNext(lockedFour()));
        const base: LiveEvent = {
          ...e,
          settings: { ...e.settings, penaltiesEnabled: true, undoWindowMs: 10_000 },
          taps: [{ id: 'pen-1', clientTapId: 'pen-mine', kind: 'penalty' as const, round: 1, teamId: teamId(e, 'T1'), amountMs: 0, source: 'referee' as const, deviceId: 'dev1', createdAt: penAt, removedAt: null, review: { status: 'pending' as const } }],
        };
        return { ...base, ...extra(base) };
      };
      const finishTap = (e: LiveEvent, createdAt: number) => ({
        id: 'fin-1', clientTapId: 'fin-mine', kind: 'finish' as const, round: 1, teamId: teamId(e, 'T1'), elapsedMs: 150_000,
        source: 'referee' as const, deviceId: 'dev1', createdAt, removedAt: null,
      });
      /** Mounts the page as the tablet that made `pen-mine` and `fin-mine`; `show(e)` sends a new view. */
      async function mount(e: LiveEvent) {
        const storage = new MemoryStorage();
        const q = new TapQueue(storage);
        q.add({ clientTapId: 'pen-mine', round: 1, cmd: { type: 'tapPenalty', teamId: teamId(e, 'T1'), clientTapId: 'pen-mine' } });
        q.add({ clientTapId: 'fin-mine', round: 1, cmd: { type: 'tapFinish', teamId: teamId(e, 'T1'), atServerMs: 1, clientTapId: 'fin-mine' } });
        const queue = new TapQueue(storage);
        const sent: any[] = [];
        const clock = { synced: () => true, serverNow: () => NOW };
        const send = async (c: any) => { sent.push(c); return { ok: true }; };
        let view = e;
        const page = () => <RefereePage view={refViewOf(view)} status="open" clock={clock} queue={queue} send={send} newId={() => 'x'} />;
        const { rerender } = render(page());
        await waitFor(() => expect(queue.all()).toEqual([]));
        return {
          sent,
          show: (next: LiveEvent) => { view = next; rerender(page()); },
        };
      }
      const card = () => screen.queryByRole('region', { name: /Penalty for T1/ });

      it('shows no card for a team that has not finished', async () => {
        await mount(runningWith(NOW - 60_000));
        await screen.findAllByRole('button', { name: /^T1/ });
        expect(card()).toBeNull();
      });

      it("shows the card as soon as the view shows the team's finish, while its Undo is still on offer", async () => {
        const e = runningWith(NOW - 60_000);
        const { show, sent } = await mount(e);
        await screen.findAllByRole('button', { name: /^T1/ });
        expect(card()).toBeNull();
        show({ ...e, taps: [...e.taps, finishTap(e, NOW - 1_000)] });
        expect(await screen.findByRole('button', { name: 'Undo T1 finished' })).toBeTruthy();
        expect(card()).not.toBeNull();
        // The card sits below the team buttons.
        const t1 = screen.getAllByRole('button', { name: /^T1/ })[0]!;
        expect(t1.compareDocumentPosition(card()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Started early' }));
        fireEvent.click(card()!.querySelector('button[type="submit"]')!);
        await waitFor(() => expect(sent).toContainEqual({ type: 'notePenalty', tapId: 'pen-1', reasonId: 'early' }));
      });

      it('puts the Undo rows and the card in one scrolling area below the team buttons, Undo rows first', async () => {
        const e = runningWith(NOW - 1_000, (b) => ({ taps: [...b.taps, finishTap(b, NOW - 2_000)] }));
        await mount(e);
        const undoFinish = await screen.findByRole('button', { name: 'Undo T1 finished' });
        const undoPen = screen.getByRole('button', { name: 'Undo penalty for T1' });
        const notes = card()!.closest('.ref-notes')!;
        const below = notes.closest('.ref-below')!;
        expect(below).not.toBeNull();
        expect(below.contains(undoFinish) && below.contains(undoPen)).toBe(true);
        for (const u of [undoFinish, undoPen]) expect(u.compareDocumentPosition(notes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        const teams = document.querySelector('.ref-teams')!;
        expect(below.contains(teams) || teams.contains(below)).toBe(false);
        expect(teams.compareDocumentPosition(below) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      });

      it('shows the card straight away for a penalty given after the team finished', async () => {
        const e = runningWith(NOW - 1_000, (b) => ({ taps: [...b.taps, finishTap(b, NOW - 60_000)] }));
        await mount(e);
        expect(await screen.findByRole('button', { name: 'Undo penalty for T1' })).toBeTruthy();
        expect(card()).not.toBeNull();
      });

      it('removes the card when the finish is undone', async () => {
        const e = runningWith(NOW - 60_000, (b) => ({ taps: [...b.taps, finishTap(b, NOW - 1_000)] }));
        const { show } = await mount(e);
        await waitFor(() => expect(card()).not.toBeNull());
        show({ ...e, taps: e.taps.map((t) => (t.id === 'fin-1' ? { ...t, removedAt: NOW } : t)) });
        await waitFor(() => expect(card()).toBeNull());
      });

      it('shows the card for a team race control marked DNF', async () => {
        const e = runningWith(NOW - 1_000, (b) => ({ overrides: [{ round: 1, teamId: teamId(b, 'T1'), at: NOW - 500, set: { kind: 'status' as const, status: 'dnf' as const } }] }));
        await mount(e);
        await screen.findAllByRole('button', { name: /^T1/ });
        expect(card()).not.toBeNull();
      });

      it('keeps a half-written note when the round finishes', async () => {
        const e = runningWith(NOW - 60_000, (b) => ({ taps: [...b.taps, finishTap(b, NOW - 60_000)] }));
        const { show } = await mount(e);
        await waitFor(() => expect(card()).not.toBeNull());
        fireEvent.click(screen.getByRole('button', { name: 'Started early' }));
        fireEvent.input(screen.getByRole('textbox', { name: /Note/ }), { target: { value: 'went at 3' } });
        show({ ...e, round: { ...e.round, phase: 'finished' as const } });
        expect(await screen.findByText(/Round 1 finished/)).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Started early' }).getAttribute('aria-pressed')).toBe('true');
        expect((screen.getByRole('textbox', { name: /Note/ }) as HTMLTextAreaElement).value).toBe('went at 3');
      });
    });

    it('asks for a reason after the round and sends it to race control', async () => {
      const { sent } = setup(finishedWith({ status: 'pending' }));
      const card = await screen.findByRole('region', { name: /Penalty for T1/ });
      const send = card.querySelector('button[type="submit"]') as HTMLButtonElement;
      expect(send.disabled).toBe(true);
      fireEvent.click(screen.getByRole('button', { name: 'Started early' }));
      fireEvent.input(screen.getByRole('textbox', { name: /Note/ }), { target: { value: 'went at 3' } });
      fireEvent.click(send);
      await waitFor(() => expect(sent).toContainEqual({ type: 'notePenalty', tapId: 'pen-1', reasonId: 'early', note: 'went at 3' }));
    });

    it('shows that a note was sent', async () => {
      setup(finishedWith({ status: 'pending', refereeReasonId: 'early' }));
      expect(await screen.findByText(/Sent ✓/)).toBeTruthy();
    });

    it('skips penalties race control already decided', async () => {
      setup(finishedWith({ status: 'approved', reasonId: 'early', reasonName: 'Started early' }));
      await screen.findAllByText(/Round 1 finished/);
      expect(screen.queryByRole('region', { name: /Penalty for T1/ })).toBeNull();
    });
  });

  it('labels a one-table station and shows just its team', async () => {
    cleanup();
    let e = lockedFour();
    e = { ...e, setup: { ...e.setup, tablesPerStation: 1 } };
    e = start(openNext(e));
    render(<RefereePage view={refViewOf(e, 3)} status="open" clock={{ synced: () => true, serverNow: () => NOW }} queue={new TapQueue(new MemoryStorage())} send={async () => ({ ok: true })} newId={() => 'x'} />);
    expect(screen.getByText('Table 3', { selector: '.ref-meta .headline' })).toBeTruthy();
    expect((await screen.findAllByRole('button', { name: /^T\d/ })).length).toBe(1);
  });
});
