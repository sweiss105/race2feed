import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/preact';
import { ConsolePage } from '../../src/pages/control/ConsolePage';
import { ctlViewOf, lockedFour, openNext, start, teamId } from '../support/state';
import type { LiveEvent, Tap } from '../../../server/src/core/model';
import type { Ack } from '../../src/lib/types';

const console_ = (e: LiveEvent, send: (cmd: any) => Promise<Ack> = async () => ({ ok: true })) =>
  render(<ConsolePage me={{ role: 'admin', label: 'race control' }} view={ctlViewOf(e)} send={send} serverNow={() => 0} status="open" />);

/** Round 1 running, with T1's finish (3:20.45) received 45 s after the tap and `hold` as given. */
function withHeld(hold: NonNullable<Tap['hold']> = { status: 'pending' }, removedAt: number | null = null): LiveEvent {
  const e = start(openNext(lockedFour()));
  const tap: Tap = {
    id: 'held-1', clientTapId: 'c1', kind: 'finish', round: 1, teamId: teamId(e, 'T1'), elapsedMs: 200_450, lateMs: 45_300,
    source: 'referee', deviceId: 'dev1', createdAt: 5, removedAt, hold,
  };
  return { ...e, taps: [...e.taps, tap] };
}

const panel = () => screen.getByRole('region', { name: 'Late finishes to confirm' });

describe('late finishes to confirm', () => {
  beforeEach(() => cleanup());

  it('is not shown when no finish arrived late', () => {
    console_(start(openNext(lockedFour())));
    expect(screen.queryByRole('region', { name: 'Late finishes to confirm' })).toBeNull();
  });

  it('shows the team, its time and how late it arrived, and the team is still waited on', () => {
    console_(withHeld());
    expect(panel().querySelector('[data-held] .headline')!.textContent).toBe('T1');
    expect(panel().textContent).toContain('3:20.45');
    expect(panel().textContent).toContain('received 45 s after the tap');
    expect(within(panel()).getByLabelText('1 waiting')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Outstanding' }).textContent).toContain('T1');
  });

  it('confirms and rejects with decideLateFinish', async () => {
    const send = vi.fn(async () => ({ ok: true }));
    console_(withHeld(), send);
    fireEvent.click(within(panel()).getByRole('button', { name: "Confirm T1's late finish" }));
    await waitFor(() => expect(send).toHaveBeenCalledWith({ type: 'decideLateFinish', tapId: 'held-1', decision: 'confirm' }));
    fireEvent.click(within(panel()).getByRole('button', { name: "Reject T1's late finish" }));
    await waitFor(() => expect(send).toHaveBeenCalledWith({ type: 'decideLateFinish', tapId: 'held-1', decision: 'reject' }));
  });

  it('shows a refusal on the card', async () => {
    console_(withHeld(), async () => ({ ok: false, code: 'already_finished', message: 'That team already has a result.' }));
    fireEvent.click(within(panel()).getByRole('button', { name: "Confirm T1's late finish" }));
    expect(await within(panel()).findByText('That team already has a result.')).toBeTruthy();
  });

  it('lists decided ones with who decided, and leaves out one its referee undid', () => {
    console_(withHeld({ status: 'confirmed', decidedAt: 9, by: 'kim@example.com' }));
    expect(within(panel()).getByText('All late finishes decided.')).toBeTruthy();
    expect(panel().textContent).toContain('Confirmed · kim@example.com');
    expect(within(panel()).queryByRole('button', { name: /Confirm/ })).toBeNull();
    cleanup();
    console_(withHeld({ status: 'rejected', decidedAt: 9, by: 'kim@example.com' }, 9));
    expect(panel().textContent).toContain('Rejected · kim@example.com');
    cleanup();
    console_(withHeld({ status: 'pending' }, 9));
    expect(screen.queryByRole('region', { name: 'Late finishes to confirm' })).toBeNull();
  });
});
