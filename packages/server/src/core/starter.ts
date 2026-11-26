import type { PenaltyReason } from './model';

/** The list every new event starts with (editable by admin). */
export const STARTER_REASONS: PenaltyReason[] = [
  { id: 'fluffing', name: 'Fluffing Bags', kind: 'time', amountMs: 5000 },
  { id: 'false-start', name: 'False Start', kind: 'time', amountMs: 10_000 },
  { id: 'interference', name: 'Interference', kind: 'time', amountMs: 15_000 },
  { id: 'unsafe', name: 'Unsafe Conduct', kind: 'time', amountMs: 30_000 },
];
