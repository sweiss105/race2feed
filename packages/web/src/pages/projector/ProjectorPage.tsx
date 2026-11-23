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
        {rows.map((r) => (
          <div class="row" key={r.teamId}>
            <span class="t">{r.table}</span>
            <span>{r.name}</span>
            <span class="lbl">{r.label}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function Clock({ state, serverNow }: { state: PublicView; serverNow: () => number }) {
  const running = state.round.phase === 'running' && state.round.startedAt !== null;
  const now = useNow(serverNow, running);
  const elapsed = running ? Math.max(0, now - state.round.startedAt!) : 0;
  const finished = (state.rounds[state.round.current - 1]?.races ?? [])
    .flatMap((race) => race.entrants)
    .filter((x) => x.status !== 'pending')
    .sort((a, b) => (a.officialMs ?? Infinity) - (b.officialMs ?? Infinity));
  return (
    <>
      <header><div class="proj-kicker">Round {state.round.current}</div></header>
      <div class="proj-clock">
        <div class="big" data-testid="master-clock">{formatMs(elapsed, 'seconds')}</div>
        <div class="proj-ticker" aria-label="Finished">
          {finished.map((x) => (
            <span class="chip" key={x.teamId}>{teamName(state, x.teamId)} · <span class="tabular">{timeText(x, { short: true })}</span></span>
          ))}
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
