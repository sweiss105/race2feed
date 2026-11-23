import { useEffect, useState } from 'preact/hooks';
import type { ControlView } from '../../../lib/types';
import { Button } from '../../../ui/Button';
import { Sheet } from '../../../ui/Sheet';
import { getJson } from '../../../lib/api';
import { useRunner } from '../runner';

interface EventRow { id: string; name: string; date: string; active: boolean; ended?: boolean }

/** Rounds of the active event not yet finished. */
function roundsLeft(view: ControlView | null): number {
  if (!view) return 0;
  const raced = view.round.phase === 'finished' ? view.round.current : Math.max(0, view.round.current - 1);
  return Math.max(0, view.rounds.length - raced);
}

export function Events({ view }: { view: ControlView | null }) {
  const runner = useRunner();
  const [events, setEvents] = useState<EventRow[]>([]);
  const [name, setName] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [tables, setTables] = useState('26');
  const [confirm, setConfirm] = useState<{ kind: 'end' | 'reopen'; event: EventRow } | null>(null);
  const load = () => void getJson<EventRow[]>('/api/events').then((e) => setEvents(e ?? [])).catch(() => {});
  useEffect(load, []);

  const activate = async (ev: EventRow) => { await runner.run({ type: 'activateEvent', eventId: ev.id }, `activate-${ev.id}`); load(); };
  const left = roundsLeft(view);

  return (
    <>
      <h2 class="title-1">Events</h2>
      <form class="panel card race-actions" onSubmit={async (e) => {
        e.preventDefault();
        const ack = await runner.run({ type: 'createEvent', name, date, tableCount: Number(tables) }, 'createEvent');
        if (ack?.ok) { setName(''); load(); }
      }}>
        <input class="input" style={{ flex: 2 }} aria-label="Event name" placeholder="Event name" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
        <input class="input" style={{ flex: 1 }} type="date" aria-label="Date" value={date} onInput={(e) => setDate((e.target as HTMLInputElement).value)} />
        <input class="input" style={{ width: '6rem' }} type="number" min={1} aria-label="Tables" value={tables} onInput={(e) => setTables((e.target as HTMLInputElement).value)} />
        <Button type="submit" busy={runner.busy('createEvent')} disabled={!name.trim()}>Create event</Button>
        {runner.error('createEvent') && <span class="err">{runner.error('createEvent')}</span>}
      </form>
      <section class="panel">
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
                  <a class="btn btn-plain" href={`/api/export?event=${ev.id}&format=csv`}>CSV</a>
                  <a class="btn btn-plain" href={`/api/export?event=${ev.id}&format=json`}>JSON</a>
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
        {runner.error('endEvent') && <p class="err">{runner.error('endEvent')}</p>}
      </section>

      {confirm?.kind === 'end' && (
        <Sheet title={`End ${confirm.event.name}?`} onClose={() => setConfirm(null)}>
          {left > 0 && <p class="callout" style={{ color: 'var(--danger)' }}><strong>{left} round{left === 1 ? '' : 's'} not raced yet.</strong></p>}
          <p class="callout">Results are locked, referee tablets are signed out, and phones and the projector keep showing the champion and final results until another event is made active.</p>
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
          <p class="callout">It becomes the active event again and its results can be changed. Referee tablets need to be paired again.</p>
          <div class="sheet-actions">
            <Button kind="secondary" onClick={() => setConfirm(null)}>Cancel</Button>
            <Button busy={runner.busy(`activate-${confirm.event.id}`)} onClick={async () => { const ev = confirm.event; setConfirm(null); await activate(ev); }}>Reopen</Button>
          </div>
        </Sheet>
      )}
    </>
  );
}
