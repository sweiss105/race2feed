import { formatMs } from '@race2feed/engine';
import type { PublicEntrant } from '../lib/types';

type Timed = Pick<PublicEntrant, 'officialMs' | 'penaltiesMs'> & { status: string }
  & Partial<Pick<PublicEntrant, 'penaltyNotes' | 'penaltyPending' | 'dq'>>;

/**
 * "3:46.20 (incl. +15s · Started early)", "DQ · Unsafe conduct", "DNF", "DNS" or an em dash while pending.
 * `short` drops the reasons for the projector: "3:46.20 (+15s)" or "DQ".
 */
export function timeText(x: Timed, { short = false } = {}): string {
  if (x.dq) return short ? 'DQ' : `DQ · ${x.dq}`;
  if (x.status === 'dnf') return 'DNF';
  if (x.status === 'dns') return 'DNS';
  if (x.officialMs === null) return '—';
  const base = formatMs(x.officialMs, 'hundredths');
  if (!x.penaltiesMs) return base;
  const amount = `+${x.penaltiesMs / 1000}s`;
  if (short) return `${base} (${amount})`;
  const why = [...(x.penaltyNotes ?? []), ...(x.penaltyPending ? ['under review'] : [])];
  return `${base} (incl. ${[amount, ...why].join(' · ')})`;
}

export function Time({ entrant }: { entrant: Timed }) {
  return <span class="tabular">{timeText(entrant)}</span>;
}
