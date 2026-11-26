import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/preact';
import { Login } from '../../src/pages/control/Login';
import { ConsolePage, sectionsFor } from '../../src/pages/control/ConsolePage';
import { ctlViewOf, heatsOpen, lockedFour, openNext, runRound, seedTimes, start, teamId } from '../support/state';
import type { Ack, ControlView } from '../../src/lib/types';

const me = (role: 'admin') => ({ role, label: 'race control' });

describe('console sign-in', () => {
  beforeEach(() => cleanup());

  it('signs in with the password alone', async () => {
    const login = vi.fn(async () => ({ ok: true as const }));
    const onSignedIn = vi.fn();
    render(<Login login={login} onSignedIn={onSignedIn} />);
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.queryByRole('radiogroup')).toBeNull();
    fireEvent.input(screen.getByLabelText('Password'), { target: { value: 'pw-123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(login).toHaveBeenCalledWith('pw-123456'));
    expect(onSignedIn).toHaveBeenCalled();
  });

  it('says so when the password is wrong', async () => {
    render(<Login login={async () => ({ ok: false as const, status: 401 })} onSignedIn={vi.fn()} />);
    fireEvent.input(screen.getByLabelText('Password'), { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Wrong password')).toBeTruthy();
  });
});

describe('console sections', () => {
  beforeEach(() => cleanup());
  it('sectionsFor gives every signed-in user all six sections', () => {
    expect(sectionsFor('admin')).toEqual(['race', 'teams', 'setup', 'devices', 'settings', 'log']);
  });
  it('a signed-in user sees every section', () => {
    render(<ConsolePage me={me('admin')} view={ctlViewOf(lockedFour())} send={async () => ({ ok: true })} serverNow={() => 0} status="open" />);
    for (const s of ['Race Control', 'Teams', 'Setup', 'Referees', 'Settings', 'Log']) expect(screen.getByRole('link', { name: s })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Events' })).toBeNull();
  });
});

describe('race section', () => {
  beforeEach(() => cleanup());

  const header = () => document.querySelector('header.race-head') as HTMLElement;
  const readyView = () => {
    const e = openNext(lockedFour());
    return ctlViewOf({ ...e, stations: { 1: { ready: true, excluded: false }, 2: { ready: true, excluded: false } } });
  };

  it('offers no round to open once every round has been raced', () => {
    let e = lockedFour();
    for (let i = 0; i < 4; i++) e = runRound(e, seedTimes);
    render(<ConsolePage me={me('admin')} view={ctlViewOf(e)} send={async () => ({ ok: true })} serverNow={() => 0} status="open" />);
    expect(within(header()).getAllByRole('button').map((b) => b.textContent)).toEqual(['Show champion']);
    expect(screen.queryByRole('button', { name: /^Open round/ })).toBeNull();
    expect(within(header()).getByRole('status').textContent).toBe('Event complete');
  });

  it('shows one action button in the header, pulsing Start once every referee is ready', async () => {
    const send = vi.fn(async () => ({ ok: true }));
    render(<ConsolePage me={me('admin')} view={readyView()} send={send} serverNow={() => 0} status="open" />);
    const buttons = within(header()).getAllByRole('button');
    expect(buttons).toHaveLength(1);
    const startBtn = within(header()).getByRole('button', { name: 'Start' }) as HTMLButtonElement;
    expect(startBtn.disabled).toBe(false);
    expect(startBtn.classList.contains('pulse')).toBe(true);
    expect(within(header()).getByRole('status').textContent).toBe('All referees ready');
    fireEvent.click(startBtn);
    await waitFor(() => expect(send).toHaveBeenCalledWith({ type: 'startRace' }));
  });

  it('shows a station with one of its two tables ready as partial progress, still not ready', () => {
    const e = openNext(lockedFour());
    const half = { ...e, stations: { 1: { ready: false, excluded: false, readyTables: [2] }, 2: { ready: true, excluded: false, readyTables: [3, 4] } } };
    render(<ConsolePage me={me('admin')} view={ctlViewOf(half)} send={async () => ({ ok: true })} serverNow={() => 0} status="open" />);
    const card = screen.getByText('Tables 1 & 2').closest('.station') as HTMLElement;
    expect(within(card).getByText('1 of 2 tables ready')).toBeTruthy();
    expect(within(card).getByRole('button', { name: 'Ready' })).toBeTruthy();
    expect(within(screen.getByText('Tables 3 & 4').closest('.station') as HTMLElement).getByText('Ready')).toBeTruthy();
    expect(within(header()).getByRole('status').textContent).toBe('Waiting on 1 referee to be ready');
  });

  it('disables Start and says what it waits for while a referee is not ready', () => {
    const e = openNext(lockedFour());
    const oneLeft = { ...e, stations: { 1: { ready: true, excluded: false }, 2: { ready: false, excluded: false } } };
    render(<ConsolePage me={me('admin')} view={ctlViewOf(oneLeft)} send={async () => ({ ok: true })} serverNow={() => 0} status="open" />);
    const startBtn = within(header()).getByRole('button', { name: 'Start' }) as HTMLButtonElement;
    expect(startBtn.disabled).toBe(true);
    expect(startBtn.classList.contains('pulse')).toBe(false);
    expect(within(header()).getByRole('status').textContent).toBe('Waiting on 1 referee to be ready');
  });

  describe('a Finish now that lands just after auto-finish', () => {
    const allInView = () => {
      const v = ctlViewOf(start(openNext(lockedFour()), 1_000_000));
      return { ...v, outstanding: [], round: { ...v.round, autoFinishAt: null } };
    };
    const finishedView = (v: ReturnType<typeof allInView>) => ({ ...v, round: { ...v.round, phase: 'finished' as const, autoFinishAt: null } });
    const refused: Ack = { ok: false, code: 'round_not_running', message: 'No race is running.' };
    const page = (view: ReturnType<typeof allInView>, send: () => Promise<Ack>) =>
      <ConsolePage me={me('admin')} view={view} send={send} serverNow={() => 1_000_000} status="open" />;

    it('clears the refusal once the round moves on', async () => {
      const v = allInView();
      const { rerender } = render(page(v, async () => refused));
      fireEvent.click(within(header()).getByRole('button', { name: 'Finish now' }));
      expect(await screen.findByText('No race is running.')).toBeTruthy();
      rerender(page(finishedView(v), async () => refused));
      await waitFor(() => expect(screen.queryByText('No race is running.')).toBeNull());
    });

    it('never shows a refusal that arrives after the round moved on', async () => {
      const v = allInView();
      let answer!: (a: Ack) => void;
      const send = () => new Promise<Ack>((resolve) => { answer = resolve; });
      const { rerender } = render(page(v, send));
      fireEvent.click(within(header()).getByRole('button', { name: 'Finish now' }));
      rerender(page(finishedView(v), send));
      await new Promise((r) => setTimeout(r, 50));
      answer(refused);
      await new Promise((r) => setTimeout(r, 50));
      expect(screen.queryByText('No race is running.')).toBeNull();
    });
  });

  it('counts down to the automatic finish once every team is in', () => {
    const e = start(openNext(lockedFour()), 1_000_000);
    const v = ctlViewOf(e);
    const allIn = { ...v, outstanding: [], round: { ...v.round, autoFinishAt: 1_030_000 } };
    render(<ConsolePage me={me('admin')} view={allIn} send={async () => ({ ok: true })} serverNow={() => 1_007_200} status="open" />);
    expect(within(header()).getByRole('status').textContent).toBe('All teams in — finishing in 23 s');
    expect((within(header()).getByRole('button', { name: 'Finish now' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('opens the next round from the one button', async () => {
    const send = vi.fn(async () => ({ ok: true }));
    render(<ConsolePage me={me('admin')} view={ctlViewOf(runRound(lockedFour(), seedTimes))} send={send} serverNow={() => 0} status="open" />);
    expect(within(header()).getByRole('status').textContent).toBe('Ready to open round 2');
    fireEvent.click(within(header()).getByRole('button', { name: 'Open round 2' }));
    await waitFor(() => expect(send).toHaveBeenCalledWith({ type: 'openNextRound' }));
  });

  it('shows a refused command under the header', async () => {
    const send = vi.fn(async () => ({ ok: false, code: 'stations_not_ready', message: '1 station(s) not ready.' }));
    render(<ConsolePage me={me('admin')} view={readyView()} send={send} serverNow={() => 0} status="open" />);
    fireEvent.click(within(header()).getByRole('button', { name: 'Start' }));
    expect((await screen.findByRole('alert')).textContent).toBe('1 station(s) not ready.');
  });

  it('sends one START however many times it is clicked', async () => {
    let resolve!: (a: Ack) => void;
    const send = vi.fn(() => new Promise<Ack>((r) => { resolve = r; }));
    const e = openNext(lockedFour());
    const ready = { ...e, stations: { 1: { ready: true, excluded: false }, 2: { ready: true, excluded: false } } };
    render(<ConsolePage me={me('admin')} view={ctlViewOf(ready)} send={send} serverNow={() => 0} status="open" />);
    const startBtn = screen.getByRole('button', { name: 'Start' });
    fireEvent.click(startBtn);
    fireEvent.click(startBtn);
    fireEvent.click(startBtn);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ type: 'startRace' });
    resolve({ ok: true });
  });

  it('lets race control stop a team\'s clock from the waiting list while the race is running', async () => {
    const send = vi.fn(async () => ({ ok: true }));
    const e = start(openNext(lockedFour()), 1_000_000);
    render(<ConsolePage me={me('admin')} view={ctlViewOf(e)} send={send} serverNow={() => 1_083_456.7} status="open" />);
    const list = screen.getByRole('region', { name: 'Outstanding' });
    const row = list.querySelector(`tr[data-team="${teamId(e, 'T1')}"]`)!;
    const finish = within(row as HTMLElement).getByRole('button', { name: 'Finish T1' });
    fireEvent.click(finish);
    await waitFor(() => expect(send).toHaveBeenCalledWith({ type: 'setResult', round: 1, teamId: teamId(e, 'T1'), set: { kind: 'time', rawMs: 83_457 } }));
  });

  it('offers no Finish in the waiting list before the race has started', () => {
    render(<ConsolePage me={me('admin')} view={ctlViewOf(openNext(lockedFour()))} send={async () => ({ ok: true })} serverNow={() => 0} status="open" />);
    const list = screen.getByRole('region', { name: 'Outstanding' });
    expect(within(list).queryByRole('button', { name: /^Finish / })).toBeNull();
    expect(list.querySelector('button[data-action="dns"]')).not.toBeNull();
  });

  const askToUnlock = async (keptRounds: number[], bracketsKept = false) => {
    const sent: any[] = [];
    const send = vi.fn(async (cmd: any) => {
      sent.push(cmd);
      return cmd.confirmUnlock ? { ok: true } : { ok: false, code: 'unlock_required', message: 'confirm', detail: { laterRounds: [2, 3], keptRounds, bracketsKept } };
    });
    const e = heatsOpen();
    render(<ConsolePage me={me('admin')} view={ctlViewOf(e)} send={send} serverNow={() => 0} status="open" />);
    fireEvent.change(screen.getByLabelText('Round'), { target: { value: '1' } });
    const row = await screen.findByTestId(`team-${teamId(e, 'T1')}`);
    fireEvent.click(row.querySelector('button[data-action="dnf"]')!);
    return { sent, dialog: await screen.findByRole('dialog') };
  };

  it('asks before a correction to an earlier round, then confirms', async () => {
    const { sent, dialog } = await askToUnlock([]);
    expect(dialog.textContent).toContain('No line-ups are affected.');
    fireEvent.click(screen.getByRole('button', { name: 'Change anyway' }));
    await waitFor(() => expect(sent.at(-1)).toMatchObject({ type: 'setResult', round: 1, confirmUnlock: true, set: { kind: 'status', status: 'dnf' } }));
  });

  it('names the opened rounds that keep a line-up the correction no longer matches', async () => {
    const { dialog } = await askToUnlock([3]);
    expect(dialog.textContent).toContain('Round 3 was opened with its original line-up and keeps it.');
    expect(dialog.textContent).toContain('The corrected results will not match who raced there.');
  });

  it('lists several opened rounds that keep their line-ups', async () => {
    const { dialog } = await askToUnlock([3, 4]);
    expect(dialog.textContent).toContain('Round 3, Round 4 were opened with their original line-ups and keep them.');
  });

  it('warns that brackets stay as they were set when a correction changes seeding', async () => {
    const { dialog } = await askToUnlock([], true);
    const warning = 'Brackets were set when the first bracket round opened. Teams stay in those brackets, even if this changes their seeding.';
    expect(dialog.textContent).toContain(warning);
    expect([...dialog.querySelectorAll('strong')].some((s) => s.textContent === warning)).toBe(true);
    expect(dialog.textContent).not.toContain('No line-ups are affected.');
  });

  it('has no penalties switch on the Race page any more', () => {
    render(<ConsolePage me={me('admin')} view={ctlViewOf(openNext(lockedFour()))} send={async () => ({ ok: true })} serverNow={() => 0} status="open" />);
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('marks an outstanding team DNF', async () => {
    const send = vi.fn(async () => ({ ok: true }));
    const e = start(openNext(lockedFour()));
    render(<ConsolePage me={me('admin')} view={ctlViewOf(e)} send={send} serverNow={() => 0} status="open" />);
    const outstanding = screen.getByRole('region', { name: 'Outstanding' });
    fireEvent.click(outstanding.querySelector(`[data-team="${teamId(e, 'T3')}"] button[data-action="dnf"]`)!);
    await waitFor(() => expect(send).toHaveBeenCalledWith({ type: 'setResult', round: 1, teamId: teamId(e, 'T3'), set: { kind: 'status', status: 'dnf' } }));
  });
});

describe('referees on the Stations panel', () => {
  beforeEach(() => cleanup());

  const dana = { deviceId: 'dev1', name: 'Dana', station: 1, tables: [1, 2] };
  const lee = { deviceId: 'dev2', name: 'Lee', station: 2, tables: [3, 4] };
  const roster = [
    { deviceId: 'dev1', name: 'Dana', home: 1 }, { deviceId: 'dev2', name: 'Lee', home: 2 }, { deviceId: 'dev3', name: 'Sam', home: 2 },
  ];
  function show(more: Partial<ControlView>, opts: { running?: boolean; send?: (cmd: any) => Promise<Ack> } = {}) {
    const send = vi.fn(opts.send ?? (async () => ({ ok: true })));
    const e = opts.running ? start(openNext(lockedFour())) : openNext(lockedFour());
    render(<ConsolePage me={me('admin')} view={{ ...ctlViewOf(e), roster, ...more }} send={send} serverNow={() => 0} status="open" />);
    return { send, stations: screen.getByRole('region', { name: 'Stations' }) };
  }
  const card = (label: string) => screen.getByText(label, { selector: '.station .headline' }).closest('.station') as HTMLElement;

  it("shows each station's referee by name", () => {
    show({ assignments: [dana, lee] });
    expect(within(card('Tables 1 & 2')).getByText('Dana')).toBeTruthy();
    expect(within(card('Tables 3 & 4')).getByText('Lee')).toBeTruthy();
    expect(screen.queryByText('No referee')).toBeNull();
  });

  it('shows both referees of a split final with their tables', () => {
    show({ assignments: [{ ...dana, tables: [1] }, { deviceId: 'dev3', name: 'Sam', station: 1, tables: [2] }, lee] });
    expect(within(card('Tables 1 & 2')).getByText('Dana (T1)')).toBeTruthy();
    expect(within(card('Tables 1 & 2')).getByText('Sam (T2)')).toBeTruthy();
    expect(within(card('Tables 3 & 4')).getByText('Lee')).toBeTruthy();
  });

  it('says "No referee" on a station with teams and nobody assigned, but not on one without teams', () => {
    show({ assignments: [dana] });
    expect(within(card('Tables 3 & 4')).getByText('No referee')).toBeTruthy();
    expect(within(card('Tables 3 & 4')).queryByRole('button', { name: /^Swap/ })).toBeNull();
    expect(screen.getAllByText('No referee').length).toBe(1);
    cleanup();
    const view = ctlViewOf(openNext(lockedFour()));
    show({ assignments: [dana], stations: { ...view.stations, 2: { ready: false, excluded: true, readyTables: [] } } });
    expect(within(card('Tables 3 & 4')).getByText('No teams')).toBeTruthy();
    expect(screen.queryByText('No referee')).toBeNull();
  });

  it('adds nothing when the round has no saved assignments', () => {
    const { stations } = show({ assignments: [] });
    expect(within(stations).queryByText('No referee')).toBeNull();
    expect(within(stations).queryByRole('button', { name: /^Swap/ })).toBeNull();
    expect(within(card('Tables 1 & 2')).getAllByRole('button').map((b) => b.textContent)).toEqual(['Ready', 'Exclude']);
  });

  it('swaps a referee with another one chosen from the list', async () => {
    const { send } = show({ assignments: [dana, lee] });
    const first = card('Tables 1 & 2');
    expect(within(first).queryByRole('combobox')).toBeNull();
    fireEvent.click(within(first).getByRole('button', { name: 'Swap Dana' }));
    const select = within(first).getByRole('combobox', { name: 'Swap Dana with' }) as HTMLSelectElement;
    expect([...select.options].filter((o) => !o.disabled).map((o) => o.textContent)).toEqual(['Lee — Tables 3 & 4', 'Sam — no tables']);
    const confirm = within(first).getByRole('button', { name: 'Swap' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(select, { target: { value: 'dev2' } });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => expect(send).toHaveBeenCalledWith({ type: 'swapReferees', a: 'dev1', b: 'dev2' }));
    await waitFor(() => expect(within(first).queryByRole('combobox')).toBeNull());
  });

  it('can bring in a referee who has no tables this round', async () => {
    const { send } = show({ assignments: [dana, lee] });
    const second = card('Tables 3 & 4');
    fireEvent.click(within(second).getByRole('button', { name: 'Swap Lee' }));
    fireEvent.change(within(second).getByRole('combobox'), { target: { value: 'dev3' } });
    fireEvent.click(within(second).getByRole('button', { name: 'Swap' }));
    await waitFor(() => expect(send).toHaveBeenCalledWith({ type: 'swapReferees', a: 'dev2', b: 'dev3' }));
  });

  it('opens one swap at a time, and Cancel closes it', () => {
    show({ assignments: [dana, lee] });
    fireEvent.click(screen.getByRole('button', { name: 'Swap Dana' }));
    fireEvent.click(screen.getByRole('button', { name: 'Swap Lee' }));
    expect(screen.getAllByRole('combobox', { name: /^Swap .* with$/ }).length).toBe(1);
    expect(screen.getByRole('combobox', { name: 'Swap Lee with' })).toBeTruthy();
    fireEvent.click(within(card('Tables 3 & 4')).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('combobox', { name: /^Swap .* with$/ })).toBeNull();
  });

  it('shows a refused swap under the card and keeps it open', async () => {
    show({ assignments: [dana, lee] }, { send: async () => ({ ok: false, code: 'round_not_open', message: 'Referees can only be swapped before the start.' }) });
    const first = card('Tables 1 & 2');
    fireEvent.click(within(first).getByRole('button', { name: 'Swap Dana' }));
    fireEvent.change(within(first).getByRole('combobox'), { target: { value: 'dev2' } });
    fireEvent.click(within(first).getByRole('button', { name: 'Swap' }));
    expect(await within(first).findByText('Referees can only be swapped before the start.')).toBeTruthy();
    expect(within(first).getByRole('combobox')).toBeTruthy();
  });

  it('offers no swap once the race is running, but keeps the names', () => {
    const { stations } = show({ assignments: [dana, lee] }, { running: true });
    expect(within(stations).queryByRole('button', { name: /^Swap/ })).toBeNull();
    expect(within(card('Tables 1 & 2')).getByText('Dana')).toBeTruthy();
  });
});
