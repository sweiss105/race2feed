import { useEffect, useRef, useState } from 'preact/hooks';
import type { ControlView } from '../../../lib/types';
import { Button } from '../../../ui/Button';
import { Sheet } from '../../../ui/Sheet';
import { CONTROL_API, getJson, type ApiBase } from '../../../lib/api';
import { useRunner } from '../runner';

interface EventRow { id: string; name: string; date: string; active: boolean; ended?: boolean }

/** Rounds of the active event not yet finished. */
function roundsLeft(view: ControlView | null): number {
  if (!view) return 0;
  const raced = view.round.phase === 'finished' ? view.round.current : Math.max(0, view.round.current - 1);
  return Math.max(0, view.rounds.length - raced);
}

/** The Events panel on Settings: create, activate, end, export and delete events. */
export function Events({ view, api = CONTROL_API }: { view: ControlView | null; api?: ApiBase }) {
  const runner = useRunner();
  const [events, setEvents] = useState<EventRow[]>([]);
  const [name, setName] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  // Starts empty so an event is never created with a table count nobody chose.
  const [tables, setTables] = useState('');
  const tablesOk = Number.isInteger(Number(tables)) && Number(tables) >= 1 && Number(tables) <= 99;
  const [confirm, setConfirm] = useState<{ kind: 'end' | 'reopen' | 'delete'; event: EventRow } | null>(null);
  const load = () => void getJson<EventRow[]>(api, '/events').then((e) => setEvents(e ?? [])).catch(() => {});
  useEffect(load, []);

  const activate = async (ev: EventRow) => { await runner.run({ type: 'activateEvent', eventId: ev.id }, `activate-${ev.id}`); load(); };
  const left = roundsLeft(view);
  const undecided = view?.penaltyReviews.filter((r) => r.status === 'pending').length ?? 0;
  // Folded away while an event is active, open when none is. Decided on mount and again only when
  // the console gains or loses its active event, so a view update never shuts it under the user.
  const hasEvent = view !== null;
  const [open, setOpen] = useState(!hasEvent);
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    setOpen(!hasEvent);
  }, [hasEvent]);

  return (
    <>
      <details class="panel card events-panel" open={open} aria-labelledby="events-heading">
        <summary onClick={(e) => { e.preventDefault(); setOpen(!open); }}>
          <h3 id="events-heading" class="headline">Events</h3>
          {view && <span class="footnote secondary">Active: {view.event.name}</span>}
        </summary>
        <div class="stack">
          <form class="race-actions" onSubmit={async (e) => {
            e.preventDefault();
            const ack = await runner.run({ type: 'createEvent', name, date, tableCount: Number(tables) }, 'createEvent');
            if (ack?.ok) { setName(''); setTables(''); load(); }
          }}>
            <label class="field" style={{ flex: 2 }}>
              <span class="field-label">Event name</span>
              <input class="input" placeholder="e.g. Race to Feed 2027" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
            </label>
            <label class="field" style={{ flex: 1 }}>
              <span class="field-label">Date</span>
              <input class="input" type="date" value={date} onInput={(e) => setDate((e.target as HTMLInputElement).value)} />
            </label>
            <label class="field" style={{ width: '7rem' }}>
              <span class="field-label">Tables</span>
              <input class="input" type="number" min={1} max={99} value={tables} onInput={(e) => setTables((e.target as HTMLInputElement).value)} />
            </label>
            <Button type="submit" busy={runner.busy('createEvent')} disabled={!name.trim() || !tablesOk}>Create event</Button>
            {runner.error('createEvent') && <span class="err">{runner.error('createEvent')}</span>}
          </form>
          <p class="footnote secondary" style={{ margin: 0 }}>Tables: how many packing tables the venue has, which is how many teams can race at once. You can change it later in Setup, until setup is locked.</p>
          <div>
            <table class="table">
              <thead><tr><th>Event</th><th>Date</th><th /></tr></thead>
              <tbody>
                {events.map((ev) => (
                  <tr key={ev.id}>
                    <td class="headline">
                      {ev.name} {ev.active && <span class="pill running">Active</span>}
                      {ev.ended && <span class="pill finished">Ended</span>}
                    </td>
                    <td class="secondary">{ev.date}</td>
                    <td><div class="actions">
                      {!ev.active && <Button kind="secondary" busy={runner.busy(`activate-${ev.id}`)}
                        onClick={() => (ev.ended ? setConfirm({ kind: 'reopen', event: ev }) : void activate(ev))}>Make active</Button>}
                      {ev.active && <Button kind="destructive" onClick={() => setConfirm({ kind: 'end', event: ev })}>End event</Button>}
                      <a class="btn btn-plain" href={`${api}/export?event=${ev.id}&format=csv`}>CSV</a>
                      <a class="btn btn-plain" href={`${api}/export?event=${ev.id}&format=json`}>JSON</a>
                      <a class="btn btn-plain" href={`${api}/export?event=${ev.id}&format=fairness`}>Fairness report</a>
                      {!ev.active && <Button kind="plain" style={{ color: 'var(--danger)' }}
                        onClick={() => { runner.clear(['deleteEvent']); setConfirm({ kind: 'delete', event: ev }); }}>Delete</Button>}
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {runner.error('endEvent') && <p class="err">{runner.error('endEvent')}</p>}
          </div>
        </div>
      </details>

        {confirm?.kind === 'end' && (
          <Sheet title={`End ${confirm.event.name}?`} onClose={() => setConfirm(null)}>
            {left > 0 && <p class="callout" style={{ color: 'var(--danger)' }}><strong>{left} round{left === 1 ? '' : 's'} not raced yet.</strong></p>}
            {undecided > 0 && (
              <p class="callout" style={{ color: 'var(--danger)' }}>
                <strong>{undecided} penalt{undecided === 1 ? 'y is' : 'ies are'} still waiting for a decision.</strong> {undecided === 1 ? 'It stays' : 'They stay'} “under review” in the final results; decide {undecided === 1 ? 'it' : 'them'} on the Race Control page first.
              </p>
            )}
            <p class="callout">Results are locked, referee devices are signed out, and phones and the projector keep showing the champion and final results until another event is made active.</p>
            <p class="footnote secondary">You can reopen it later with Make active.</p>
            <div class="sheet-actions">
              <Button kind="secondary" onClick={() => setConfirm(null)}>Cancel</Button>
              <Button kind="destructive" busy={runner.busy('endEvent')} onClick={async () => {
                const ack = await runner.run({ type: 'endEvent', eventId: confirm.event.id });
                setConfirm(null);
                if (ack?.ok) load();
              }}>End event</Button>
            </div>
          </Sheet>
        )}
        {confirm?.kind === 'reopen' && (
          <Sheet title={`Reopen ${confirm.event.name}?`} onClose={() => setConfirm(null)}>
            <p class="callout">It becomes the active event again and its results can be changed. Referee devices need to be paired again.</p>
            <div class="sheet-actions">
              <Button kind="secondary" onClick={() => setConfirm(null)}>Cancel</Button>
              <Button busy={runner.busy(`activate-${confirm.event.id}`)} onClick={async () => { const ev = confirm.event; setConfirm(null); await activate(ev); }}>Reopen</Button>
            </div>
          </Sheet>
        )}
        {confirm?.kind === 'delete' && (
          <DeleteSheet event={confirm.event} api={api} onClose={() => setConfirm(null)} onDeleted={() => { setConfirm(null); load(); }} />
        )}
    </>
  );
}

/** Asks for the event's name, typed exactly, before deleting it for good. */
function DeleteSheet({ event, api, onClose, onDeleted }: { event: EventRow; api: ApiBase; onClose(): void; onDeleted(): void }) {
  const runner = useRunner();
  const [typed, setTyped] = useState('');
  const matches = typed.trim() === event.name;
  return (
    <Sheet title={`Delete ${event.name}?`} onClose={onClose}>
      <p class="callout">This permanently removes the event, its teams, results and log. It cannot be undone. Download the CSV or JSON first if you want a copy.</p>
      <div class="actions">
        <a class="btn btn-plain" href={`${api}/export?event=${event.id}&format=csv`}>CSV</a>
        <a class="btn btn-plain" href={`${api}/export?event=${event.id}&format=json`}>JSON</a>
        <a class="btn btn-plain" href={`${api}/export?event=${event.id}&format=fairness`}>Fairness report</a>
      </div>
      <label class="field">
        <span class="footnote secondary">Type the event's name to confirm</span>
        <input class="input" aria-label="Type the event's name to confirm" placeholder={event.name} autoComplete="off" value={typed}
          onInput={(e) => setTyped((e.target as HTMLInputElement).value)} />
      </label>
      {runner.error('deleteEvent') && <p class="err">{runner.error('deleteEvent')}</p>}
      <div class="sheet-actions">
        <Button kind="secondary" onClick={onClose}>Cancel</Button>
        <Button kind="destructive" busy={runner.busy('deleteEvent')} disabled={!matches} onClick={async () => {
          const ack = await runner.run({ type: 'deleteEvent', eventId: event.id, confirmName: typed.trim() });
          if (ack?.ok) onDeleted();
        }}>Delete event</Button>
      </div>
    </Sheet>
  );
}
