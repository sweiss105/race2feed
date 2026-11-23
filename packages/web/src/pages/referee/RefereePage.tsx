import { useEffect, useRef, useState } from 'preact/hooks';
import './referee.css';
import { formatMs } from '@race2feed/engine';
import type { Ack, RefereeView } from '../../lib/types';
import type { LiveStatus } from '../../lib/live';
import type { TapQueue } from '../../lib/queue';
import { Button } from '../../ui/Button';
import { timeText } from '../../ui/Time';
import { useNow } from '../../lib/useNow';

type Team = RefereeView['teams'][number];

export interface RefereeProps {
  view: RefereeView | null;
  status: LiveStatus;
  clock: { synced(): boolean; serverNow(): number };
  queue: TapQueue;
  send(cmd: object): Promise<Ack>;
  newId(): string;
  vibrate?(ms: number): void;
}

interface Recent { clientTapId: string; teamId: string; kind: 'finish' | 'penalty'; until: number }

export function RefereePage({ view, status, clock, queue, send, newId, vibrate }: RefereeProps) {
  const [flushed, setFlushed] = useState(false);
  const [sending, setSending] = useState<Set<string>>(new Set());
  const [recent, setRecent] = useState<Recent | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Send taps left over from before a reload or a dropout. New taps wait for the first flush
  // after page load; after that a dropout does not block tapping (taps queue and send later).
  useEffect(() => {
    if (status !== 'open') return;
    let live = true;
    void queue.flush(send).then(() => { if (live) setFlushed(true); });
    return () => { live = false; };
  }, [status, queue, send]);

  useEffect(() => {
    if (!recent) return;
    const t = setTimeout(() => setRecent(null), Math.max(0, recent.until - Date.now()));
    return () => clearTimeout(t);
  }, [recent]);

  const running = view?.round.phase === 'running' && view.round.startedAt !== null;
  const now = useNow(() => clock.serverNow(), Boolean(running));

  if (!view) return <div class="ref-center"><p class="secondary">Connecting…</p></div>;
  const { round, station, settings } = view;
  const canTap = clock.synced() && flushed;

  const tap = async (team: Team, kind: 'finish' | 'penalty') => {
    const clientTapId = newId();
    const cmd = kind === 'finish'
      ? { type: 'tapFinish', teamId: team.teamId, atServerMs: clock.serverNow(), clientTapId }
      : { type: 'tapPenalty', teamId: team.teamId, clientTapId };
    queue.add({ clientTapId, cmd });
    vibrate?.(15);
    setError(null);
    setSending((s) => new Set(s).add(`${kind}:${team.teamId}`));
    try {
      const ack = await send(cmd);
      queue.settle(clientTapId, ack);
      if (ack.ok) setRecent({ clientTapId, teamId: team.teamId, kind, until: Date.now() + settings.undoWindowMs });
      else setError(ack.message ?? 'The tap was refused.');
    } catch {
      setError('No connection — the tap is saved and will be sent automatically.');
    } finally {
      setSending((s) => { const n = new Set(s); n.delete(`${kind}:${team.teamId}`); return n; });
    }
  };

  const undo = async () => {
    if (!recent) return;
    const team = view.teams.find((t) => t.teamId === recent.teamId);
    const tapId = team?.taps.filter((t) => t.kind === recent.kind && t.removedAt === null).at(-1)?.id;
    if (!tapId) return;
    setRecent(null);
    const ack = await send({ type: 'undoTap', tapId }).catch(() => null);
    if (ack && !ack.ok) setError(ack.message ?? 'Could not undo.');
  };

  const meta = (
    <div class="ref-meta">
      <div>
        <div class="headline">Tables {station.tables.join(' & ')}</div>
        <div class="footnote secondary">{round.current ? `Round ${round.current}` : 'Waiting for the first round'}</div>
      </div>
      {running && <div class="ref-clock" aria-label="Race clock">{formatMs(Math.max(0, now - round.startedAt!), 'seconds')}</div>}
    </div>
  );

  let body;
  if (station.excluded && round.phase !== 'idle') {
    body = <div class="ref-center"><p class="title-2">No teams at your tables this round</p><p class="secondary">Stand by for the next round.</p></div>;
  } else if (round.phase === 'idle') {
    body = <div class="ref-center"><p class="title-2">Waiting for race control</p></div>;
  } else if (round.phase === 'open') {
    body = station.ready
      ? <div class="ref-center"><p class="ref-ready-done">Ready ✓</p><p class="secondary">Waiting for the start</p></div>
      : (
        <div class="ref-center">
          <TeamsPreview teams={view.teams} />
          <ReadyButton send={send} />
        </div>
      );
  } else if (round.phase === 'running') {
    body = (
      <>
        {!canTap && <p class="ref-notice footnote secondary">{clock.synced() ? 'Sending saved taps…' : 'Syncing clock…'}</p>}
        <div class="ref-teams">
          {view.teams.map((t) => {
            const done = t.result !== null;
            const busy = sending.has(`finish:${t.teamId}`);
            const penalties = t.taps.filter((x) => x.kind === 'penalty' && x.removedAt === null).length;
            return (
              <div class="ref-team" key={t.teamId}>
                <button type="button" class={`ref-tap${canTap ? '' : ' syncing'}`} disabled={!canTap || done || busy}
                  onClick={() => void tap(t, 'finish')}>
                  <span>{t.name}</span>
                  <span class="table">Table {t.table}</span>
                  {done && <span class="time">{timeText({ status: t.result!.status, officialMs: t.result!.rawMs === null ? null : t.result!.rawMs + t.result!.penaltiesMs, penaltiesMs: t.result!.penaltiesMs })}</span>}
                  {busy && !done && <span class="table">Sending…</span>}
                </button>
                {settings.penaltiesEnabled && (
                  <button type="button" class="ref-pen" disabled={!canTap} aria-label={`+${settings.penaltyMs / 1000}s penalty for ${t.name}`}
                    onClick={() => void tap(t, 'penalty')}>
                    +{settings.penaltyMs / 1000}s{penalties > 0 && <span class="count">×{penalties}</span>}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </>
    );
  } else {
    body = (
      <div class="ref-center">
        <p class="title-2">Round {round.current} finished</p>
        <ul class="list" style={{ textAlign: 'left', minWidth: '18rem' }}>
          {view.teams.map((t) => (
            <li key={t.teamId}><span class="headline">{t.name}</span><span class="tabular">{t.result ? timeText({ status: t.result.status, officialMs: t.result.rawMs === null ? null : t.result.rawMs + t.result.penaltiesMs, penaltiesMs: t.result.penaltiesMs }) : '—'}</span></li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div class="ref-main">
      {meta}
      {error && <p class="ref-notice callout" role="alert" style={{ color: 'var(--danger)' }}>{error}</p>}
      {body}
      {recent && <UndoBar recent={recent} windowMs={settings.undoWindowMs} teams={view.teams} onUndo={undo} />}
    </div>
  );
}

function TeamsPreview({ teams }: { teams: Team[] }) {
  return (
    <ul class="list" style={{ textAlign: 'left', minWidth: '18rem' }}>
      {teams.map((t) => <li key={t.teamId}><span class="headline">{t.name}</span><span class="secondary">Table {t.table}</span></li>)}
    </ul>
  );
}

function ReadyButton({ send }: { send(cmd: object): Promise<Ack> }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button class="ref-ready" busy={busy} onClick={async () => {
      setBusy(true);
      try { await send({ type: 'stationReady' }); } catch { /* the view will show it is still not ready */ } finally { setBusy(false); }
    }}>Ready</Button>
  );
}

function UndoBar({ recent, windowMs, teams, onUndo }: { recent: Recent; windowMs: number; teams: Team[]; onUndo(): void }) {
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = bar.current;
    if (!el || typeof el.animate !== 'function') return;
    const left = Math.max(0, recent.until - Date.now());
    el.animate([{ transform: `scaleX(${left / windowMs})` }, { transform: 'scaleX(0)' }], { duration: left, easing: 'linear', fill: 'forwards' });
  }, [recent, windowMs]);
  const name = teams.find((t) => t.teamId === recent.teamId)?.name ?? '';
  return (
    <div class="undo-bar" role="status">
      <span class="callout">{recent.kind === 'finish' ? `${name} finished` : `Penalty for ${name}`}</span>
      <Button kind="plain" onClick={onUndo}>Undo</Button>
      <div class="progress" ref={bar} style={{ width: '100%' }} />
    </div>
  );
}
