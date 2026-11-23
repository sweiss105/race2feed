import { useEffect, useMemo, useState } from 'preact/hooks';
import './participant.css';
import type { PublicView } from '../../lib/types';
import { nextRaceFor, scheduleRows, seedingRow, teamName, teamResults, teamSearch } from '../../lib/selectors';
import { formatMs } from '@race2feed/engine';
import { Time } from '../../ui/Time';
import { Button } from '../../ui/Button';
import { Brackets } from './Brackets';

const TEAM_KEY = 'r2f.team';
type Tab = 'team' | 'schedule' | 'brackets' | 'results';

function safeGet(storage: Storage, key: string) {
  try { return storage.getItem(key); } catch { return null; }
}

export function ParticipantPage({ state, storage }: { state: PublicView; storage: Storage }) {
  const [teamId, setTeamId] = useState<string | null>(() => safeGet(storage, TEAM_KEY));
  const [tab, setTab] = useState<Tab>('team');

  const known = teamId !== null && state.teams.some((t) => t.id === teamId);
  useEffect(() => {
    if (teamId !== null && !known) {
      try { storage.removeItem(TEAM_KEY); } catch { /* ignore */ }
      setTeamId(null);
    }
  }, [teamId, known, storage]);

  const pick = (id: string | null) => {
    try { id ? storage.setItem(TEAM_KEY, id) : storage.removeItem(TEAM_KEY); } catch { /* ignore */ }
    setTeamId(id);
    setTab('team');
  };

  return (
    <div class="page">
      {!known ? (
        <Search state={state} onPick={pick} />
      ) : (
        <>
          <div class="p-team">
            <h2 class="title-1">{teamName(state, teamId!)}</h2>
            <Button kind="plain" onClick={() => pick(null)}>Not you?</Button>
          </div>
          <NextRaceCard state={state} teamId={teamId!} />
        </>
      )}
      <nav class="segmented" role="tablist" aria-label="Views">
        {([['team', 'My team'], ['schedule', 'Schedule'], ['brackets', 'Brackets'], ['results', 'Results']] as const)
          .filter(([t]) => known || t !== 'team')
          .map(([t, label]) => (
            <button key={t} role="tab" aria-selected={(tab === t || (!known && t === 'schedule' && tab === 'team')) ? 'true' : 'false'} onClick={() => setTab(t)}>{label}</button>
          ))}
      </nav>
      {tab === 'team' && known && <MyTeam state={state} teamId={teamId!} />}
      {(tab === 'schedule' || (tab === 'team' && !known)) && <Schedule state={state} teamId={teamId} />}
      {tab === 'brackets' && <Brackets state={state} teamId={known ? teamId : null} storage={storage} />}
      {tab === 'results' && <Results state={state} teamId={teamId} />}
    </div>
  );
}

function Search({ state, onPick }: { state: PublicView; onPick(id: string): void }) {
  const [q, setQ] = useState('');
  const hits = useMemo(() => teamSearch(state.teams, q), [state.teams, q]);
  const category = (id: string) => state.categories.find((c) => c.id === id)?.name ?? '';
  return (
    <section class="p-hero">
      <h2 class="large-title">Find your team</h2>
      <p class="secondary callout">See your table, your times and where you are in the brackets.</p>
      <div class="p-search" style={{ marginTop: 'var(--space-4)' }}>
        <label class="visually-hidden" for="team-search">Team name</label>
        <input id="team-search" class="input" type="search" role="searchbox" placeholder="Team name" autocomplete="off"
          value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
        {hits.length > 0 && (
          <ul class="p-results">
            {hits.map((t) => (
              <li key={t.id}>
                <button type="button" onClick={() => onPick(t.id)}>
                  <span class="headline">{t.name}</span>
                  <span class="footnote secondary">{category(t.categoryId)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function NextRaceCard({ state, teamId }: { state: PublicView; teamId: string }) {
  const next = nextRaceFor(state, teamId);
  return (
    <section class="card" aria-labelledby="next-race">
      <h3 id="next-race" class="headline">Your next race</h3>
      {next === null ? (
        <p class="callout secondary">All rounds are done. Thanks for racing!</p>
      ) : 'waitingFor' in next ? (
        <p class="callout secondary">Round {next.waitingFor} — your table appears here when it opens.</p>
      ) : (
        <div class="p-next" style={{ marginTop: 'var(--space-3)' }}>
          <span class="footnote secondary table-label">Table</span>
          <span class="table-number" data-testid="next-table">{next.table}</span>
          <div class="details">
            <span class="headline">Round {next.round} · {next.label}</span>
            {next.opponents.length > 0 && <span class="callout secondary">vs {next.opponents.join(', ')}</span>}
            <span><span class={`p-status ${next.status}`}>{next.status === 'upcoming' ? 'Get ready' : next.status === 'racing' ? 'Racing now' : 'Finished'}</span></span>
          </div>
        </div>
      )}
    </section>
  );
}

function MyTeam({ state, teamId }: { state: PublicView; teamId: string }) {
  const seed = seedingRow(state, teamId);
  const results = teamResults(state, teamId).filter((r) => r.me.status !== 'pending');
  return (
    <>
      <h3 class="headline section-title">Seeding</h3>
      <ul class="list">
        <li><span>Rank in category</span><span class="tabular headline">{seed.rank ?? '—'}</span></li>
        <li><span>Total time</span><span class="tabular">{seed.totalMs === null ? '—' : formatMs(seed.totalMs, 'hundredths')}</span></li>
      </ul>
      <h3 class="headline section-title">Races</h3>
      {results.length === 0 ? <p class="secondary callout">No times yet.</p> : (
        <ul class="list">
          {results.map((r) => (
            <li key={r.race.id}>
              <span class="grow"><span class="headline">Round {r.round}</span><br /><span class="footnote secondary">{r.label}</span></span>
              <span style={{ textAlign: 'right' }}>
                <Time entrant={r.me} />
                {r.race.entrants.length > 1 && r.me.place !== null && <><br /><span class="footnote secondary">Place {r.me.place}</span></>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function Schedule({ state, teamId }: { state: PublicView; teamId: string | null }) {
  const rows = scheduleRows(state);
  if (!rows.length) return <p class="secondary callout">Tables are posted when race control opens the next round.</p>;
  return (
    <>
      <h3 class="headline section-title">Round {state.round.current} tables</h3>
      <ul class="list">
        {rows.map((r) => (
          <li key={r.teamId} class={r.teamId === teamId ? 'me' : ''} aria-current={r.teamId === teamId ? 'true' : undefined}>
            <span class="num">{r.table}</span>
            <span class="grow"><span class="headline">{r.name}</span><br /><span class="footnote secondary">{r.label}</span></span>
          </li>
        ))}
      </ul>
    </>
  );
}

function Results({ state, teamId }: { state: PublicView; teamId: string | null }) {
  const raced = state.rounds.filter((r) => r.races.some((race) => race.entrants.some((x) => x.status !== 'pending')));
  const latest = raced.at(-1);
  if (!latest) return <p class="secondary callout">Results appear as teams finish.</p>;
  return (
    <>
      <h3 class="headline section-title">Round {latest.round} results</h3>
      {latest.races.map((race) => (
        <ul class="list" key={race.id} style={{ marginBottom: 'var(--space-3)' }}>
          {[...race.entrants].sort((a, b) => (a.place ?? 99) - (b.place ?? 99)).map((x) => (
            <li key={x.teamId} class={x.teamId === teamId ? 'me' : ''}>
              <span class="num">{x.place ?? ''}</span>
              <span class="grow headline">{teamName(state, x.teamId)}</span>
              <Time entrant={x} />
            </li>
          ))}
        </ul>
      ))}
    </>
  );
}
