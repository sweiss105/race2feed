import type { PenaltyReason } from './model';

/** The list every new event starts with (editable by admin). */
export const STARTER_REASONS: PenaltyReason[] = [
  { id: 'sealed', name: 'Bag not sealed', kind: 'time', amountMs: 5000 },
  { id: 'count', name: 'Wrong item count', kind: 'time', amountMs: 5000 },
  { id: 'early', name: 'Started early', kind: 'time', amountMs: 10_000 },
  { id: 'unsafe', name: 'Unsafe conduct', kind: 'dq' },
];
