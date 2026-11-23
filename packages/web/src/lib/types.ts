import type { publicView, publicRoundUpdate, refereeView, controlView } from '../../../server/src/core/views';

export type PublicView = ReturnType<typeof publicView>;
export type RoundUpdate = ReturnType<typeof publicRoundUpdate>;
export type RefereeView = ReturnType<typeof refereeView>;
export type ControlView = ReturnType<typeof controlView>;
export type PublicRace = PublicView['rounds'][number]['races'][number];
export type PublicEntrant = PublicRace['entrants'][number];

export interface Ack { ok: boolean; code?: string; message?: string; detail?: unknown; reply?: unknown }

export type ServerMessage =
  | { type: 'snapshot'; view: PublicView | null }
  | { type: 'round'; update: RoundUpdate }
  | { type: 'view'; view: unknown }
  | ({ type: 'ack'; id: string } & Ack)
  | { type: 'pong'; t0: number; t1: number };
