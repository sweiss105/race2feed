import { formatMs } from '@race2feed/engine';
import type { ControlView } from '../../../lib/types';
import { Button } from '../../../ui/Button';
import { teamName } from '../../../lib/selectors';
import { useRunner } from '../runner';

type Held = ControlView['heldFinishes'][number];

const late = (ms: number) => `${Math.round(ms / 1000)} s`;

/**
 * Finish taps that reached the server well after the time the referee's device gave for them. Such a time is
 * the device's word alone, so the team has no result until race control confirms it.
 */
export function HeldFinishes({ view }: { view: ControlView }) {
  const pending = view.heldFinishes.filter((h) => h.status === 'pending');
  const decided = view.heldFinishes.filter((h) => h.status !== 'pending');
  if (!pending.length && !decided.length) return null;
  return (
    <section class="panel" aria-label="Late finishes to confirm">
      <h3 class="headline">Late finishes to confirm{pending.length > 0 && <span class="count-badge" aria-label={`${pending.length} waiting`}>{pending.length}</span>}</h3>
      {pending.length > 0
        ? <p class="footnote secondary">These finish taps arrived well after the time on them, usually because the referee's device was offline. A team has no result until you confirm its time.</p>
        : <p class="callout secondary">All late finishes decided.</p>}
      <div class="review-grid">
        {pending.map((h) => <HeldCard key={h.tapId} held={h} view={view} />)}
      </div>
      {decided.length > 0 && (
        <details class="review-history">
          <summary class="footnote secondary">Decided ({decided.length})</summary>
          <ul class="list">
            {decided.map((h) => (
              <li key={h.tapId}>
                <span class="grow"><span class="headline">{teamName(view, h.teamId)}</span> <span class="footnote secondary">Round {h.round} · {formatMs(h.elapsedMs, 'hundredths')}, {late(h.lateMs)} late</span></span>
                <span class={`footnote ${h.status === 'confirmed' ? '' : 'secondary'}`}>{h.status === 'confirmed' ? 'Confirmed' : 'Rejected'}{h.by && ` · ${h.by}`}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function HeldCard({ held, view }: { held: Held; view: ControlView }) {
  const runner = useRunner();
  const key = `held-${held.tapId}`;
  const name = teamName(view, held.teamId);
  const decide = (decision: 'confirm' | 'reject') => void runner.run({ type: 'decideLateFinish', tapId: held.tapId, decision }, `${key}-${decision}`);
  return (
    <div class="card review-card" data-held={held.teamId}>
      <div>
        <div class="headline">{name}</div>
        <div class="footnote secondary">Round {held.round} · {held.referee ?? 'a referee'}</div>
      </div>
      <p class="callout" style={{ margin: 0 }}>
        Time <strong class="tabular">{formatMs(held.elapsedMs, 'hundredths')}</strong>, received {late(held.lateMs)} after the tap.
      </p>
      <div class="actions">
        <Button kind="destructive" aria-label={`Reject ${name}'s late finish`} busy={runner.busy(`${key}-reject`)} onClick={() => decide('reject')}>Reject</Button>
        <Button aria-label={`Confirm ${name}'s late finish`} busy={runner.busy(`${key}-confirm`)} onClick={() => decide('confirm')}>Confirm</Button>
      </div>
      {(runner.error(`${key}-confirm`) || runner.error(`${key}-reject`)) && <p class="err">{runner.error(`${key}-confirm`) ?? runner.error(`${key}-reject`)}</p>}
    </div>
  );
}
