import { useEffect, useState } from 'preact/hooks';
import { Button } from '../../../ui/Button';
import { getJson } from '../../../lib/api';
import { useRunner } from '../runner';

interface EventRow { id: string; name: string; date: string; active: boolean }

export function Events() {
  const runner = useRunner();
  const [events, setEvents] = useState<EventRow[]>([]);
  const [name, setName] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [tables, setTables] = useState('26');
  const load = () => void getJson<EventRow[]>('/api/events').then((e) => setEvents(e ?? [])).catch(() => {});
  useEffect(load, []);
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
                <td class="headline">{ev.name} {ev.active && <span class="pill running">Active</span>}</td>
                <td class="secondary">{ev.date}</td>
                <td><div class="actions">
                  {!ev.active && <Button kind="secondary" busy={runner.busy(`activate-${ev.id}`)}
                    onClick={async () => { await runner.run({ type: 'activateEvent', eventId: ev.id }, `activate-${ev.id}`); load(); }}>Make active</Button>}
                  <a class="btn btn-plain" href={`/api/export?event=${ev.id}&format=csv`}>CSV</a>
                  <a class="btn btn-plain" href={`/api/export?event=${ev.id}&format=json`}>JSON</a>
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
