import type { EntryResult, EntryStatus, Ms } from './types';
import { hundredths } from './time';

export interface RaceRanking {
  /** Every team, best first. */
  order: string[];
  /** Groups of finishers sharing a hundredth that tieOrder does not fully cover (a covered group ranks by its members' relative order in tieOrder). */
  ties: string[][];
}

const STATUS_RANK: Record<EntryStatus, number> = { finished: 0, dnf: 1, dns: 2, pending: 3 };

/** Official time = raw time + penalties, for finishers only. */
export function officialMs(r: EntryResult): Ms | null {
  return r.status === 'finished' && r.rawMs !== null ? r.rawMs + r.penaltiesMs : null;
}

export function rankRace(
  entries: { teamId: string; result: EntryResult | undefined }[],
  opts: { fallbackOrder: string[]; tieOrder?: string[] },
): RaceRanking {
  const tieOrder = opts.tieOrder ?? [];
  const rows = entries.map(({ teamId, result }) => {
    const status = result?.status ?? 'pending';
    const ms = result ? officialMs(result) : null;
    return { teamId, statusRank: STATUS_RANK[status], key: ms === null ? null : hundredths(ms) };
  });
  const idx = (list: string[], id: string) => {
    const i = list.indexOf(id);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };

  rows.sort((a, b) => {
    if (a.statusRank !== b.statusRank) return a.statusRank - b.statusRank;
    if (a.key !== null && b.key !== null && a.key !== b.key) return a.key - b.key;
    const ta = idx(tieOrder, a.teamId);
    const tb = idx(tieOrder, b.teamId);
    if (ta !== tb) return ta - tb;
    return idx(opts.fallbackOrder, a.teamId) - idx(opts.fallbackOrder, b.teamId);
  });

  const ties: string[][] = [];
  let i = 0;
  while (i < rows.length) {
    const row = rows[i]!;
    let j = i + 1;
    while (j < rows.length && row.key !== null && rows[j]!.key === row.key) j++;
    if (j - i > 1) {
      const group = rows.slice(i, j).map((r) => r.teamId);
      if (!group.every((id) => tieOrder.includes(id))) ties.push(group);
    }
    i = j;
  }

  return { order: rows.map((r) => r.teamId), ties };
}
