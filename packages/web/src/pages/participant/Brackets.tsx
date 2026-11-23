import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import './brackets.css';
import type { PublicView } from '../../lib/types';
import { buildBracketCards, buildBracketDiagram, type BracketCard, type BracketRace } from '../../lib/bracketModel';
import { tierOf } from '../../lib/selectors';
import { timeText } from '../../ui/Time';

const VIEW_KEY = 'r2f.bracketView';
type View = 'cards' | 'diagram';

export function Brackets({ state, teamId, storage }: { state: PublicView; teamId: string | null; storage: Storage }) {
  const [view, setView] = useState<View>(() => {
    try { return storage.getItem(VIEW_KEY) === 'diagram' ? 'diagram' : 'cards'; } catch { return 'cards'; }
  });
  const cards = useMemo(() => buildBracketCards(state), [state]);
  const choose = (v: View) => {
    try { storage.setItem(VIEW_KEY, v); } catch { /* ignore */ }
    setView(v);
  };

  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const mine = rootRef.current?.querySelector('[data-mine="true"]');
    if (mine && 'scrollIntoView' in mine) {
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      (mine as HTMLElement).scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
    }
  }, [teamId, view]);

  if (cards.every((c) => c.brackets.every((b) => b.stages.length === 0))) {
    return <p class="secondary callout">Brackets appear once seeding is done and the first bracket round opens.</p>;
  }

  return (
    <div ref={rootRef}>
      <div class="brackets-toolbar">
        <nav class="segmented" role="tablist" aria-label="Bracket view">
          <button role="tab" aria-selected={view === 'cards' ? 'true' : 'false'} onClick={() => choose('cards')}>Cards</button>
          <button role="tab" aria-selected={view === 'diagram' ? 'true' : 'false'} onClick={() => choose('diagram')}>Diagram</button>
        </nav>
      </div>
      {cards.map((c) => (
        <section key={c.categoryId}>
          <h3 class="title-2 cat-title">{c.categoryName}</h3>
          {c.brackets.filter((b) => b.stages.length).map((b) => (
            view === 'cards'
              ? <BracketCardView key={b.bracketId} card={b} teamId={teamId} />
              : <BracketDiagramView key={b.bracketId} card={b} teamId={teamId} />
          ))}
        </section>
      ))}
    </div>
  );
}

const hasTeam = (card: BracketCard, teamId: string | null) =>
  teamId !== null && card.stages.some((s) => s.races.some((r) => r.entrants.some((x) => x.teamId === teamId)));

export function BracketCardView({ card, teamId }: { card: BracketCard; teamId: string | null }) {
  return (
    <article class={`card bracket-card ${tierOf(card.tierIndex)}`} data-mine={hasTeam(card, teamId) ? 'true' : undefined}>
      <h4 class="headline"><span class="tier-chip" aria-hidden="true" />{card.tierName}</h4>
      {card.stages.map((s) => (
        <div key={s.title}>
          <h5 class="caption secondary stage-title">{s.title}</h5>
          {s.races.map((r) => <RaceBox key={r.id} race={r} teamId={teamId} showLabel={s.races.length > 1} />)}
        </div>
      ))}
    </article>
  );
}

export function BracketDiagramView({ card, teamId }: { card: BracketCard; teamId: string | null }) {
  const diagram = buildBracketDiagram(card);
  return (
    <article class={`card bracket-card ${tierOf(card.tierIndex)}`} data-mine={hasTeam(card, teamId) ? 'true' : undefined}>
      <h4 class="headline"><span class="tier-chip" aria-hidden="true" />{card.tierName}</h4>
      <div class="bracket-diagram">
        {diagram.columns.map((col) => (
          <div class="col" key={col.title}>
            <h5 class="caption secondary stage-title">{col.title}</h5>
            {col.groups.map((r) => <RaceBox key={r.id} race={r} teamId={teamId} showLabel={col.groups.length > 1} />)}
          </div>
        ))}
      </div>
    </article>
  );
}

function RaceBox({ race, teamId, showLabel }: { race: BracketRace; teamId: string | null; showLabel: boolean }) {
  return (
    <div class="race">
      {showLabel && <div class="caption secondary race-label">{race.label}</div>}
      {race.entrants.map((x) => {
        const mine = x.teamId === teamId;
        return (
          <div key={x.teamId} class={`race-row${mine ? ' me' : ''}`} aria-current={mine ? 'true' : undefined}>
            <span class="place">{x.place ?? (x.table !== null ? `T${x.table}` : '')}</span>
            <span class="callout" style={{ fontWeight: x.place === 1 ? 600 : 400 }}>{x.name}</span>
            <span class="footnote secondary tabular">{x.table === null ? '' : timeText(x)}</span>
          </div>
        );
      })}
    </div>
  );
}
