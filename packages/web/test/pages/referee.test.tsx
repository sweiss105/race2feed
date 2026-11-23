import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/preact';
import { RefereePage } from '../../src/pages/referee/RefereePage';
import { pairFromUrl } from '../../src/pages/referee/pairing';
import { TapQueue } from '../../src/lib/queue';
import { MemoryStorage } from '../lib/fakes';
import { lockedFour, openNext, refViewOf, start, teamId } from '../support/state';
import type { LiveEvent, PenaltyReview } from '../../../server/src/core/model';

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

  it('shows Ready while the round is open and sends stationReady', async () => {
    const { sent } = setup(openNext(lockedFour()));
    fireEvent.click(await screen.findByRole('button', { name: 'Ready' }));
    await waitFor(() => expect(sent).toContainEqual({ type: 'stationReady' }));
  });

  it('shows one big button per team, and +5s only when penalties are on', async () => {
    const e = start(openNext(lockedFour()));
    setup(e);
    expect((await screen.findAllByRole('button', { name: /^T[12]/ })).length).toBe(2);
    expect(screen.queryByRole('button', { name: /\+5s/ })).toBeNull();
    cleanup();
    setup({ ...e, settings: { ...e.settings, penaltiesEnabled: true } });
    expect((await screen.findAllByRole('button', { name: /\+5s/ })).length).toBe(2);
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
    fireEvent.click(await screen.findByRole('button', { name: /Undo/ }));
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
    const pen = await screen.findByRole('button', { name: /penalty for T1/ });
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
    const pen = await screen.findByRole('button', { name: /penalty for T1/ });
    await waitFor(() => expect((pen as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(pen);
    await screen.findByRole('button', { name: /Undo/ });
    const t1 = teamId(e, 'T1');
    const withTaps = { ...e, taps: [
      { id: 'srv-ref', clientTapId: 'mine', kind: 'penalty' as const, round: 1, teamId: t1, amountMs: 5000, source: 'referee' as const, deviceId: 'dev1', createdAt: NOW, removedAt: null },
      { id: 'srv-ctl', kind: 'penalty' as const, round: 1, teamId: t1, amountMs: 5000, source: 'control' as const, createdAt: NOW + 1, removedAt: null },
    ] };
    rerender(<RefereePage view={refViewOf(withTaps)} status="open" clock={clock} queue={queue} send={send} newId={() => 'x'} />);
    fireEvent.click(await screen.findByRole('button', { name: /Undo/ }));
    await waitFor(() => expect(sent).toContainEqual({ type: 'undoTap', tapId: 'srv-ref' }));
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
    render(<RefereePage view={{ ...refViewOf(e), station: { number: 3, tables: [5, 6], ready: false, excluded: true }, teams: [] }} status="open"
      clock={{ synced: () => true, serverNow: () => NOW }} queue={new TapQueue(new MemoryStorage())} send={async () => ({ ok: true })} newId={() => 'x'} />);
    expect(await screen.findByText(/No teams at your tables/)).toBeTruthy();
  });
});

describe('pairing', () => {
  it('pairs with the code from the URL and removes it', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ ok: true, station: 4 }), { status: 200 }));
    const replace = vi.fn();
    const result = await pairFromUrl('https://r2f.test/ref?code=ABC123', fetchFn as unknown as typeof fetch, replace);
    expect(fetchFn).toHaveBeenCalledWith('/api/pair', expect.objectContaining({ method: 'POST', body: JSON.stringify({ code: 'ABC123' }) }));
    expect(replace).toHaveBeenCalledWith('/ref');
    expect(result).toEqual({ paired: true, station: 4 });
  });

  it('does nothing without a code', async () => {
    const fetchFn = vi.fn();
    expect(await pairFromUrl('https://r2f.test/ref', fetchFn as unknown as typeof fetch, vi.fn())).toEqual({ paired: false });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('reports a bad or used code', async () => {
    const fetchFn = vi.fn(async () => new Response('{}', { status: 400 }));
    expect(await pairFromUrl('https://r2f.test/ref?code=NOPE', fetchFn as unknown as typeof fetch, vi.fn())).toEqual({ paired: false, error: 'This pairing code is invalid or already used. Ask race control for a new one.' });
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

    it('does not appear while the race is running', async () => {
      const e = finishedWith({ status: 'pending' });
      setup({ ...e, round: { ...e.round, phase: 'running' } });
      await screen.findAllByRole('button', { name: /^T1/ });
      expect(screen.queryByRole('region', { name: /Penalty for T1/ })).toBeNull();
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
