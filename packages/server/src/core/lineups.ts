import type { RaceView, SavedRace } from '@race2feed/engine';
import type { LiveEvent } from './model';
import { derive } from './results';

const toSaved = (r: RaceView): SavedRace => ({
  id: r.id,
  label: r.label,
  ...(r.bracketId ? { bracketId: r.bracketId } : {}),
  role: r.role,
  teams: r.entrants.map((x) => x.teamId),
  tables: r.entrants.map((x) => x.table),
  fallbackOrder: r.fallbackOrder,
});

/** The races of `round` as the event would build them now; null when the round cannot be built. */
export function lineupOf(e: LiveEvent, round: number): SavedRace[] | null {
  const view = derive(e).rounds[round - 1];
  return view && view.status !== 'blocked' ? view.races.map(toSaved) : null;
}

/**
 * Saves the races `round` opens with, so later corrections never rebuild it. When the round is
 * past seeding, bracket membership is saved too (once, as it stood when the first bracket round opened).
 */
export function saveLineup(e: LiveEvent, round: number): LiveEvent {
  const d = derive(e);
  const view = d.rounds[round - 1];
  if (!view || view.status === 'blocked') return e;
  const keepMembers = view.spec.kind !== 'seeding' && !e.bracketMembers && d.bracketMembers;
  return {
    ...e,
    lineups: { ...e.lineups, [round]: view.races.map(toSaved) },
    ...(keepMembers ? { bracketMembers: d.bracketMembers! } : {}),
  };
}

/** Saves the line-up of every opened round that has none (events stored before line-ups were saved). */
export function backfillLineups(e: LiveEvent): LiveEvent {
  let out = e;
  for (let round = 1; round <= e.round.current; round++) {
    if (!out.lineups?.[round]) out = saveLineup(out, round);
  }
  return out;
}
