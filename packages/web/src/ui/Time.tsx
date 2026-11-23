import { formatMs } from '@race2feed/engine';
import type { PublicEntrant } from '../lib/types';

/** "3:46.20 (incl. +5s)", "DNF", "DNS" or an em dash while pending. */
type Timed = Pick<PublicEntrant, 'officialMs' | 'penaltiesMs'> & { status: string };

export function timeText(x: Timed): string {
  if (x.status === 'dnf') return 'DNF';
  if (x.status === 'dns') return 'DNS';
  if (x.officialMs === null) return '—';
  const base = formatMs(x.officialMs, 'hundredths');
  return x.penaltiesMs ? `${base} (incl. +${x.penaltiesMs / 1000}s)` : base;
}

export function Time({ entrant }: { entrant: Timed }) {
  return <span class="tabular">{timeText(entrant)}</span>;
}
