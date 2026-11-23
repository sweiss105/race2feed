import { formatMs } from '@race2feed/engine';
import type { PublicEntrant } from '../lib/types';

/** "3:46.20 (incl. +5s)", "DNF", "DNS" or an em dash while pending. */
export function timeText(x: Pick<PublicEntrant, 'status' | 'officialMs' | 'penaltiesMs'>): string {
  if (x.status === 'dnf') return 'DNF';
  if (x.status === 'dns') return 'DNS';
  if (x.officialMs === null) return '—';
  const base = formatMs(x.officialMs, 'hundredths');
  return x.penaltiesMs ? `${base} (incl. +${x.penaltiesMs / 1000}s)` : base;
}

export function Time({ entrant }: { entrant: Pick<PublicEntrant, 'status' | 'officialMs' | 'penaltiesMs'> }) {
  return <span class="tabular">{timeText(entrant)}</span>;
}
