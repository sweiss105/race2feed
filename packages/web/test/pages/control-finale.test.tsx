import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/preact';
import { ConsolePage } from '../../src/pages/control/ConsolePage';
import { RunnerProvider } from '../../src/pages/control/runner';
import { Settings } from '../../src/pages/control/sections/Settings';
import { ctlViewOf, lockedFour, runRound, seedTimes, teamId } from '../support/state';
import type { LiveEvent } from '../../../server/src/core/model';
import type { Ack } from '../../src/lib/types';

/** The Events panel on Settings is folded away while an event is active. */
const openEvents = () => fireEvent.click(document.querySelector('details.events-panel > summary')!);

const me = (role: 'admin') => ({ role, label: 'race control' });
const console_ = (e: LiveEvent, send: (cmd: any) => Promise<Ack>, role: 'admin' = 'admin') =>
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
    rerender(<ConsolePage me={me('admin')} view={ctlViewOf(e)} send={async () => ({ ok: true })} serverNow={() => 0} status="open" />);
    expect((within(screen.getByRole('region', { name: 'Penalties to review' })).getByLabelText('Penalty') as HTMLSelectElement).value).toBe('early');
  });

  it('rejects a penalty', async () => {
    const send = vi.fn(async () => ({ ok: true }));
    console_(withPending(), send);
    fireEvent.click(within(screen.getByRole('region', { name: 'Penalties to review' })).getByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(send).toHaveBeenCalledWith({ type: 'decidePenalty', tapId: 'pen-1', decision: 'reject' }));
  });

  it('labels decided penalties from their stored reason', () => {
    const e = withPending();
    const decided = { ...e, penaltyReasons: [{ id: 'other', name: 'Other', kind: 'time' as const, amountMs: 1000 }],
      taps: e.taps.map((t) => (t.id === 'pen-1' ? { ...t, review: { status: 'approved' as const, reasonId: 'unsafe', reasonName: 'Unsafe conduct', dq: true } } : t)) };
    console_(decided, async () => ({ ok: true }));
    expect(screen.getByText('Approved · Unsafe conduct')).toBeTruthy();
    const row = screen.getByTestId(`team-${teamId(e, 'T2')}`);
    expect(row.querySelector('button[data-action="remove-penalty"]')!.textContent).toBe('−DQ');
  });

  it('labels the remove button "−Penalty" while the penalty is pending review, and with its time once approved', () => {
    const e = withPending();
    const pendingTap = { ...e, taps: e.taps.map((t) => (t.id === 'pen-1' ? { ...t, amountMs: 0 } : t)) };
    const { rerender } = console_(pendingTap, async () => ({ ok: true }));
    const removeLabel = () => screen.getByTestId(`team-${teamId(e, 'T2')}`).querySelector('button[data-action="remove-penalty"]')!.textContent;
    expect(removeLabel()).toBe('−Penalty');
    const approved = { ...e, taps: e.taps.map((t) => (t.id === 'pen-1'
      ? { ...t, amountMs: 10_000, review: { status: 'approved' as const, reasonId: 'early', reasonName: 'Started early' } } : t)) };
    rerender(<ConsolePage me={me('admin')} view={ctlViewOf(approved)} send={async () => ({ ok: true })} serverNow={() => 0} status="open" />);
    expect(removeLabel()).toBe('−10s');
  });

  it('falls back to a listed reason when the picked one is removed', async () => {
    const send = vi.fn(async () => ({ ok: true }));
    const e = runRound(lockedFour(), seedTimes);
    const { rerender } = console_(e, send);
    fireEvent.change(within(screen.getByTestId(`team-${teamId(e, 'T1')}`)).getByLabelText('Penalty reason'), { target: { value: 'early' } });
    const trimmed = { ...e, penaltyReasons: [{ id: 'sealed', name: 'Bag not sealed', kind: 'time' as const, amountMs: 5000 }] };
    rerender(<ConsolePage me={me('admin')} view={ctlViewOf(trimmed)} send={send} serverNow={() => 0} status="open" />);
    fireEvent.click(screen.getByTestId(`team-${teamId(e, 'T1')}`).querySelector('button[data-action="add-penalty"]')!);
    await waitFor(() => expect(send).toHaveBeenCalledWith({ type: 'addPenalty', round: 1, teamId: teamId(e, 'T1'), reasonId: 'sealed' }));
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

  it('can be hidden even when rounds are left (e.g. after reopening an ended event)', async () => {
    const send = vi.fn(async () => ({ ok: true }));
    console_({ ...runRound(lockedFour(), seedTimes), championShown: true }, send);
    expect(screen.queryByRole('button', { name: 'Show champion' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Hide champion' }));
    await waitFor(() => expect(send).toHaveBeenCalledWith({ type: 'hideChampion' }));
  });

  it('can hide it again', async () => {
    const send = vi.fn(async () => ({ ok: true }));
    console_({ ...allDone(), championShown: true }, send);
    fireEvent.click(screen.getByRole('button', { name: 'Hide champion' }));
    await waitFor(() => expect(send).toHaveBeenCalledWith({ type: 'hideChampion' }));
  });
});

describe('admin: deleting an event', () => {
  beforeEach(() => cleanup());
  afterEach(() => vi.unstubAllGlobals());
  const rows = [
    { id: 'ev1', name: 'Live', date: '2026-11-24', active: true, ended: false },
    { id: 'ev2', name: 'Old Test', date: '2026-10-01', active: false, ended: true },
  ];
  const settings = (send: (cmd: any) => Promise<Ack>) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(rows), { status: 200 })));
    render(<RunnerProvider send={send}><Settings view={null} /></RunnerProvider>);
  };
  const rowOf = async (name: string) => (await screen.findByText(name)).closest('tr')!;

  it('offers Delete on every event but the active one', async () => {
    settings(async () => ({ ok: true }));
    expect(within(await rowOf('Live')).queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(within(await rowOf('Old Test')).getByRole('button', { name: 'Delete' })).toBeTruthy();
  });

  it('asks for the exact name before deleting, with the exports at hand', async () => {
    const send = vi.fn(async () => ({ ok: true }));
    settings(send);
    fireEvent.click(within(await rowOf('Old Test')).getByRole('button', { name: 'Delete' }));
    const sheet = screen.getByRole('dialog', { name: 'Delete Old Test?' });
    expect(within(sheet).getByText(/permanently removes the event, its teams, results and log\. It cannot be undone\./)).toBeTruthy();
    expect(within(sheet).getByRole('link', { name: 'CSV' }).getAttribute('href')).toContain('event=ev2&format=csv');
    expect(within(sheet).getByRole('link', { name: 'JSON' }).getAttribute('href')).toContain('event=ev2&format=json');
    const button = within(sheet).getByRole('button', { name: 'Delete event' }) as HTMLButtonElement;
    const field = within(sheet).getByLabelText("Type the event's name to confirm");
    expect(button.disabled).toBe(true);
    fireEvent.input(field, { target: { value: 'old test' } });
    expect(button.disabled).toBe(true);
    fireEvent.input(field, { target: { value: ' Old Test ' } });
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(send).toHaveBeenCalledWith({ type: 'deleteEvent', eventId: 'ev2', confirmName: 'Old Test' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it("keeps the sheet open with the server's refusal", async () => {
    settings(async () => ({ ok: false, code: 'event_active', message: 'End this event or make another one active before deleting it.' }));
    fireEvent.click(within(await rowOf('Old Test')).getByRole('button', { name: 'Delete' }));
    const sheet = screen.getByRole('dialog', { name: 'Delete Old Test?' });
    fireEvent.input(within(sheet).getByLabelText("Type the event's name to confirm"), { target: { value: 'Old Test' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Delete event' }));
    expect(await within(sheet).findByText('End this event or make another one active before deleting it.')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Delete Old Test?' })).toBeTruthy();
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
    withRunner(<Settings view={ctlViewOf(runRound(lockedFour(), seedTimes))} />, send);
    openEvents();
    fireEvent.click(await screen.findByRole('button', { name: 'End event' }));
    const sheet = screen.getByRole('dialog', { name: /End Test\?/ });
    expect(within(sheet).getByText(/3 rounds not raced yet/)).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'End event' }));
    await waitFor(() => expect(send).toHaveBeenCalledWith({ type: 'endEvent', eventId: 'ev1' }));
  });

  it('warns about penalties still waiting for a decision', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([{ id: 'ev1', name: 'Test', date: '2026-11-24', active: true, ended: false }]), { status: 200 })));
    withRunner(<Settings view={ctlViewOf(withPending())} />, async () => ({ ok: true }));
    openEvents();
    fireEvent.click(await screen.findByRole('button', { name: 'End event' }));
    expect(within(screen.getByRole('dialog', { name: /End Test\?/ })).getByText(/1 penalty is still waiting for a decision/)).toBeTruthy();
  });

  it('marks ended events and asks before reopening one', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([{ id: 'ev1', name: 'Test', date: '2026-11-24', active: false, ended: true }]), { status: 200 })));
    const send = vi.fn(async () => ({ ok: true }));
    withRunner(<Settings view={null} />, send);
    expect(await screen.findByText('Ended')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Make active' }));
    const sheet = screen.getByRole('dialog', { name: /Reopen Test\?/ });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Reopen' }));
    await waitFor(() => expect(send).toHaveBeenCalledWith({ type: 'activateEvent', eventId: 'ev1' }));
  });
});
