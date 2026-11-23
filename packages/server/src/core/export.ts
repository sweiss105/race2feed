import { officialMs } from '@race2feed/engine';
import type { LiveEvent } from './model';
import { buildProgress, derive } from './results';
import { reviewOf } from './reasons';

const cell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** One row per team per round, with penalty reasons, DQ reason and referee notes. */
export function eventCsv(e: LiveEvent): string {
  const d = derive(e);
  const progress = buildProgress(e);
  const team = new Map(e.setup.teams.map((t) => [t.id, t]));
  const category = new Map(e.setup.categories.map((c) => [c.id, c.name]));
  const lines = ['round,team,category,table,status,raw_ms,penalties_ms,official_ms,place,penalty_reasons,dq_reason,referee_notes'];
  for (const r of d.rounds) {
    for (const race of r.races) {
      for (const { teamId, table } of race.entrants) {
        const res = progress.results[r.spec.round]?.[teamId];
        const t = team.get(teamId);
        const pens = e.taps.filter((x) => x.kind === 'penalty' && x.round === r.spec.round && x.teamId === teamId);
        const active = pens.filter((x) => x.removedAt === null).map((x) => ({ tap: x, review: reviewOf(x) }));
        const reasons = active.filter((p) => p.review.status === 'approved' && !p.review.dq && p.review.reasonName).map((p) => p.review.reasonName);
        const dq = active.find((p) => p.review.status === 'approved' && p.review.dq)?.review.reasonName ?? '';
        const notes = pens.map((x) => reviewOf(x).refereeNote).filter(Boolean);
        lines.push([r.spec.round, t?.name, category.get(t?.categoryId ?? ''), table, res?.status ?? 'pending',
          res?.rawMs, res?.penaltiesMs, res ? officialMs(res) : null, res ? race.ranking.order.indexOf(teamId) + 1 : null,
          reasons.join('; '), dq, notes.join('; ')].map(cell).join(','));
      }
    }
  }
  return lines.join('\n');
}
