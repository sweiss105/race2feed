import { formatMs } from '@race2feed/engine';
import type { PublicEntrant } from '../lib/types';

type Timed = Pick<PublicEntrant, 'officialMs' | 'penaltiesMs'> & { status: string }
  & Partial<Pick<PublicEntrant, 'penaltyNotes' | 'penaltyPending' | 'dq'>>;

/**
 * "3:46.20 (incl. +15s · Started early)", with " · pending: under review" appended while a penalty awaits race control, "DQ · Unsafe conduct", "DNF", "DNS" or an em dash while pending.
 * `short` drops the reasons for the projector: "3:46.20 (+15s)" or "DQ".
 */
export function timeText(x: Timed, { short = false } = {}): string {
  if (x.dq) return short ? 'DQ' : `DQ · ${x.dq}`;
  if (x.status === 'dnf') return 'DNF';
  if (x.status === 'dns') return 'DNS';
  if (x.officialMs === null) return '—';
  const base = formatMs(x.officialMs, 'hundredths');
  const pending = x.penaltyPending ? (short ? ' · under review' : ' · pending: under review') : '';
  if (!x.penaltiesMs) return base + pending;
  const amount = `+${x.penaltiesMs / 1000}s`;
  if (short) return `${base} (${amount})${pending}`;
  return `${base} (incl. ${[amount, ...(x.penaltyNotes ?? [])].join(' · ')})${pending}`;
}

export function Time({ entrant }: { entrant: Timed }) {
  return <span class="tabular">{timeText(entrant)}</span>;
}

/** One seeding run's time; struck through, with "not counted" for screen readers, when the seeding rule leaves it out. */
export function RunTime({ ms, counted }: { ms: number | null; counted: boolean }) {
  if (ms === null) return <span class="tabular run">—</span>;
  const text = formatMs(ms, 'hundredths');
  return counted
    ? <span class="tabular run">{text}</span>
    : <s class="tabular run">{text}<span class="visually-hidden"> not counted</span></s>;
}
