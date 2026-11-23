import { useMemo, useState } from 'preact/hooks';
import { formatMs, parseClockTime } from '@race2feed/engine';
import type { ControlView } from '../../../lib/types';
import { Button } from '../../../ui/Button';
import { timeText } from '../../../ui/Time';
import { teamName } from '../../../lib/selectors';
import { useNow } from '../../../lib/useNow';
import { useRunner } from '../runner';
import { Switch } from '../../../ui/Switch';

const SCREENS = ['welcome', 'tables', 'clock', 'seeding-results', 'brackets', 'standings', 'champion'] as const;

export function Race({ view, serverNow }: { view: ControlView; serverNow(): number }) {
  const runner = useRunner();
  const { round } = view;
  const running = round.phase === 'running' && round.startedAt !== null;
  const now = useNow(serverNow, running);
  const elapsed = running ? Math.max(0, now - round.startedAt!) : 0;
  const notReady = Object.values(view.stations).filter((s) => !s.excluded && !s.ready).length;

  const act = (cmd: { type: string } & Record<string, unknown>, key?: string) => () => void runner.run(cmd, key);

  return (
    <>
      <header class="race-head">
        <div class="left">
          <h2 class="title-1">{round.current ? `Round ${round.current}` : 'Not started'}</h2>
          <span class={`pill ${round.phase}`}>{round.phase}</span>
          {running && <span class="race-clock" aria-label="Race clock">{formatMs(elapsed, 'seconds')}</span>}
        </div>
        <div class="race-actions">
          <Button kind={round.phase === 'idle' || round.phase === 'finished' ? 'primary' : 'secondary'} busy={runner.busy('openNextRound')}
            disabled={round.phase === 'open' || round.phase === 'running'} onClick={act({ type: 'openNextRound' })}>Open next round</Button>
          <Button kind={round.phase === 'open' ? 'primary' : 'secondary'} busy={runner.busy('startRace')}
            disabled={round.phase !== 'open'} onClick={act({ type: 'startRace' })}>Start</Button>
          <Button kind={round.phase === 'running' ? 'primary' : 'secondary'} busy={runner.busy('finishRace')}
            disabled={round.phase !== 'running'} onClick={act({ type: 'finishRace' })}>Finish</Button>
        </div>
      </header>
      {['openNextRound', 'startRace', 'finishRace'].map((k) => runner.error(k) && <p key={k} class="err" role="alert">{runner.error(k)}</p>)}
      {round.phase === 'open' && notReady > 0 && <p class="callout secondary">{notReady} station{notReady === 1 ? '' : 's'} not ready yet.</p>}

      <div class="race-actions" style={{ marginBottom: 'var(--space-4)' }}>
        <Switch checked={view.settings.penaltiesEnabled} label={`Time penalties (+${view.settings.penaltyMs / 1000}s)`}
          onToggle={(enabled) => runner.run({ type: 'setPenaltiesEnabled', enabled })} />
        <label class="field" style={{ marginLeft: 'auto' }}>
          <span class="visually-hidden">Projector screen</span>
          <select class="input" value={view.projectorPin ?? ''} onChange={(e) => {
            const v = (e.target as HTMLSelectElement).value;
            void runner.run({ type: 'pinProjector', screen: v || null });
          }}>
            <option value="">Projector: automatic ({view.projector})</option>
            {SCREENS.map((s) => <option key={s} value={s}>Projector: {s.replace('-', ' ')}</option>)}
          </select>
        </label>
      </div>

      <Stations view={view} />
      {view.outstanding.length > 0 && <Outstanding view={view} />}
      {view.ties.length > 0 && <Ties view={view} />}
      {view.blockers.length > 0 && <p class="err" role="alert">{view.blockers.join(' · ')}</p>}
      <Results view={view} />
    </>
  );
}

function Stations({ view }: { view: ControlView }) {
  const runner = useRunner();
  const entries = Object.entries(view.stations);
  if (!entries.length) return null;
  const set = (station: number, state: 'ready' | 'notReady' | 'excluded') =>
    () => void runner.run({ type: 'overrideStation', station, state }, `station-${station}`);
  return (
    <section class="panel" aria-label="Stations">
      <h3 class="headline">Stations</h3>
      <div class="grid-stations">
        {entries.map(([n, s]) => {
          const station = Number(n);
          const cls = s.excluded ? 'excluded' : s.ready ? 'ready' : 'notready';
          return (
            <div class={`station ${cls}`} key={n}>
              <div class="headline">Tables {station * 2 - 1}&nbsp;&amp;&nbsp;{station * 2}</div>
              <div class="footnote secondary">{s.excluded ? 'No teams' : s.ready ? 'Ready' : 'Not ready'}</div>
              <div class="mini">
                {!s.ready && !s.excluded && <Button kind="secondary" busy={runner.busy(`station-${station}`)} onClick={set(station, 'ready')}>Ready</Button>}
                {s.ready && <Button kind="secondary" busy={runner.busy(`station-${station}`)} onClick={set(station, 'notReady')}>Unready</Button>}
                {!s.excluded && <Button kind="plain" onClick={set(station, 'excluded')}>Exclude</Button>}
                {s.excluded && <Button kind="plain" onClick={set(station, 'notReady')}>Include</Button>}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Outstanding({ view }: { view: ControlView }) {
  const runner = useRunner();
  const round = view.round.current;
  return (
    <section class="panel" aria-label="Outstanding">
      <h3 class="headline">Waiting on {view.outstanding.length} team{view.outstanding.length === 1 ? '' : 's'}</h3>
      <table class="table">
        <tbody>
          {view.outstanding.map((o) => (
            <tr key={o.teamId} data-team={o.teamId}>
              <td class="tabular" style={{ width: '4rem' }}>T{o.table}</td>
              <td class="headline">{teamName(view, o.teamId)}</td>
              <td><div class="actions">
                {(['dnf', 'dns'] as const).map((status) => (
                  <Button key={status} kind="secondary" data-action={status} busy={runner.busy(`result-${round}-${o.teamId}`)}
                    onClick={() => void runner.run({ type: 'setResult', round, teamId: o.teamId, set: { kind: 'status', status } }, `result-${round}-${o.teamId}`)}>
                    {status.toUpperCase()}
                  </Button>
                ))}
              </div></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Ties({ view }: { view: ControlView }) {
  const runner = useRunner();
  return (
    <section class="panel" aria-label="Ties">
      <h3 class="headline">Ties to decide</h3>
      {view.ties.flatMap((t) => t.teams.map((group, gi) => <TieDecision key={`${t.raceId}-${gi}`} raceId={t.raceId} group={group} view={view} run={runner.run} busy={runner.busy(`tie-${t.raceId}`)} />))}
    </section>
  );
}

function TieDecision({ raceId, group, view, run, busy }: { raceId: string; group: string[]; view: ControlView; run: ReturnType<typeof useRunner>['run']; busy: boolean }) {
  const [order, setOrder] = useState(group);
  const move = (i: number, d: -1 | 1) => setOrder((o) => {
    const n = [...o];
    const j = i + d;
    if (j < 0 || j >= n.length) return o;
    [n[i], n[j]] = [n[j]!, n[i]!];
    return n;
  });
  return (
    <div class="card" style={{ marginBottom: 'var(--space-3)' }}>
      <p class="footnote secondary" style={{ marginTop: 0 }}>Same time to the hundredth. Put them in finishing order.</p>
      <ol class="list">
        {order.map((id, i) => (
          <li key={id}>
            <span class="num">{i + 1}</span><span class="grow headline">{teamName(view, id)}</span>
            <Button kind="plain" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>↑</Button>
            <Button kind="plain" aria-label="Move down" disabled={i === order.length - 1} onClick={() => move(i, 1)}>↓</Button>
          </li>
        ))}
      </ol>
      <div style={{ marginTop: 'var(--space-3)' }}>
        <Button busy={busy} onClick={() => void run({ type: 'decideTie', raceId, order }, `tie-${raceId}`)}>Decide</Button>
      </div>
    </div>
  );
}

function Results({ view }: { view: ControlView }) {
  const runner = useRunner();
  const [picked, setPicked] = useState<number | null>(null);
  const round = picked ?? view.round.current;
  const rows = useMemo(() => (view.rounds[round - 1]?.races ?? [])
    .flatMap((race) => race.entrants.map((x) => ({ ...x, label: race.label })))
    .sort((a, b) => a.table - b.table), [view, round]);
  if (!view.round.current) return null;

  const activePenalties = (teamId: string) => view.taps.filter((t) => t.kind === 'penalty' && t.round === round && t.teamId === teamId && t.removedAt === null);

  return (
    <section class="panel" aria-label="Results">
      <div class="race-head">
        <h3 class="headline">Results</h3>
        <label class="field" style={{ gridAutoFlow: 'column', alignItems: 'center' }}>
          <span class="footnote secondary">Round</span>
          <select class="input" aria-label="Round" value={String(round)} onChange={(e) => setPicked(Number((e.target as HTMLSelectElement).value))}>
            {Array.from({ length: view.round.current }, (_, i) => i + 1).map((r) => <option key={r} value={String(r)}>{r}</option>)}
          </select>
        </label>
      </div>
      <table class="table">
        <thead><tr><th>Table</th><th>Team</th><th>Race</th><th>Time</th><th>Correct</th></tr></thead>
        <tbody>
          {rows.map((x) => {
            const key = `result-${round}-${x.teamId}`;
            const pens = activePenalties(x.teamId);
            const set = (s: object) => () => void runner.run({ type: 'setResult', round, teamId: x.teamId, set: s }, key);
            return (
              <tr key={x.teamId} data-testid={`team-${x.teamId}`}>
                <td class="tabular">{x.table}</td>
                <td class="headline">{teamName(view, x.teamId)}</td>
                <td class="footnote secondary">{x.label}</td>
                <td class="tabular">{timeText(x)}{runner.error(key) && <div class="err">{runner.error(key)}</div>}</td>
                <td><div class="actions">
                  <TimeEntry onSet={(rawMs) => void runner.run({ type: 'setResult', round, teamId: x.teamId, set: { kind: 'time', rawMs } }, key)} />
                  <Button kind="secondary" data-action="dnf" busy={runner.busy(key)} onClick={set({ kind: 'status', status: 'dnf' })}>DNF</Button>
                  <Button kind="secondary" data-action="dns" busy={runner.busy(key)} onClick={set({ kind: 'status', status: 'dns' })}>DNS</Button>
                  <Button kind="plain" data-action="clear" busy={runner.busy(key)} onClick={set({ kind: 'clear' })}>Clear</Button>
                  <Button kind="secondary" data-action="add-penalty" busy={runner.busy(`${key}-pen`)}
                    onClick={() => void runner.run({ type: 'addPenalty', round, teamId: x.teamId }, `${key}-pen`)}>+{view.settings.penaltyMs / 1000}s</Button>
                  {pens.length > 0 && (
                    <Button kind="destructive" data-action="remove-penalty" busy={runner.busy(`${key}-pen`)}
                      onClick={() => void runner.run({ type: 'removePenalty', tapId: pens.at(-1)!.id }, `${key}-pen`)}>−{(pens.at(-1)!.amountMs ?? 0) / 1000}s</Button>
                  )}
                </div></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function TimeEntry({ onSet }: { onSet(rawMs: number): void }) {
  const [text, setText] = useState('');
  const [bad, setBad] = useState(false);
  const submit = (e: Event) => {
    e.preventDefault();
    try {
      onSet(parseClockTime(text));
      setText('');
      setBad(false);
    } catch {
      setBad(true);
    }
  };
  return (
    <form onSubmit={submit} style={{ display: 'flex', gap: 'var(--space-1)' }}>
      <input class="input time-input" aria-label="Time (m:ss.hh)" placeholder="m:ss.hh" value={text} aria-invalid={bad ? 'true' : undefined}
        onInput={(e) => setText((e.target as HTMLInputElement).value)} />
      <Button kind="secondary" type="submit" disabled={!text}>Set</Button>
    </form>
  );
}
