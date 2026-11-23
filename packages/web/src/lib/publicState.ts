import type { PublicView, RoundUpdate } from './types';

export type PublicState = PublicView;

export function applySnapshot(view: PublicView): PublicState {
  return view;
}

/** Merges the small live update into the last full snapshot. */
export function applyRoundUpdate(state: PublicState, update: RoundUpdate): PublicState {
  return {
    ...state,
    round: update.round,
    projector: update.projector,
    seedTotalsMs: update.seedTotalsMs,
    rounds: state.rounds.map((r) => (r.round === update.round.current ? { ...r, races: update.races } : r)),
  };
}
