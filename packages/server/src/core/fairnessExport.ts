import { formatMs } from '@race2feed/engine';
import type { LiveEvent } from './model';
import { cell } from './export';
import { fairnessWarnings } from './fairness';
import { derive } from './results';

const iso = (ms: number) => new Date(ms).toISOString();

/**
 * The fairness report: three sections in one CSV file, each a title line, a header row, its rows and a blank line.
 * 1. Warnings: every fairness warning that applies, open or dismissed (with who dismissed it, when and the note).
 * 2. Race control edits: every result or penalty entered, changed, removed or rejected at the console, in time order.
 * 3. Referee assignments: one row per referee per round with saved assignments (rotation on), by round then station.
 * Times are ISO 8601, UTC. Lists inside a cell are joined with "; ".
 */
export function fairnessCsv(e: LiveEvent): string {
  const d = derive(e);
  const names = new Map(e.setup.teams.map((t) => [t.id, t.name]));
  const team = (id: string) => names.get(id) ?? id;
  const row = (cells: unknown[]) => cells.map(cell).join(',');

  const warnings = fairnessWarnings(e, d).map((w) => {
    const dismissal = e.dismissed && Object.hasOwn(e.dismissed, w.id) ? e.dismissed[w.id] : undefined;
    return row([w.kind, w.round, w.referee, w.teamIds.map(team).join('; '), w.message,
      dismissal ? 'dismissed' : 'open', dismissal?.by, dismissal ? iso(dismissal.at) : null, dismissal?.note]);
  });

  const edits: { at: number; by: string | undefined; round: number; teamId: string; change: string }[] = [];
  for (const o of e.overrides) {
    const change = o.set.kind === 'clear' ? 'cleared' : o.set.kind === 'status' ? o.set.status.toUpperCase() : `time ${formatMs(o.set.rawMs, 'hundredths')}`;
    edits.push({ at: o.at, by: o.by, round: o.round, teamId: o.teamId, change });
  }
  for (const t of e.taps) {
    if (t.kind !== 'penalty') continue;
    const base = { round: t.round, teamId: t.teamId };
    if (t.source === 'control') edits.push({ ...base, at: t.createdAt, by: t.by, change: `penalty added: ${t.review?.reasonName ?? ''}` });
    if (t.review?.status === 'rejected') {
      edits.push({ ...base, at: t.review.decidedAt ?? t.removedAt ?? t.createdAt, by: t.removedBy, change: 'penalty rejected' });
    } else if (t.removedAt !== null && (t.source === 'control' || t.review?.status === 'approved')) {
      // A referee can undo their own penalty only while it awaits review: once approved, only race control removes it.
      edits.push({ ...base, at: t.removedAt, by: t.removedBy, change: 'penalty removed' });
    }
  }
  edits.sort((a, b) => a.at - b.at);

  const assignments = Object.keys(e.assignments ?? {}).map(Number).sort((a, b) => a - b).flatMap((round) => {
    const entrants = d.rounds[round - 1]?.races.flatMap((r) => r.entrants) ?? [];
    return [...(e.assignments?.[round] ?? [])]
      .sort((a, b) => a.station - b.station || (a.tables[0] ?? 0) - (b.tables[0] ?? 0))
      .map((a) => row([round, a.name, a.station, a.tables.join('; '),
        entrants.filter((x) => a.tables.includes(x.table)).sort((x, y) => x.table - y.table).map((x) => team(x.teamId)).join('; ')]));
  });

  return [
    'Warnings',
    'kind,round,referee,teams,message,status,dismissed_by,dismissed_at,note',
    ...warnings,
    '',
    'Race control edits',
    'at,by,round,team,change',
    ...edits.map((x) => row([iso(x.at), x.by, x.round, team(x.teamId), x.change])),
    '',
    'Referee assignments',
    'round,referee,station,tables,teams',
    ...assignments,
    '',
  ].join('\n');
}
