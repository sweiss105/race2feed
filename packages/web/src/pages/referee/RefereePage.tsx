import { useEffect, useRef, useState } from 'preact/hooks';
import './referee.css';
import { formatMs } from '@race2feed/engine';
import type { Ack, RefereeView } from '../../lib/types';
import type { LiveStatus } from '../../lib/live';
import { NON_RETRYABLE, type TapQueue } from '../../lib/queue';
import { Button } from '../../ui/Button';
import { timeText } from '../../ui/Time';
import { useNow } from '../../lib/useNow';
import { stationLabel } from '../../lib/selectors';

type Team = RefereeView['teams'][number];

export interface RefereeProps {
  view: RefereeView | null;
  status: LiveStatus;
  clock: { synced(): boolean; serverNow(): number };
  queue: TapQueue;
  send(cmd: object): Promise<Ack>;
  newId(): string;
  vibrate?(ms: number): void;
  /** How often to retry unsent taps while connected. */
  retryMs?: number;
}

export function RefereePage({ view, status, clock, queue, send, newId, vibrate, retryMs = 5000 }: RefereeProps) {
  // Taps wait for the first flush only if something was left queued from before.
  const [flushed, setFlushed] = useState(() => queue.all().length === 0);
  const [queued, setQueued] = useState(() => queue.all());
  const refreshQueue = () => setQueued(queue.all());
  const [sending, setSending] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  // Every tap this page made (or found queued on load); undo rows are derived from the server view for these.
  const mine = useRef<Set<string> | null>(null);
  if (!mine.current) mine.current = new Set(queue.all().map((q) => q.clientTapId));
  // Tap ids whose undo is waiting for an answer; a second press for the same tap is ignored.
  const undoing = useRef(new Set<string>());
  const teamsRef = useRef<Team[]>([]);
  teamsRef.current = view?.teams ?? [];

  // Send taps left over from before a reload or a dropout. New taps wait for the first flush
  // after page load; after that a dropout does not block tapping (taps queue and send later).
  const currentRound = view?.round.current;
  useEffect(() => {
    if (status !== 'open' || currentRound === undefined) return;
    let live = true;
    const flush = () => {
      // Taps from a finished round can't apply any more (and a penalty would land in the wrong round).
      queue.drop((e) => e.round !== undefined && e.round !== currentRound);
      void queue.flush(send, (entry, ack) => {
        // A refusal is shown even if the round or connection changed while the answer was in flight.
        if (ack.ok || !ack.code || !NON_RETRYABLE.has(ack.code)) return;
        const id = (entry.cmd as { teamId?: string }).teamId;
        const name = teamsRef.current.find((t) => t.teamId === id)?.name ?? 'a team';
        const inRound = entry.round !== undefined ? ` in round ${entry.round}` : '';
        setError(`The saved tap for ${name}${inRound} was refused: ${ack.message ?? ack.code}`);
      }).then(() => { if (live) { setFlushed(true); refreshQueue(); } });
    };
    flush();
    // Retry anything still unsent (e.g. a command that timed out on a live connection).
    const timer = setInterval(() => { if (queue.all().length) flush(); }, retryMs);
    return () => { live = false; clearInterval(timer); };
  }, [status, queue, send, currentRound, retryMs]);

  useEffect(() => { setError(null); }, [currentRound]);

  const running = view?.round.phase === 'running' && view.round.startedAt !== null;
  const now = useNow(() => clock.serverNow(), Boolean(running));

  if (!view) return <div class="ref-center"><p class="secondary">Connecting…</p></div>;
  const { round, station, settings } = view;
  const canTap = clock.synced() && flushed;

  const tap = async (team: Team, kind: 'finish' | 'penalty') => {
    if (!clock.synced()) return;
    const clientTapId = newId();
    const cmd = kind === 'finish'
      ? { type: 'tapFinish', teamId: team.teamId, atServerMs: clock.serverNow(), clientTapId }
      : { type: 'tapPenalty', teamId: team.teamId, clientTapId };
    mine.current!.add(clientTapId);
    queue.add({ clientTapId, cmd, round: round.current });
    refreshQueue();
    vibrate?.(15);
    setError(null);
    setSending((s) => new Set(s).add(`${kind}:${team.teamId}`));
    try {
      const ack = await send(cmd);
      queue.settle(clientTapId, ack);
      refreshQueue();
      if (!ack.ok) setError(ack.message ?? 'The tap was refused.');
    } catch {
      // Saved in the queue; the "waiting to send" notice covers it.
    } finally {
      setSending((s) => { const n = new Set(s); n.delete(`${kind}:${team.teamId}`); return n; });
    }
  };

  const undo = async (tapId: string) => {
    if (undoing.current.has(tapId)) return;
    undoing.current.add(tapId);
    try {
      const ack = await send({ type: 'undoTap', tapId });
      // not_found: the tap is already gone (an earlier press got there first), which is what was asked.
      if (!ack.ok && ack.code !== 'not_found') setError(ack.message ?? 'Could not undo.');
    } catch {
      setError('Could not undo — not connected. Try again.');
    } finally {
      undoing.current.delete(tapId);
    }
  };

  const serverNow = clock.serverNow();
  const undoRows = !running ? [] : view.teams.flatMap((team) => team.taps
    .filter((x) => x.clientTapId && mine.current!.has(x.clientTapId) && x.removedAt === null
      && x.createdAt + settings.undoWindowMs > serverNow && (x.kind === 'finish' || x.review.status === 'pending'))
    .map((x) => ({ tap: x, team })))
    .sort((a, b) => b.tap.createdAt - a.tap.createdAt);
  // While running, a penalty's note card shows once its team has a result (finish, DNF, DNS or DQ).
  const noteReady = (team: Team) => round.phase === 'finished' || team.result !== null;

  const meta = (
    <div class="ref-meta">
      <div>
        <div class="headline">{stationLabel(station.tables)}</div>
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
        {queued.length > 0 && (
          <p class="ref-notice footnote" role="status" style={{ color: 'var(--warning)' }}>
            {queued.length} tap{queued.length === 1 ? '' : 's'} waiting to send — they go automatically when the connection is back.
          </p>
        )}
        <div class="ref-teams">
          {view.teams.map((t) => {
            const done = t.result !== null;
            const busy = sending.has(`finish:${t.teamId}`);
            const mineQueued = queued.filter((q) => (q.cmd as { teamId?: string }).teamId === t.teamId);
            const waiting = mineQueued.some((q) => (q.cmd as { type: string }).type === 'tapFinish');
            const sentIds = new Set(t.taps.map((x) => x.clientTapId));
            const penalties = t.taps.filter((x) => x.kind === 'penalty' && x.removedAt === null).length
              + mineQueued.filter((q) => (q.cmd as { type: string }).type === 'tapPenalty' && !sentIds.has(q.clientTapId)).length;
            return (
              <div class="ref-team" key={t.teamId}>
                <button type="button" class={`ref-tap${canTap ? '' : ' syncing'}`} disabled={!canTap || done || busy || waiting}
                  onClick={() => void tap(t, 'finish')}>
                  <span>{t.name}</span>
                  <span class="table">Table {t.table}</span>
                  {done && <span class="time">{timeText({ status: t.result!.status, officialMs: t.result!.rawMs === null ? null : t.result!.rawMs + t.result!.penaltiesMs, penaltiesMs: t.result!.penaltiesMs, dq: t.dq, penaltyPending: t.penaltyPending })}</span>}
                  {busy && !done && !waiting && <span class="table">Sending…</span>}
                  {waiting && !done && <span class="table">Waiting to send</span>}
                </button>
                {settings.penaltiesEnabled && (
                  <button type="button" class="ref-pen" disabled={!canTap} aria-label={`Penalty for ${t.name}`}
                    onClick={() => void tap(t, 'penalty')}>
                    Penalty{penalties > 0 && <span class="count">×{penalties}</span>}
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
            <li key={t.teamId}><span class="headline">{t.name}</span><span class="tabular">{t.result ? timeText({ status: t.result.status, officialMs: t.result.rawMs === null ? null : t.result.rawMs + t.result.penaltiesMs, penaltiesMs: t.result.penaltiesMs, dq: t.dq, penaltyPending: t.penaltyPending }) : '—'}</span></li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div class={`ref-main${running ? ' running' : ''}`}>
      {meta}
      {error && <p class="ref-notice callout" role="alert" style={{ color: 'var(--danger)' }}>{error}</p>}
      {body}
      {/* One place for both phases, so a half-written note survives the round finishing. While running, this area has
          a fixed height and scrolls, so the team buttons never move or shrink and the Undo rows never cover a card. */}
      {(round.phase === 'running' || round.phase === 'finished') && (
        <div key="below" class={`ref-below${running ? ' live' : ''}`}>
          {undoRows.length > 0 && (
            <div class="undo-stack">
              {undoRows.map(({ tap: x, team }) => (
                <UndoRow key={x.id} kind={x.kind === 'penalty' ? 'penalty' : 'finish'} name={team.name}
                  leftMs={x.createdAt + settings.undoWindowMs - serverNow} windowMs={settings.undoWindowMs} onUndo={() => void undo(x.id)} />
              ))}
            </div>
          )}
          <PenaltyNotes key="notes" view={view} send={send} ready={noteReady} />
        </div>
      )}
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

function UndoRow({ kind, name, leftMs, windowMs, onUndo }: { kind: 'finish' | 'penalty'; name: string; leftMs: number; windowMs: number; onUndo(): void }) {
  const bar = useRef<HTMLDivElement>(null);
  const left = useRef(leftMs);
  left.current = leftMs;
  useEffect(() => {
    const el = bar.current;
    if (!el || typeof el.animate !== 'function') return;
    const ms = Math.max(0, left.current);
    el.animate([{ transform: `scaleX(${ms / windowMs})` }, { transform: 'scaleX(0)' }], { duration: ms, easing: 'linear', fill: 'forwards' });
  }, [windowMs]);
  return (
    <div class="undo-bar" role="status">
      <span class="callout">{kind === 'finish' ? `${name} finished` : `Penalty for ${name}`}</span>
      <Button kind="plain" aria-label={kind === 'finish' ? `Undo ${name} finished` : `Undo penalty for ${name}`} onClick={onUndo}>Undo</Button>
      <div class="progress" ref={bar} style={{ width: '100%' }} />
    </div>
  );
}

/** Once a penalised team has finished (or the round has), the referee says why each penalty they gave was given; race control then decides. */
function PenaltyNotes({ view, send, ready }: { view: RefereeView; send(cmd: object): Promise<Ack>; ready(team: Team): boolean }) {
  const items = view.teams.flatMap((t) => t.taps
    .filter((x) => x.kind === 'penalty' && x.source === 'referee' && x.removedAt === null && x.review.status === 'pending' && ready(t))
    .map((x) => ({ tap: x, team: t })));
  if (!items.length) return null;
  return (
    <div class="ref-notes">
      <h2 class="headline">Penalty notes</h2>
      <p class="footnote secondary">Tell race control why. They approve or reject each penalty before the next round.</p>
      {items.map(({ tap, team }) => (
        <PenaltyNote key={tap.id} tapId={tap.id} teamName={team.name} sentReason={tap.review.refereeReasonId}
          reasons={view.reasons} send={send} />
      ))}
    </div>
  );
}

function PenaltyNote({ tapId, teamName, sentReason, reasons, send }: {
  tapId: string; teamName: string; sentReason: string | null; reasons: RefereeView['reasons']; send(cmd: object): Promise<Ack>;
}) {
  const [reasonId, setReasonId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = `pen-${tapId}`;
  const sentName = reasons.find((r) => r.id === sentReason)?.name;
  const label = (r: RefereeView['reasons'][number]) => (r.kind === 'dq' ? 'DQ' : `+${(r.amountMs ?? 0) / 1000}s`);
  return (
    <section class="card ref-note" role="region" aria-labelledby={titleId}>
      <h3 id={titleId} class="headline">Penalty for {teamName}</h3>
      {sentReason ? (
        <p class="callout" style={{ color: 'var(--success)' }}>Sent ✓ — race control will review{sentName ? ` (${sentName})` : ''}.</p>
      ) : (
        <form onSubmit={async (ev) => {
          ev.preventDefault();
          if (!reasonId) return;
          setBusy(true); setError(null);
          try {
            const ack = await send({ type: 'notePenalty', tapId, reasonId, ...(note.trim() ? { note: note.trim() } : {}) });
            if (!ack.ok) setError(ack.message ?? 'Could not send.');
          } catch { setError('Not connected — try again in a moment.'); } finally { setBusy(false); }
        }}>
          <div class="ref-reasons" role="group" aria-label="Reason">
            {reasons.map((r) => (
              <button key={r.id} type="button" class="chip-button" aria-pressed={reasonId === r.id ? 'true' : 'false'}
                aria-label={r.name} onClick={() => setReasonId(r.id)}>
                <span>{r.name}</span><span class="footnote secondary">{label(r)}</span>
              </button>
            ))}
          </div>
          <label class="footnote secondary" for={`${titleId}-note`}>Note (optional)</label>
          <textarea id={`${titleId}-note`} class="input" rows={2} maxLength={200} value={note}
            onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)} />
          {error && <p class="footnote" role="alert" style={{ color: 'var(--danger)' }}>{error}</p>}
          <Button type="submit" busy={busy} disabled={!reasonId}>Send to race control</Button>
        </form>
      )}
    </section>
  );
}
