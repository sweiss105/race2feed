import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/preact';
import { RunnerProvider } from '../../src/pages/control/runner';
import { Tables } from '../../src/pages/control/sections/Setup';
import type { LiveEvent } from '../../../server/src/core/model';
import { ctlViewOf, lockedFour } from '../support/state';
import type { Ack } from '../../src/lib/types';

const unlocked = (): LiveEvent => ({ ...lockedFour(), setupLocked: false });

function show(e: LiveEvent, send: (cmd: any) => Promise<Ack> = async () => ({ ok: true })) {
  const spy = vi.fn(send);
  const utils = render(<RunnerProvider send={spy}><Tables view={ctlViewOf(e)} /></RunnerProvider>);
  return { send: spy, ...utils };
}
const field = () => screen.getByLabelText('Number of tables') as HTMLInputElement;
const save = () => screen.getByRole('button', { name: 'Save tables' }) as HTMLButtonElement;

describe('number of tables in Setup', () => {
  beforeEach(() => cleanup());

  it('shows the current number and says what it means', () => {
    show(unlocked());
    expect(field().value).toBe('4');
    expect(save().disabled).toBe(true);
    expect(screen.getByText(/how many teams can race at once: fewer tables means more rounds, not fewer teams/)).toBeTruthy();
    expect(screen.getByText(/Changing it clears the seeding groups, table assignments and brackets/)).toBeTruthy();
  });

  it('sends the new number', async () => {
    const { send } = show(unlocked());
    fireEvent.input(field(), { target: { value: '8' } });
    fireEvent.click(save());
    await waitFor(() => expect(send).toHaveBeenCalledWith({ type: 'setTableCount', tableCount: 8 }));
  });

  it('refuses anything that is not a whole number from 1 to 99', () => {
    const { send } = show(unlocked());
    for (const value of ['0', '2.5', '100', '-3']) {
      fireEvent.input(field(), { target: { value } });
      expect(save().disabled).toBe(true);
      expect(screen.getByText('Enter a whole number from 1 to 99.')).toBeTruthy();
    }
    expect(send).not.toHaveBeenCalled();
  });

  it('points to Suggest after a change has cleared the groups and brackets', async () => {
    const before = unlocked();
    const { rerender } = show(before);
    fireEvent.input(field(), { target: { value: '8' } });
    fireEvent.click(save());
    const cleared: LiveEvent = { ...before, setup: { ...before.setup, tableCount: 8, groups: [], tableOf: {}, brackets: [] } };
    await waitFor(() => expect(save().disabled).toBe(false));
    rerender(<RunnerProvider send={async () => ({ ok: true })}><Tables view={ctlViewOf(cleared)} /></RunnerProvider>);
    expect((await screen.findByRole('status')).textContent).toContain('Tables changed to 8. Press Suggest groups and brackets');
    expect(field().value).toBe('8');
  });

  it('is disabled once setup is locked', () => {
    show(lockedFour());
    expect(field().disabled).toBe(true);
    expect(save().disabled).toBe(true);
    expect(screen.getByText(/Unlock setup to change this\./)).toBeTruthy();
  });

  it('shows a refusal from the server', async () => {
    show(unlocked(), async () => ({ ok: false, code: 'setup_locked', message: 'Setup is locked; unlock it before changing teams, groups or brackets.' }));
    fireEvent.input(field(), { target: { value: '6' } });
    fireEvent.click(save());
    expect(await screen.findByText(/Setup is locked; unlock it/)).toBeTruthy();
  });
});
