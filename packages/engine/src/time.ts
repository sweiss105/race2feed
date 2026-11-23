import type { Ms } from './types';

const CLOCK = /^(\d+):([0-5]\d)(?:\.(\d{2}))?$/;

/** Parses `m:ss` or `m:ss.hh` (minutes may exceed 59) into milliseconds. */
export function parseClockTime(text: string): Ms {
  const m = CLOCK.exec(text.trim());
  if (!m) throw new Error(`Invalid time: ${text}`);
  const [, min, sec, hh] = m;
  return (Number(min) * 60 + Number(sec)) * 1000 + (hh ? Number(hh) * 10 : 0);
}

/** Formats milliseconds as `m:ss` or `m:ss.hh`, truncating (never rounding). */
export function formatMs(ms: Ms, precision: 'seconds' | 'hundredths'): string {
  const totalSec = Math.floor(ms / 1000);
  const base = `${Math.floor(totalSec / 60)}:${String(totalSec % 60).padStart(2, '0')}`;
  if (precision === 'seconds') return base;
  return `${base}.${String(Math.floor((ms % 1000) / 10)).padStart(2, '0')}`;
}

/** The comparison unit for race ties. */
export function hundredths(ms: Ms): number {
  return Math.floor(ms / 10);
}
