import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/preact';
import { ConsolePage } from '../../src/pages/control/ConsolePage';
import { ctlViewOf, lockedFour, openNext, start } from '../support/state';
import type { ControlView } from '../../src/lib/types';

const me = { role: 'admin' as const, label: 'race control' };
type Open = ControlView['fairness']['open'][number];

const close: Open = {
  id: 'close_finish:1:dev1:t1,t2', kind: 'close_finish', round: 1, referee: 'Dana', refereeId: 'dev1', teamIds: ['t1', 't2'],
  message: 'T1 and T2 finished 0.30 s apart in round 1, both judged by Dana.',
};
const fast: Open = {
  id: 'fast_time:1:-:t3', kind: 'fast_time', round: 1, referee: null, refereeId: null, teamIds: ['t3'],
  message: "T3's time of 1:00.00 in round 1 is 40.0 s faster than the fastest time before it.",
};
const wins: Open = {
  id: 'referee_wins:dev2', kind: 'referee_wins', round: 4, referee: 'Lee', refereeId: 'dev2', teamIds: [],
  message: 'Teams judged by Lee finished better than their seeding in 5 of 6 races.',
};
const dismissal = { by: 'kim@example.com', at: Date.UTC(2026, 11, 1, 19, 5), note: 'Watched the video, the finish was clean.' };

function show(fairness: ControlView['fairness'], more: Partial<ControlView> = {}) {
  const send = vi.fn(async (_cmd: any) => ({ ok: true }));
  const view: ControlView = { ...ctlViewOf(start(openNext(lockedFour()))), fairness, ...more };
  render(<ConsolePage me={me} view={view} send={send} serverNow={() => 0} status="open" />);
  return { send, panel: () => screen.getByRole('region', { name: 'Fairness' }) };
}

describe('fairness panel', () => {
  beforeEach(() => cleanup());

  it('lists the open warnings with their message, round and referee, and says they are prompts', () => {
    const { panel } = show({ open: [close, fast], dismissed: [] });
    expect(within(panel()).getByRole('heading', { name: /^Fairness/ })).toBeTruthy();
    expect(within(panel()).getByLabelText('2 to look at').textContent).toBe('2');
    expect(within(panel()).getByText('These are prompts to take a look, not proof of anything.')).toBeTruthy();
    const card = within(panel()).getByText(close.message).closest('.card') as HTMLElement;
    expect(within(card).getByText('Close finish')).toBeTruthy();
    expect(within(card).getByText('Round 1 · Dana')).toBeTruthy();
    const other = within(panel()).getByText(fast.message).closest('.card') as HTMLElement;
    expect(within(other).getByText('Round 1')).toBeTruthy();
    expect(within(panel()).getAllByRole('button', { name: 'Dismiss' }).length).toBe(2);
  });

  it('does not give a round to a warning about the whole event', () => {
    const { panel } = show({ open: [wins], dismissed: [] });
    const card = within(panel()).getByText(wins.message).closest('.card') as HTMLElement;
    expect(within(card).getByText('Whole event · Lee')).toBeTruthy();
    expect(within(card).queryByText(/Round 4/)).toBeNull();
  });

  it('Dismiss asks for a note and sends it', async () => {
    const { send, panel } = show({ open: [close, fast], dismissed: [] });
    const card = within(panel()).getByText(close.message).closest('.card') as HTMLElement;
    expect(within(card).queryByLabelText('Note')).toBeNull();
    fireEvent.click(within(card).getByRole('button', { name: 'Dismiss' }));
    const note = within(card).getByLabelText('Note') as HTMLInputElement;
    expect(note.maxLength).toBe(200);
    const save = within(card).getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.input(note, { target: { value: '   ' } });
    expect(save.disabled).toBe(true);
    fireEvent.input(note, { target: { value: ' Watched the video. ' } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(send).toHaveBeenCalledWith({ type: 'dismissWarning', id: close.id, note: 'Watched the video.' }));
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('Cancel puts the note away without sending', () => {
    const { send, panel } = show({ open: [close], dismissed: [] });
    fireEvent.click(within(panel()).getByRole('button', { name: 'Dismiss' }));
    fireEvent.click(within(panel()).getByRole('button', { name: 'Cancel' }));
    expect(within(panel()).queryByLabelText('Note')).toBeNull();
    expect(within(panel()).getByRole('button', { name: 'Dismiss' })).toBeTruthy();
    expect(send).not.toHaveBeenCalled();
  });

  it('shows why a dismissal was refused', async () => {
    const send = vi.fn(async () => ({ ok: false, code: 'not_found', message: 'That warning no longer applies.' }));
    render(<ConsolePage me={me} view={{ ...ctlViewOf(start(openNext(lockedFour()))), fairness: { open: [close], dismissed: [] } }}
      send={send} serverNow={() => 0} status="open" />);
    const panel = screen.getByRole('region', { name: 'Fairness' });
    fireEvent.click(within(panel).getByRole('button', { name: 'Dismiss' }));
    fireEvent.input(within(panel).getByLabelText('Note'), { target: { value: 'ok' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Save' }));
    expect(await within(panel).findByText('That warning no longer applies.')).toBeTruthy();
  });

  it('keeps dismissed warnings in a folded list with the note and who dismissed them', () => {
    const { panel } = show({ open: [fast], dismissed: [{ ...close, dismissal }] });
    const details = panel().querySelector('details') as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(details.querySelector('summary')!.textContent).toBe('Dismissed (1)');
    expect(details.textContent).toContain(close.message);
    expect(details.textContent).toContain('Watched the video, the finish was clean.');
    expect(details.textContent).toContain('kim@example.com');
    expect(within(details).queryByRole('button')).toBeNull();
    expect(within(panel()).getByLabelText('1 to look at')).toBeTruthy();
  });

  it('says there is nothing to look at when every warning is dismissed', () => {
    const { panel } = show({ open: [], dismissed: [{ ...close, dismissal }] });
    expect(within(panel()).getByText('Nothing to look at.')).toBeTruthy();
    expect(within(panel()).queryByLabelText(/to look at$/)).toBeNull();
    expect(panel().querySelector('details')).toBeTruthy();
  });

  it('shows the empty panel when referees rotate, and no panel at all when they do not and nothing is flagged', () => {
    const base = ctlViewOf(start(openNext(lockedFour())));
    show({ open: [], dismissed: [] }, { settings: { ...base.settings, rotateReferees: true } });
    expect(within(screen.getByRole('region', { name: 'Fairness' })).getByText('Nothing to look at.')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Fairness' }).querySelector('details')).toBeNull();
    cleanup();
    show({ open: [], dismissed: [] });
    expect(screen.queryByRole('region', { name: 'Fairness' })).toBeNull();
    cleanup();
    const { rotateReferees: _, ...stored } = base.settings; // an event stored before rotation
    show({ open: [], dismissed: [] }, { settings: stored });
    expect(screen.queryByRole('region', { name: 'Fairness' })).toBeNull();
  });

  it('offers no Dismiss once the event has ended', () => {
    const { panel } = show({ open: [close], dismissed: [] }, { ended: true });
    expect(within(panel()).getByText(close.message)).toBeTruthy();
    expect(within(panel()).queryByRole('button', { name: 'Dismiss' })).toBeNull();
  });

  it('comes after Penalties to review and before Results', () => {
    const { panel } = show({ open: [close], dismissed: [] });
    const results = screen.getByRole('region', { name: 'Results' });
    expect(panel().compareDocumentPosition(results) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const stations = screen.getByRole('region', { name: 'Stations' });
    expect(stations.compareDocumentPosition(panel()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('fairness count beside Race Control', () => {
  beforeEach(() => cleanup());
  const nav = () => screen.getByRole('navigation', { name: 'Sections' });

  it('shows how many warnings are open', () => {
    show({ open: [close, fast], dismissed: [] });
    const link = within(nav()).getByRole('link', { name: /^Race Control/ });
    expect(within(link).getByLabelText('2 fairness warnings').textContent).toBe('2');
  });

  it('says "1 fairness warning" for one', () => {
    show({ open: [close], dismissed: [{ ...fast, dismissal }] });
    expect(within(nav()).getByLabelText('1 fairness warning').textContent).toBe('1');
  });

  it('is hidden when none is open', () => {
    show({ open: [], dismissed: [{ ...close, dismissal }] });
    expect(within(nav()).getByRole('link', { name: 'Race Control' }).textContent).toBe('Race Control');
  });

  it('is there from another section too', () => {
    location.hash = '#teams';
    try {
      show({ open: [close], dismissed: [] });
      expect(screen.queryByRole('region', { name: 'Fairness' })).toBeNull();
      expect(within(nav()).getByLabelText('1 fairness warning')).toBeTruthy();
    } finally { location.hash = ''; }
  });
});
