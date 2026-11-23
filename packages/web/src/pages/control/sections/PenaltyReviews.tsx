import { useState } from 'preact/hooks';
import type { ControlView } from '../../../lib/types';
import { Button } from '../../../ui/Button';
import { teamName } from '../../../lib/selectors';
import { useRunner } from '../runner';

type Review = ControlView['penaltyReviews'][number];
type Reason = ControlView['penaltyReasons'][number];

export const reasonLabel = (r: Reason) => `${r.name} (${r.kind === 'dq' ? 'DQ' : `+${(r.amountMs ?? 0) / 1000}s`})`;

/** Referee penalties waiting for race control. The next round cannot open until each is decided. */
export function PenaltyReviews({ view }: { view: ControlView }) {
  const pending = view.penaltyReviews.filter((r) => r.status === 'pending');
  const decided = view.penaltyReviews.filter((r) => r.status !== 'pending');
  if (!pending.length && !decided.length) return null;
  const reasonName = (id: string | null) => view.penaltyReasons.find((r) => r.id === id)?.name ?? null;
  return (
    <section class="panel" aria-label="Penalties to review">
      <h3 class="headline">Penalties to review{pending.length > 0 && <span class="count-badge" aria-label={`${pending.length} waiting`}>{pending.length}</span>}</h3>
      {pending.length === 0 && <p class="callout secondary">All penalties decided.</p>}
      <div class="review-grid">
        {pending.map((r) => <ReviewCard key={r.tapId} review={r} view={view} />)}
      </div>
      {decided.length > 0 && (
        <details class="review-history">
          <summary class="footnote secondary">Decided ({decided.length})</summary>
          <ul class="list">
            {decided.map((r) => (
              <li key={r.tapId}>
                <span class="grow"><span class="headline">{teamName(view, r.teamId)}</span> <span class="footnote secondary">Round {r.round}</span></span>
                <span class={`footnote ${r.status === 'approved' && !r.removed ? '' : 'secondary'}`}>
                  {r.status === 'rejected' ? 'Rejected'
                    : r.removed ? 'Removed'
                    : `Approved · ${r.reasonName ?? reasonName(r.reasonId) ?? (r.dq ? 'DQ' : `+${r.amountMs / 1000}s`)}`}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function ReviewCard({ review, view }: { review: Review; view: ControlView }) {
  const runner = useRunner();
  // Follows the referee's pick (which may arrive after the card appears) until race control chooses.
  const [picked, setReasonId] = useState<string | null>(null);
  const known = (id: string | null) => (id && view.penaltyReasons.some((r) => r.id === id) ? id : null);
  const reasonId = known(picked) ?? known(review.refereeReasonId) ?? '';
  const key = `review-${review.tapId}`;
  const refereeReason = view.penaltyReasons.find((r) => r.id === review.refereeReasonId);
  return (
    <div class="card review-card">
      <div>
        <div class="headline">{teamName(view, review.teamId)}</div>
        <div class="footnote secondary">Round {review.round} · referee gave +{review.amountMs / 1000}s</div>
      </div>
      <p class="callout" style={{ margin: 0 }}>
        {refereeReason ? <>Referee: <strong>{refereeReason.name}</strong></> : <span class="secondary">Waiting for the referee's note…</span>}
        {review.refereeNote && <> — “{review.refereeNote}”</>}
      </p>
      <label class="field">
        <span class="footnote secondary">Penalty</span>
        <select class="input" aria-label="Penalty" value={reasonId} onChange={(e) => setReasonId((e.target as HTMLSelectElement).value)}>
          <option value="" disabled>Choose a penalty…</option>
          {view.penaltyReasons.map((r) => <option key={r.id} value={r.id}>{reasonLabel(r)}</option>)}
        </select>
      </label>
      <div class="actions">
        <Button kind="destructive" busy={runner.busy(`${key}-reject`)}
          onClick={() => void runner.run({ type: 'decidePenalty', tapId: review.tapId, decision: 'reject' }, `${key}-reject`)}>Reject</Button>
        <Button busy={runner.busy(`${key}-approve`)} disabled={!reasonId}
          onClick={() => void runner.run({ type: 'decidePenalty', tapId: review.tapId, decision: 'approve', reasonId }, `${key}-approve`)}>Approve</Button>
      </div>
      {(runner.error(`${key}-approve`) || runner.error(`${key}-reject`)) && <p class="err">{runner.error(`${key}-approve`) ?? runner.error(`${key}-reject`)}</p>}
    </div>
  );
}
