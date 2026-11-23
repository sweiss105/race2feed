import type { LiveEvent, PenaltyReason, PenaltyReview, Tap } from './model';
import { STARTER_REASONS } from './starter';

export { STARTER_REASONS };

export function reasonsOf(e: LiveEvent): PenaltyReason[] {
  return e.penaltyReasons ?? STARTER_REASONS;
}

/** Penalty taps stored before reviews existed count as approved. */
export function reviewOf(t: Tap): PenaltyReview {
  return t.review ?? { status: 'approved' };
}

export function validateReasons(reasons: unknown): string[] {
  if (!Array.isArray(reasons) || reasons.length === 0) return ['Add at least one penalty.'];
  const problems: string[] = [];
  const names = new Set<string>();
  const ids = new Set<string>();
  reasons.forEach((r, i) => {
    const row = `Penalty ${i + 1}`;
    if (!r || typeof r !== 'object') return problems.push(`${row}: missing`);
    const { id, name, kind, amountMs } = r as Partial<PenaltyReason>;
    if (typeof id !== 'string' || !id || ids.has(id)) problems.push(`${row}: needs a unique id`);
    else ids.add(id);
    if (typeof name !== 'string' || !name.trim()) problems.push(`${row}: needs a name`);
    else if (name.trim().length > 60) problems.push(`${row}: name is longer than 60 characters`);
    else if (names.has(name.trim().toLowerCase())) problems.push(`${row}: "${name.trim()}" is listed twice`);
    else names.add(name.trim().toLowerCase());
    if (kind !== 'time' && kind !== 'dq') problems.push(`${row}: must be a time penalty or a DQ`);
    if (kind === 'time' && (!Number.isInteger(amountMs) || (amountMs as number) < 0)) problems.push(`${row}: needs a time in whole seconds`);
  });
  return problems;
}
