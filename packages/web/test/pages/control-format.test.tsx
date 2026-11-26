import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/preact';
import { RunnerProvider } from '../../src/pages/control/runner';
import { Setup } from '../../src/pages/control/sections/Setup';
import { TournamentFormat } from '../../src/pages/control/sections/TournamentFormat';
import { BRACKET_FORMAT, PRESETS, SEEDING_RANK, SEEDING_RUNS_HELP } from '../../src/lib/formatCopy';
import { handleSetup } from '../../../server/src/core/setup';
import { admin, ctx, ok } from '../../../server/test/core/helpers';
import type { LiveEvent } from '../../../server/src/core/model';
import type { TournamentFormat as Format } from '@race2feed/engine';
import { ctlViewOf, lockedFour, previousEvent } from '../support/state';
import type { Ack } from '../../src/lib/types';

const unlocked = (e: LiveEvent = lockedFour()): LiveEvent => ({ ...e, setupLocked: false });
const withFormat = (format: Format, e: LiveEvent = unlocked()) => ok(handleSetup(e, { type: 'setFormat', format }, ctx(admin)));

function show(e: LiveEvent, send: (cmd: any) => Promise<Ack> = async () => ({ ok: true })) {
  const spy = vi.fn(send);
  const utils = render(<RunnerProvider send={spy}><TournamentFormat view={ctlViewOf(e)} /></RunnerProvider>);
  return { send: spy, ...utils };
}
const panel = () => screen.getByRole('region', { name: 'Tournament format' });
const group = (name: string) => within(panel()).getByRole('radiogroup', { name });
const option = (groupName: string, name: string) => within(group(groupName)).getByRole('radio', { name }) as HTMLButtonElement;
const checked = (groupName: string) => within(group(groupName)).getAllByRole('radio').filter((r) => r.getAttribute('aria-checked') === 'true').map((r) => r.getAttribute('aria-labelledby'))
  .map((id) => document.getElementById(id!)!.textContent);

describe('tournament format panel', () => {
  beforeEach(() => cleanup());

  it('sits in Setup above the Referees choice', () => {
    render(<RunnerProvider send={async () => ({ ok: true })}><Setup view={ctlViewOf(unlocked())} /></RunnerProvider>);
    const format = screen.getByRole('heading', { name: 'Tournament format' });
    const referees = screen.getByRole('heading', { name: 'Referees' });
    expect(format.compareDocumentPosition(referees) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('explains the panel and every option, all visible at once', () => {
    show(unlocked());
    expect(within(panel()).getByText('Choose how the event runs. You can change this until setup is locked.')).toBeTruthy();
    for (const p of PRESETS) {
      const card = option('Preset', p.name);
      expect(card.textContent).toContain(p.blurb);
      expect(document.getElementById(card.getAttribute('aria-describedby')!.split(' ')[0]!)!.textContent).toBe(p.blurb);
    }
    for (const n of [1, 2, 3] as const) {
      expect(option('Seeding rounds', n === 1 ? '1 round' : `${n} rounds`).textContent).toContain(SEEDING_RUNS_HELP[n]);
    }
    for (const rule of Object.values(SEEDING_RANK)) expect(option('Seeding rank', rule.label).textContent).toContain(rule.help);
    for (const b of Object.values(BRACKET_FORMAT)) expect(option('Bracket format', b.label).textContent).toContain(b.help);
    // Help is plain text on the page, never a tooltip.
    expect(panel().querySelector('[title]')).toBeNull();
  });

  it('shows the stored format: Standard for an event that never set one', () => {
    show(unlocked());
    expect(checked('Preset')).toEqual(['Standard']);
    expect(checked('Seeding rounds')).toEqual(['2 rounds']);
    expect(checked('Seeding rank')).toEqual(['Total time']);
    expect(checked('Bracket format')).toEqual(['Heats, then placement']);
    expect(within(panel()).queryByText('Custom')).toBeNull();
  });

  it('a preset sends all three settings in one command', async () => {
    const { send } = show(unlocked());
    fireEvent.click(option('Preset', 'Short'));
    await waitFor(() => expect(send).toHaveBeenCalledWith({ type: 'setFormat', format: { seedingRuns: 1, seedingRank: 'total', brackets: 'finals' } }));
    expect(send).toHaveBeenCalledTimes(1);
    expect(checked('Preset')).toEqual(['Short']);
    cleanup();
    const again = show(withFormat({ seedingRuns: 3, seedingRank: 'dropSlowest', brackets: 'finals' }));
    fireEvent.click(option('Preset', 'Seeding only'));
    await waitFor(() => expect(again.send).toHaveBeenCalledWith({ type: 'setFormat', format: { seedingRuns: 2, seedingRank: 'total', brackets: 'none' } }));
    cleanup();
    const standard = show(withFormat({ brackets: 'none' }));
    fireEvent.click(option('Preset', 'Standard'));
    await waitFor(() => expect(standard.send).toHaveBeenCalledWith({ type: 'setFormat', format: { seedingRuns: 2, seedingRank: 'total', brackets: 'placement' } }));
  });

  it('a setting sends only itself, and the preset then reads Custom', async () => {
    const { send } = show(unlocked());
    fireEvent.click(option('Seeding rounds', '3 rounds'));
    await waitFor(() => expect(send).toHaveBeenCalledWith({ type: 'setFormat', format: { seedingRuns: 3 } }));
    expect(checked('Seeding rounds')).toEqual(['3 rounds']);
    expect(checked('Preset')).toEqual([]);
    expect(within(panel()).getByText('Custom')).toBeTruthy();
    cleanup();
    const rank = show(unlocked());
    fireEvent.click(option('Seeding rank', 'Best run'));
    await waitFor(() => expect(rank.send).toHaveBeenCalledWith({ type: 'setFormat', format: { seedingRank: 'best' } }));
    cleanup();
    const brackets = show(unlocked());
    fireEvent.click(option('Bracket format', 'Finals only'));
    await waitFor(() => expect(brackets.send).toHaveBeenCalledWith({ type: 'setFormat', format: { brackets: 'finals' } }));
    expect(brackets.send).toHaveBeenCalledTimes(1);
  });

  it('choosing what is already chosen sends nothing', () => {
    const { send } = show(unlocked());
    fireEvent.click(option('Preset', 'Standard'));
    fireEvent.click(option('Seeding rounds', '2 rounds'));
    fireEvent.click(option('Seeding rank', 'Total time'));
    fireEvent.click(option('Bracket format', 'Heats, then placement'));
    expect(send).not.toHaveBeenCalled();
  });

  it('shows a stored custom format as Custom', () => {
    show(withFormat({ seedingRuns: 3, seedingRank: 'dropSlowest', brackets: 'finals' }));
    expect(checked('Preset')).toEqual([]);
    expect(within(panel()).getByText('Custom')).toBeTruthy();
    expect(checked('Seeding rounds')).toEqual(['3 rounds']);
    expect(checked('Seeding rank')).toEqual(['Drop the slowest']);
    expect(checked('Bracket format')).toEqual(['Finals only']);
  });

  it('a rank rule that needs more seeding rounds is disabled and says why', () => {
    show(withFormat({ seedingRuns: 1 }));
    expect(option('Seeding rank', 'Total time').disabled).toBe(false);
    expect(option('Seeding rank', 'Best run').disabled).toBe(true);
    expect(within(option('Seeding rank', 'Best run')).getByText('Needs at least two seeding rounds.')).toBeTruthy();
    expect(option('Seeding rank', 'Drop the slowest').disabled).toBe(true);
    expect(within(option('Seeding rank', 'Drop the slowest')).getAllByText(/Needs three seeding rounds\./).length).toBe(1);
    cleanup();
    show(unlocked());
    expect(option('Seeding rank', 'Best run').disabled).toBe(false);
    expect(within(panel()).queryByText('Needs at least two seeding rounds.')).toBeNull();
    expect(option('Seeding rank', 'Drop the slowest').disabled).toBe(true);
    cleanup();
    show(withFormat({ seedingRuns: 3 }));
    expect(option('Seeding rank', 'Drop the slowest').disabled).toBe(false);
  });

  it('fewer seeding rounds than the rank rule needs switches the rule to Total time, in the same command, and says so', async () => {
    const { send } = show(withFormat({ seedingRuns: 3, seedingRank: 'dropSlowest' }));
    expect(within(panel()).queryByText('Seeding rank changed to Total time.')).toBeNull();
    fireEvent.click(option('Seeding rounds', '2 rounds'));
    await waitFor(() => expect(send).toHaveBeenCalledWith({ type: 'setFormat', format: { seedingRuns: 2, seedingRank: 'total' } }));
    expect(send).toHaveBeenCalledTimes(1);
    expect(within(panel()).getByRole('status').textContent).toBe('Seeding rank changed to Total time.');
    expect(checked('Seeding rank')).toEqual(['Total time']);
    cleanup();
    const best = show(withFormat({ seedingRuns: 2, seedingRank: 'best' }));
    fireEvent.click(option('Seeding rounds', '1 round'));
    await waitFor(() => expect(best.send).toHaveBeenCalledWith({ type: 'setFormat', format: { seedingRuns: 1, seedingRank: 'total' } }));
    expect(within(panel()).getByText('Seeding rank changed to Total time.')).toBeTruthy();
    cleanup();
    // Best run still works with 2 rounds: nothing else is sent, and nothing is announced.
    const kept = show(withFormat({ seedingRuns: 3, seedingRank: 'best' }));
    fireEvent.click(option('Seeding rounds', '2 rounds'));
    await waitFor(() => expect(kept.send).toHaveBeenCalledWith({ type: 'setFormat', format: { seedingRuns: 2 } }));
    expect(within(panel()).queryByText('Seeding rank changed to Total time.')).toBeNull();
  });

  it('the commands it sends are accepted by the server', () => {
    // The auto-switch: the server refuses the round count alone, and takes it with the rule.
    const e = withFormat({ seedingRuns: 3, seedingRank: 'dropSlowest' });
    expect(handleSetup(e, { type: 'setFormat', format: { seedingRuns: 2 } }, ctx(admin)).ok).toBe(false);
    expect(handleSetup(e, { type: 'setFormat', format: { seedingRuns: 2, seedingRank: 'total' } }, ctx(admin)).ok).toBe(true);
    for (const p of PRESETS) expect(handleSetup(e, { type: 'setFormat', format: p.format }, ctx(admin)).ok).toBe(true);
  });

  it('Knockout can be chosen, as a preset and as a bracket format', async () => {
    const { send } = show(unlocked());
    for (const knockout of [option('Preset', 'Knockout'), option('Bracket format', 'Knockout')]) {
      expect(knockout.disabled).toBe(false);
      expect(within(knockout).queryByText('Coming soon')).toBeNull();
    }
    fireEvent.click(option('Bracket format', 'Knockout'));
    await waitFor(() => expect(send).toHaveBeenCalledWith({ type: 'setFormat', format: { brackets: 'knockout' } }));
    expect(checked('Preset')).toEqual(['Knockout']);
  });

  it('a refused change goes back to the stored format and shows the reason', async () => {
    show(unlocked(), async () => ({ ok: false, code: 'invalid', message: 'The format has problems.' }));
    fireEvent.click(option('Bracket format', 'Finals only'));
    expect(await within(panel()).findByText('The format has problems.')).toBeTruthy();
    expect(checked('Bracket format')).toEqual(['Heats, then placement']);
    expect(checked('Preset')).toEqual(['Standard']);
  });

  it('follows the server when the stored format changes', () => {
    const { rerender } = show(unlocked());
    rerender(<RunnerProvider send={async () => ({ ok: true })}><TournamentFormat view={ctlViewOf(withFormat({ seedingRuns: 1, brackets: 'finals' }))} /></RunnerProvider>);
    expect(checked('Preset')).toEqual(['Short']);
    expect(checked('Seeding rounds')).toEqual(['1 round']);
  });

  it('locked: every choice is disabled, with the reason', () => {
    const { send } = show(lockedFour());
    expect(within(panel()).getByText('Setup is locked. Unlock it to change the format.')).toBeTruthy();
    const radios = within(panel()).getAllByRole('radio') as HTMLButtonElement[];
    expect(radios.length).toBe(14);
    expect(radios.every((r) => r.disabled)).toBe(true);
    radios.forEach((r) => fireEvent.click(r));
    expect(send).not.toHaveBeenCalled();
    expect(checked('Preset')).toEqual(['Standard']);
    cleanup();
    show(unlocked());
    expect(within(panel()).queryByText('Setup is locked. Unlock it to change the format.')).toBeNull();
  });

  it('summarises what the setup makes, and follows a change straight away', async () => {
    show(unlocked(previousEvent()));
    const summary = within(panel()).getByTestId('format-summary');
    expect(summary.getAttribute('aria-live')).toBe('polite');
    expect(summary.textContent).toBe('9 rounds, 150 races');
    fireEvent.click(option('Preset', 'Short'));
    await waitFor(() => expect(summary.textContent).toBe('5 rounds, 63 races'));
    fireEvent.click(option('Bracket format', 'No brackets'));
    cleanup();
    show(withFormat({ brackets: 'none' }, unlocked(previousEvent())));
    expect(within(panel()).getByTestId('format-summary').textContent).toBe('5 rounds, 101 races');
  });

  it('says to rebuild brackets that were set up for a different format', () => {
    const NOTICE = 'Your brackets were set up for a different format. Press Suggest groups and brackets to rebuild them.';
    show(unlocked());
    expect(within(panel()).queryByText(NOTICE)).toBeNull();
    cleanup();
    // Seeding only cleared the brackets; finals only needs them again.
    const changed = withFormat({ brackets: 'finals' }, withFormat({ brackets: 'none' }));
    show(changed);
    expect(within(panel()).getByText(NOTICE)).toBeTruthy();
    cleanup();
    show(ok(handleSetup(changed, { type: 'suggestSetup' }, ctx(admin))));
    expect(within(panel()).queryByText(NOTICE)).toBeNull();
  });
});

describe('setup in seeding only', () => {
  beforeEach(() => cleanup());
  it('has no bracket editor, and says why', () => {
    render(<RunnerProvider send={async () => ({ ok: true })}><Setup view={ctlViewOf(withFormat({ brackets: 'none' }))} /></RunnerProvider>);
    const brackets = screen.getByRole('region', { name: 'Brackets' });
    expect(within(brackets).getByText('Seeding only uses no brackets.')).toBeTruthy();
    expect(within(brackets).queryByRole('button', { name: /Save/ })).toBeNull();
    cleanup();
    render(<RunnerProvider send={async () => ({ ok: true })}><Setup view={ctlViewOf(unlocked())} /></RunnerProvider>);
    expect(within(screen.getByRole('region', { name: 'Brackets' })).getByRole('button', { name: 'Save T brackets' })).toBeTruthy();
  });
});
