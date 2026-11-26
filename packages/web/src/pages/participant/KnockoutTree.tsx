import './brackets.css';
import { matchOfTeam, SOLO_NOTE, type BracketTree, type TreeMatch, type TreeSlot } from '../../lib/bracketModel';
import { tierOf } from '../../lib/selectors';
import { timeText } from '../../ui/Time';

/**
 * For the tree's CSS: its columns, the matches of its first stage (the tree is that many cells tall), its
 * height in em (a cell is 5.5em; a bracket of four needs room for the third-place race under the final) and its
 * longest team name in characters. The projector sizes its type from these so a bracket of 16 fits the screen.
 */
function treeStyle(tree: BracketTree): Record<string, string> {
  const first = tree.columns[0]?.matches.length ?? 1;
  const names = [...tree.columns.flatMap((c) => c.matches), ...(tree.third ? [tree.third] : [])].flatMap((m) => m.slots.map((s) => s.text.length));
  return {
    '--ko-cols': String(tree.columns.length),
    '--ko-first': String(first),
    '--ko-height': String(Math.max(first * 5.5, tree.third ? 17 : 0) + 2.5),
    '--ko-name-ch': String(Math.max(12, ...names)),
  };
}

/**
 * A knockout bracket as a tournament tree: a column per stage ending with the final, lines from each pair of
 * matches to the match they feed, and the third-place race under the final. `bare` leaves out the card and the
 * tier heading (the projector, which names the bracket in its title).
 */
export function KnockoutTree({ tree, teamId, bare = false }: { tree: BracketTree; teamId: string | null; bare?: boolean }) {
  const current = matchOfTeam(tree, teamId);
  const body = tree.solo ? (
    <div class="ko-solo">
      <div class="ko-match"><Row slot={tree.solo} teamId={teamId} /></div>
      <p class="footnote secondary">{SOLO_NOTE}</p>
    </div>
  ) : (
    <div class="ko-scroll">
      <div class={`ko-tree${tree.third ? ' has-third' : ''}`} style={treeStyle(tree)}>
        {tree.columns.map((col, i) => {
          const last = i === tree.columns.length - 1;
          return (
            <div class="ko-col" key={col.title}>
              <h5 class="caption secondary stage-title">{col.title}</h5>
              <div class="ko-cells">
                {col.matches.map((m) => (
                  <div class={`ko-cell${last ? ' final' : ''}`} key={m.key}>
                    <Match match={m} teamId={teamId} current={m === current} />
                    {last && tree.third && (
                      <div class="ko-third">
                        <div class="caption secondary stage-title">{tree.third.name}</div>
                        <Match match={tree.third} teamId={teamId} current={tree.third === current} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
  if (bare) return body;
  return (
    <article class={`card bracket-card ko-card ${tierOf(tree.tierIndex)}`} aria-label={`${tree.categoryName} ${tree.tierName} bracket`}>
      <h4 class="headline"><span class="tier-chip" aria-hidden="true" />{tree.tierName}</h4>
      {body}
    </article>
  );
}

function Match({ match, teamId, current }: { match: TreeMatch; teamId: string | null; current: boolean }) {
  return (
    <div class={`ko-match${match.bye ? ' bye' : ''}`} role="group" aria-label={match.name || 'Bye'} data-mine={current ? 'true' : undefined}>
      {match.slots.map((slot, i) => <Row key={i} slot={slot} teamId={teamId} />)}
    </div>
  );
}

function Row({ slot, teamId }: { slot: TreeSlot; teamId: string | null }) {
  if (slot.kind !== 'team') return <div class="ko-row wait"><span class="ko-seed" /><span class="ko-name">{slot.text}</span></div>;
  const mine = slot.teamId === teamId;
  return (
    <div class={`ko-row${slot.winner ? ' win' : ''}${mine ? ' me' : ''}`} aria-current={mine ? 'true' : undefined}>
      <span class="ko-seed">{slot.seed}</span>
      <span class="ko-name">{slot.text}</span>
      {slot.entrant && <span class="ko-time tabular">{timeText(slot.entrant, { short: true })}</span>}
    </div>
  );
}
