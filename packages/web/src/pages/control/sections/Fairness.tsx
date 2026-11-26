import { useState } from 'preact/hooks';
import type { ControlView } from '../../../lib/types';
import { Button } from '../../../ui/Button';
import { useRunner } from '../runner';

type Warning = ControlView['fairness']['open'][number];

/** A short name for each kind of warning; the server's `message` gives the detail. */
const TITLES: Record<Warning['kind'], string> = {
  fast_time: 'Very fast time',
  referee_wins: "One referee's teams keep doing well",
  repeat_team: 'Same referee, same team',
  repeat_penalty: 'Same referee, same team penalised again',
  penalty_outlier: 'Unusual number of penalties',
  close_finish: 'Close finish',
  undo_changed_winner: 'Undo changed the winner',
  final_one_referee: 'Final judged by one referee',
  late_finish: 'Finish arrived late',
};

/** These two look at the whole event, so the round they carry is not when anything happened. */
const WHOLE_EVENT: Warning['kind'][] = ['referee_wins', 'penalty_outlier'];

const where = (w: Warning) =>
  [WHOLE_EVENT.includes(w.kind) ? 'Whole event' : `Round ${w.round}`, ...(w.referee ? [w.referee] : [])].join(' · ');

const when = (at: number) => new Date(at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

/** How many warnings race control has not dismissed yet. */
export const openWarnings = (view: ControlView | null): number => view?.fairness.open.length ?? 0;

/**
 * Patterns the server noticed that race control may want to look at. They never block anything.
 * Shown whenever there is something to list, and always while referees rotate.
 */
export function Fairness({ view }: { view: ControlView }) {
  const { open, dismissed } = view.fairness;
  if (!open.length && !dismissed.length && !view.settings.rotateReferees) return null;
  return (
    <section class="panel" aria-label="Fairness">
      <h3 class="headline">Fairness{open.length > 0 && <span class="count-badge" aria-label={`${open.length} to look at`}>{open.length}</span>}</h3>
      <p class="footnote secondary fairness-intro">These are prompts to take a look, not proof of anything.</p>
      {open.length === 0 && <p class="callout secondary">Nothing to look at.</p>}
      <div class="review-grid">
        {open.map((w) => <WarningCard key={w.id} warning={w} canDismiss={!view.ended} />)}
      </div>
      {dismissed.length > 0 && (
        <details class="review-history">
          <summary class="footnote secondary">Dismissed ({dismissed.length})</summary>
          <ul class="list fairness-dismissed">
            {dismissed.map((w) => (
              <li key={w.id}>
                <span class="callout">{w.message}</span>
                <span class="footnote secondary">{TITLES[w.kind]} · {where(w)}</span>
                <span class="footnote secondary">“{w.dismissal.note}” — {w.dismissal.by}, {when(w.dismissal.at)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function WarningCard({ warning, canDismiss }: { warning: Warning; canDismiss: boolean }) {
  const runner = useRunner();
  const [noting, setNoting] = useState(false);
  const [note, setNote] = useState('');
  const key = `dismiss-${warning.id}`;
  const noteId = `note-${warning.id}`;
  return (
    <div class="card review-card fairness-card">
      <div>
        <div class="headline">{TITLES[warning.kind]}</div>
        <div class="footnote secondary">{where(warning)}</div>
      </div>
      <p class="callout" style={{ margin: 0 }}>{warning.message}</p>
      {canDismiss && !noting && (
        <div class="actions"><Button kind="secondary" onClick={() => setNoting(true)}>Dismiss</Button></div>
      )}
      {canDismiss && noting && (
        <form class="review-card" onSubmit={(ev) => {
          ev.preventDefault();
          if (note.trim()) void runner.run({ type: 'dismissWarning', id: warning.id, note: note.trim() }, key);
        }}>
          <label class="field" for={noteId}>
            <span class="footnote secondary">Note</span>
            <input id={noteId} class="input" maxLength={200} placeholder="What you checked" value={note}
              onInput={(e) => setNote((e.target as HTMLInputElement).value)} />
          </label>
          <div class="actions">
            <Button kind="secondary" onClick={() => { setNoting(false); setNote(''); runner.clear([key]); }}>Cancel</Button>
            <Button type="submit" busy={runner.busy(key)} disabled={!note.trim()}>Save</Button>
          </div>
        </form>
      )}
      {runner.error(key) && <p class="err">{runner.error(key)}</p>}
    </div>
  );
}
