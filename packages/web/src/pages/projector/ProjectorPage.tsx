import { useEffect, useMemo, useState } from 'preact/hooks';
import './projector.css';
import '../participant/brackets.css';
import { formatMs } from '@race2feed/engine';
import type { PublicView } from '../../lib/types';
import { champions, scheduleRows, teamName, tierOf } from '../../lib/selectors';
import { buildBracketCards } from '../../lib/bracketModel';
import { QR } from '../../ui/QR';
import { timeText } from '../../ui/Time';
import { useNow } from '../../lib/useNow';
import { BracketDiagramView } from '../participant/Brackets';

interface Props { state: PublicView; serverNow: () => number; siteUrl: string }

export function ProjectorPage({ state, serverNow, siteUrl }: Props) {
  const screen = state.projector;
  return (
    <div class="proj fade-in" key={screen}>
      {screen === 'welcome' && <Welcome state={state} siteUrl={siteUrl} />}
      {screen === 'tables' && <Tables state={state} siteUrl={siteUrl} />}
      {screen === 'clock' && <Clock state={state} serverNow={serverNow} />}
      {screen === 'seeding-results' && <SeedingResults state={state} />}
      {screen === 'brackets' && <BracketsScreen state={state} />}
      {screen === 'standings' && <Standings state={state} />}
      {screen === 'champion' && <Champion state={state} />}
    </div>
  );
}

const host = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/$/, '');

function Welcome({ state, siteUrl }: { state: PublicView; siteUrl: string }) {
  return (
    <div class="proj-welcome">
      <span class="proj-kicker">Welcome to</span>
      <h1 class="proj-title">{state.event.name}</h1>
      <div class="proj-qr">
        <QR value={siteUrl} size="min(28vh, 22rem)" />
        <div style={{ textAlign: 'left' }}>
          <div class="proj-sub">Find your team, your table and live results</div>
          <div class="url">{host(siteUrl)}</div>
        </div>
      </div>
    </div>
  );
}

function Tables({ state, siteUrl }: { state: PublicView; siteUrl: string }) {
  const rows = scheduleRows(state);
  return (
    <>
      <header class="proj-head">
        <div>
          <div class="proj-kicker">Go to your table</div>
          <h2 class="proj-title">Round {state.round.current}</h2>
        </div>
        <div class="proj-qr"><span class="url">{host(siteUrl)}</span><QR value={siteUrl} size="13vh" /></div>
      </header>
      <div class="proj-body proj-tables">
        {rows.map((r) => <TeamRow key={r.teamId} table={r.table} name={r.name} dot={r.ready ? 'ready' : 'not-ready'} right={r.label} />)}
      </div>
    </>
  );
}

/** The dot beside a team name: waiting on the table (red), table ready (green), racing (green), finished (checkered flag). */
export type DotStatus = 'not-ready' | 'ready' | 'racing' | 'finished';
const DOT_LABEL: Record<DotStatus, string> = { 'not-ready': 'Not ready', ready: 'Ready', racing: 'Racing', finished: 'Finished' };

export function StatusDot({ status }: { status: DotStatus }) {
  // Every marker sits in the same fixed-width slot, so names line up whatever the status.
  return <span class="mark"><span class={`dot ${status}`} role="img" aria-label={DOT_LABEL[status]} /></span>;
}

/** One row of the team list on the tables and clock screens: table, dot and name, and the race label or result. */
function TeamRow({ table, name, dot, right }: { table: number; name: string; dot: DotStatus; right: string }) {
  return (
    <div class="row">
      <span class="t">{table}</span>
      <span class="name"><StatusDot status={dot} />{name}</span>
      <span class="lbl">{right}</span>
    </div>
  );
}

function Clock({ state, serverNow }: { state: PublicView; serverNow: () => number }) {
  const running = state.round.phase === 'running' && state.round.startedAt !== null;
  const now = useNow(serverNow, running);
  const elapsed = running ? Math.max(0, now - state.round.startedAt!) : 0;
  const round = state.round.current;
  const entrants = new Map((state.rounds[round - 1]?.races ?? []).flatMap((race) => race.entrants).map((x) => [x.teamId, x]));
  const anyIn = [...entrants.values()].some((x) => x.status !== 'pending');
  // Once a team is in, the list stays for the rest of the round, even if that result is undone.
  const [listRound, setListRound] = useState<number | null>(null);
  useEffect(() => { if (anyIn && listRound !== round) setListRound(round); }, [anyIn, round, listRound]);
  const withList = anyIn || listRound === round;
  // A finished team (DNF, DNS and DQ included) shows its result. Order: times fastest first, then DNF (and DQ), then DNS,
  // then teams still racing; ties and each group by table. Keyed by team so rows move rather than being re-created.
  const rows = withList ? scheduleRows(state).map((r) => {
    const x = entrants.get(r.teamId);
    const done = Boolean(x && (x.status !== 'pending' || x.dq));
    const group = !x || !done ? 3 : x.dq || x.status === 'dnf' ? 1 : x.status === 'dns' ? 2 : 0;
    return {
      ...r, group, ms: group === 0 ? x!.officialMs ?? Infinity : 0,
      dot: (done ? 'finished' : 'racing') as DotStatus, right: done ? timeText(x!, { short: true }) : r.label,
    };
  }).sort((a, b) => a.group - b.group || a.ms - b.ms || a.table - b.table) : [];
  return (
    <>
      <header><div class="proj-kicker">Round {round}</div></header>
      {/* One element for both layouts: a class change animates the clock up and smaller without remounting it. */}
      <div class={`proj-clock${withList ? ' with-list' : ''}`}>
        <div class="big" data-testid="master-clock">{formatMs(elapsed, 'seconds')}</div>
        <div class="proj-race">
          {withList && (
            <>
              <h3 class="proj-kicker">Preliminary times</h3>
              <div class="proj-tables proj-race-list" aria-label="Teams">
                {rows.map((r) => <TeamRow key={r.teamId} table={r.table} name={r.name} dot={r.dot} right={r.right} />)}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

function SeedingResults({ state }: { state: PublicView }) {
  const tierFor = (categoryId: string, rank: number) =>
    state.brackets.find((b) => b.categoryId === categoryId && rank >= b.firstSeed && rank < b.firstSeed + b.size)?.tierIndex ?? -1;
  return (
    <>
      <header>
        <div class="proj-kicker">After the seeding rounds</div>
        <h2 class="proj-title">Seeding results</h2>
      </header>
      <div class="proj-body proj-columns">
        {state.categories.map((c) => {
          const teams = state.teams.filter((t) => t.categoryId === c.id && state.seedTotalsMs[t.id] !== undefined)
            .sort((a, b) => (state.seedRank?.[a.id] ?? 0) - (state.seedRank?.[b.id] ?? 0)
              || (state.seedTotalsMs[a.id] ?? 0) - (state.seedTotalsMs[b.id] ?? 0));
          return (
            <section key={c.id}>
              <h3>{c.name}</h3>
              {teams.map((t, i) => {
                const rank = state.seedRank?.[t.id] ?? i + 1;
                return (
                  <div class={`row ${state.seedRank ? tierOf(tierFor(c.id, rank)) : ''}`} key={t.id}>
                    <span class="n">{rank}</span>
                    <span>{t.name}</span>
                    <span class="tabular">{formatMs(state.seedTotalsMs[t.id]!, 'seconds')}</span>
                  </div>
                );
              })}
            </section>
          );
        })}
      </div>
    </>
  );
}

function BracketsScreen({ state }: { state: PublicView }) {
  const cards = useMemo(() => buildBracketCards(state).filter((c) => c.brackets.some((b) => b.stages.length)), [state]);
  const [page, setPage] = useState(0);
  useEffect(() => {
    if (cards.length < 2) return;
    const id = setInterval(() => setPage((p) => (p + 1) % cards.length), 12_000);
    return () => clearInterval(id);
  }, [cards.length]);
  const current = cards[page % Math.max(1, cards.length)];
  return (
    <>
      <header>
        <div class="proj-kicker">Brackets</div>
        <h2 class="proj-title">{current ? `${current.categoryName} Brackets` : 'Brackets'}</h2>
      </header>
      <div class="proj-body proj-brackets fade-in" key={current?.categoryId}>
        {current?.brackets.filter((b) => b.stages.length).map((b) => <BracketDiagramView key={b.bracketId} card={b} teamId={null} />)}
      </div>
    </>
  );
}

function Standings({ state }: { state: PublicView }) {
  const tierFor = (categoryId: string, place: number) =>
    state.brackets.find((b) => b.categoryId === categoryId && place >= b.firstSeed && place < b.firstSeed + b.size)?.tierIndex ?? -1;
  return (
    <>
      <header>
        <div class="proj-kicker">By category</div>
        <h2 class="proj-title">Final standings</h2>
      </header>
      <div class="proj-body proj-columns">
        {state.categories.map((c) => (
          <section key={c.id}>
            <h3>{c.name}</h3>
            {(state.standings[c.id] ?? []).map((id, i) => (
              <div class={`row ${tierOf(tierFor(c.id, i + 1))}`} key={i}>
                <span class="n">{i + 1}</span>
                <span>{id ? teamName(state, id) : '—'}</span>
                <span />
              </div>
            ))}
          </section>
        ))}
      </div>
    </>
  );
}

function Champion({ state }: { state: PublicView }) {
  const winners = champions(state);
  const single = winners.length === 1;
  return (
    <div class="proj-champion">
      <span class="proj-kicker">Congratulations</span>
      {single ? (
        <>
          <h2 class="proj-sub" style={{ margin: 0 }}>{winners[0]!.title}</h2>
          <div class="name">{winners[0]!.name ?? 'To be decided'}</div>
          {winners[0]!.subtitle && <div class="proj-sub">{winners[0]!.subtitle}</div>}
        </>
      ) : (
        <div class="proj-winners">
          {winners.map((w) => (
            <section key={w.key}>
              <h2 class="proj-sub" style={{ margin: 0 }}>{w.title}</h2>
              <div class="name">{w.name ?? 'To be decided'}</div>
            </section>
          ))}
        </div>
      )}
      {state.bagTotal && <div class="bags">{state.bagTotal} bags of food packed!</div>}
    </div>
  );
}
