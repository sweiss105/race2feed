import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/preact';
import { ConsolePage } from '../../src/pages/control/ConsolePage';
import { RunnerProvider } from '../../src/pages/control/runner';
import { Settings } from '../../src/pages/control/sections/Settings';
import { Events } from '../../src/pages/control/sections/Events';
import { ctlViewOf, lockedFour, runRound, seedTimes, teamId } from '../support/state';
import type { LiveEvent } from '../../../server/src/core/model';
import type { Ack } from '../../src/lib/types';

const me = (role: 'admin' | 'control') => ({ role, label: role });
const console_ = (e: LiveEvent, send: (cmd: any) => Promise<Ack>, role: 'admin' | 'control' = 'control') =>
  render(<ConsolePage me={me(role)} view={ctlViewOf(e)} send={send} serverNow={() => 0} status="open" />);

function withPending(): LiveEvent {
  const e = runRound(lockedFour(), seedTimes);
  return {
    ...e,
    taps: [...e.taps, {
      id: 'pen-1', kind: 'penalty', round: 1, teamId: teamId(e, 'T2'), amountMs: 5000, source: 'referee', deviceId: 'd', createdAt: 5, removedAt: null,
      review: { status: 'pending', refereeReasonId: 'early', refereeNote: 'went at 3' },
    }],
  };
}

const allDone = () => [1, 2, 3, 4].reduce((e) => runRound(e, seedTimes), lockedFour());

describe('penalty review', () => {
  beforeEach(() => cleanup());

  it('lists pending penalties with the referee note and approves with the chosen reason', async () => {
    const send = vi.fn(async () => ({ ok: true }));
    console_(withPending(), send);
    const panel = screen.getByRole('region', { name: 'Penalties to review' });
    expect(within(panel).getByText(/went at 3/)).toBeTruthy();
    const reason = within(panel).getByLabelText('Penalty') as HTMLSelectElement;
    expect(reason.value).toBe('early');
    fireEvent.change(reason, { target: { value: 'count' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(send).toHaveBeenCalledWith({ type: 'decidePenalty', tapId: 'pen-1', decision: 'approve', reasonId: 'count' }));
  });

  it("picks up the referee's reason when the note arrives after the card is shown", () => {
    const e = withPending();
    const noNote = { ...e, taps: e.taps.map((t) => (t.id === 'pen-1' ? { ...t, review: { status: 'pending' as const } } : t)) };
    const { rerender } = console_(noNote, async () => ({ ok: true }));
    rerender(<ConsolePage me={me('control')} view={ctlViewOf(e)} send={async () => ({ ok: true })} serverNow={() => 0} status="open" />);
    expect((within(screen.getByRole('region', { name: 'Penalties to review' })).getByLabelText('Penalty') as HTMLSelectElement).value).toBe('early');
  });

  it('rejects a penalty', async () => {
    const send = vi.fn(async () => ({ ok: true }));
    console_(withPending(), send);
    fireEvent.click(within(screen.getByRole('region', { name: 'Penalties to review' })).getByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(send).toHaveBeenCalledWith({ type: 'decidePenalty', tapId: 'pen-1', decision: 'reject' }));
  });

  it('adds a race-control penalty with a reason', async () => {
    const send = vi.fn(async () => ({ ok: true }));
    const e = runRound(lockedFour(), seedTimes);
    console_(e, send);
    const row = screen.getByTestId(`team-${teamId(e, 'T1')}`);
    fireEvent.change(within(row).getByLabelText('Penalty reason'), { target: { value: 'sealed' } });
    fireEvent.click(row.querySelector('button[data-action="add-penalty"]')!);
    await waitFor(() => expect(send).toHaveBeenCalledWith({ type: 'addPenalty', round: 1, teamId: teamId(e, 'T1'), reasonId: 'sealed' }));
  });
});

describe('show champion', () => {
  beforeEach(() => cleanup());

  it('is offered only once every round is raced', () => {
    console_(runRound(lockedFour(), seedTimes), async () => ({ ok: true }));
    expect(screen.queryByRole('button', { name: 'Show champion' })).toBeNull();
  });

  it('asks for the bag count, then shows the champion', async () => {
    const send = vi.fn(async () => ({ ok: true }));
    console_({ ...allDone(), bagTotal: '900' }, send);
    fireEvent.click(screen.getByRole('button', { name: 'Show champion' }));
    const sheet = screen.getByRole('dialog', { name: 'Show the champion' });
    const bags = within(sheet).getByLabelText('Bags of food packed') as HTMLInputElement;
    expect(bags.value).toBe('900');
    fireEvent.input(bags, { target: { value: '1,234' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Show' }));
    await waitFor(() => expect(send).toHaveBeenCalledWith({ type: 'showChampion', bagTotal: '1,234' }));
  });

  it('can hide it again', async () => {
    const send = vi.fn(async () => ({ ok: true }));
    console_({ ...allDone(), championShown: true }, send);
    fireEvent.click(screen.getByRole('button', { name: 'Hide champion' }));
    await waitFor(() => expect(send).toHaveBeenCalledWith({ type: 'hideChampion' }));
  });
});

describe('admin: penalty list and ending the event', () => {
  beforeEach(() => cleanup());
  afterEach(() => vi.unstubAllGlobals());
  const withRunner = (ui: preact.ComponentChildren, send: (cmd: any) => Promise<Ack>) => render(<RunnerProvider send={send}>{ui}</RunnerProvider>);

  it('edits and saves the penalty list', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200 })));
    const send = vi.fn(async () => ({ ok: true }));
    withRunner(<Settings view={ctlViewOf(lockedFour())} />, send);
    const list = screen.getByRole('region', { name: 'Penalty list' });
    fireEvent.input(within(list).getByLabelText('Seconds for Bag not sealed'), { target: { value: '7.5' } });
    fireEvent.click(within(list).getByRole('button', { name: 'Remove Wrong item count' }));
    fireEvent.click(within(list).getByRole('button', { name: 'Save penalty list' }));
    await waitFor(() => expect(send).toHaveBeenCalledWith({
      type: 'setPenaltyReasons',
      reasons: [
        { id: 'sealed', name: 'Bag not sealed', kind: 'time', amountMs: 7500 },
        { id: 'early', name: 'Started early', kind: 'time', amountMs: 10000 },
        { id: 'unsafe', name: 'Unsafe conduct', kind: 'dq' },
      ],
    }));
  });

  it('ends the active event after confirming, warning about unraced rounds', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([{ id: 'ev1', name: 'Test', date: '2026-11-24', active: true, ended: false }]), { status: 200 })));
    const send = vi.fn(async () => ({ ok: true }));
    withRunner(<Events view={ctlViewOf(runRound(lockedFour(), seedTimes))} />, send);
    fireEvent.click(await screen.findByRole('button', { name: 'End event' }));
    const sheet = screen.getByRole('dialog', { name: /End Test\?/ });
    expect(within(sheet).getByText(/3 rounds not raced yet/)).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'End event' }));
    await waitFor(() => expect(send).toHaveBeenCalledWith({ type: 'endEvent', eventId: 'ev1' }));
  });

  it('marks ended events and asks before reopening one', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([{ id: 'ev1', name: 'Test', date: '2026-11-24', active: false, ended: true }]), { status: 200 })));
    const send = vi.fn(async () => ({ ok: true }));
    withRunner(<Events view={null} />, send);
    expect(await screen.findByText('Ended')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Make active' }));
    const sheet = screen.getByRole('dialog', { name: /Reopen Test\?/ });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Reopen' }));
    await waitFor(() => expect(send).toHaveBeenCalledWith({ type: 'activateEvent', eventId: 'ev1' }));
  });
});
