import { describe, it, expect } from 'vitest';
import { buildRoundPlan } from '../src/schedule';
import { deriveEvent } from '../src/event';
import type { EventInput, EventProgress, SavedRace } from '../src/types';
import { makeEvent, fin, previousEvent } from './helpers/events';

const entrants = (ev: ReturnType<typeof deriveEvent>, round: number) =>
  ev.rounds[round - 1]!.races.map((r) => r.entrants.map((e) => [e.teamId, e.table]));
const teamsOf = (ev: ReturnType<typeof deriveEvent>, round: number) =>
  ev.rounds[round - 1]!.races.map((r) => r.entrants.map((e) => e.teamId));

/** Seeding results where team index i runs 60 + i seconds in both runs. */
function seeding(input: EventInput): EventProgress['results'] {
  const results: EventProgress['results'] = { 1: {}, 2: {} };
  input.teams.forEach((t, i) => {
    results[1]![t.id] = fin(60 + i);
    results[2]![t.id] = fin(60 + i);
  });
  return results;
}

// One category 'c' of four teams (T1–T4 = c0–c3) on 4 tables, grand off.
// Rounds: 1–2 seeding, 3 heats, 4 placement.
describe('deriveEvent with saved line-ups', () => {
  const input = makeEvent([['c', 4]], 4, false);
  const [T1, T2, T3, T4] = ['c0', 'c1', 'c2', 'c3'] as const;
  const savedHeats: SavedRace[] = [
    { id: 'r3:c:0:heat1', label: 'C Gold · Heat 1', bracketId: 'c:0', role: 'heat', teams: [T1, T4], tables: [1, 2], fallbackOrder: [T1, T2, T3, T4] },
    { id: 'r3:c:0:heat2', label: 'C Gold · Heat 2', bracketId: 'c:0', role: 'heat', teams: [T2, T3], tables: [3, 4], fallbackOrder: [T1, T2, T3, T4] },
  ];
  const corrected = (): EventProgress['results'] => {
    const results = seeding(input);
    results[1]![T4] = { status: 'finished', rawMs: 1_000, penaltiesMs: 0 };
    return results;
  };

  it('reads an opened round from its saved line-up, whatever the results now say', () => {
    const ev = deriveEvent(input, { finishedRounds: 2, results: corrected(), tieDecisions: {}, lineups: { 3: savedHeats } });
    expect(entrants(ev, 3)).toEqual([[[T1, 1], [T4, 2]], [[T2, 3], [T3, 4]]]);
    expect(ev.seedRank?.[T4]).toBe(1);
  });

  it('builds the placement round from the saved heats', () => {
    const results = { ...corrected(), 3: { [T1]: fin(50), [T4]: fin(55), [T2]: fin(51), [T3]: fin(56) } };
    const ev = deriveEvent(input, { finishedRounds: 3, results, tieDecisions: {}, lineups: { 3: savedHeats } });
    expect(teamsOf(ev, 4)).toEqual([[T1, T2], [T4, T3]]);
    expect(ev.rounds[3]!.races.map((r) => r.role)).toEqual(['winners', 'others']);
  });
});

describe('deriveEvent with saved bracket membership', () => {
  // 12 teams c0–c11 (seed order) on 12 tables: Gold 1–4, Silver 5–8, Bronze 9–12.
  // Rounds: 1–2 seeding, 3 lower heats (Bronze), 4 upper heats (Gold, Silver).
  const input = makeEvent([['c', 12]], 12, false);

  it('uses saved bracket membership for brackets whose heats are not open yet', () => {
    expect(buildRoundPlan(input).slice(0, 4).map((r) => [r.kind, 'set' in r ? r.set : null])).toEqual([
      ['seeding', null], ['seeding', null], ['heats', 'lower'], ['heats', 'upper'],
    ]);
    const bracketMembers = {
      'c:0': ['c0', 'c1', 'c2', 'c3'],
      'c:1': ['c4', 'c5', 'c6', 'c7'],
      'c:2': ['c8', 'c9', 'c10', 'c11'],
    };
    const bronze = bracketMembers['c:2'];
    const lineups: Record<number, SavedRace[]> = {
      3: [
        { id: 'r3:c:2:heat1', label: 'C Bronze · Heat 1', bracketId: 'c:2', role: 'heat', teams: ['c8', 'c11'], tables: [1, 2], fallbackOrder: bronze },
        { id: 'r3:c:2:heat2', label: 'C Bronze · Heat 2', bracketId: 'c:2', role: 'heat', teams: ['c9', 'c10'], tables: [3, 4], fallbackOrder: bronze },
      ],
    };
    const results = seeding(input);
    results[1]!['c8'] = fin(65); // c8 (seed 9) now totals less than c7 (seed 8)
    results[3] = { c8: fin(50), c11: fin(51), c9: fin(50), c10: fin(51) };

    const ev = deriveEvent(input, { finishedRounds: 3, results, tieDecisions: {}, lineups, bracketMembers });
    expect([ev.seedRank?.['c8'], ev.seedRank?.['c7']]).toEqual([8, 9]);
    const raced = [...teamsOf(ev, 3), ...teamsOf(ev, 4)].flat().sort();
    expect(raced).toEqual(input.teams.map((t) => t.id).sort());
  });
});

describe('deriveEvent without saved line-ups', () => {
  const { input, results } = previousEvent();

  it('derives exactly as before when nothing is saved', () => {
    const progress: EventProgress = { finishedRounds: 9, results, tieDecisions: {} };
    expect(deriveEvent(input, progress)).toEqual(deriveEvent(input, { ...progress, lineups: {} }));
  });
});
