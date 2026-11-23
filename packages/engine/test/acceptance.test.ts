import { describe, it, expect } from 'vitest';
import fixture from './fixtures/previous-event.json';
import { suggestBracketPlan } from '../src/brackets';
import { buildRoundPlan } from '../src/schedule';
import { deriveEvent } from '../src/event';
import { parseClockTime } from '../src/time';
import type { EntryResult, EventInput, EventProgress, Team } from '../src/types';

const finished = (rawMs: number): EntryResult => ({ status: 'finished', rawMs, penaltiesMs: 0 });

const teams: Team[] = fixture.teams.map((t, i) => ({ id: `t${i}`, name: t.name, categoryId: t.category, order: i }));
const idOf = new Map(teams.map((t) => [t.name, t.id]));
const nameOf = (id: string | null) => teams.find((t) => t.id === id)?.name ?? null;
const categories = fixture.categories.map((name) => ({ id: name, name }));

const groupIds = ['A', 'B'];
const input: EventInput = {
  tableCount: fixture.tableCount,
  categories,
  teams,
  groups: groupIds.map((g) => ({
    id: g,
    teamIds: fixture.teams
      .map((t, i) => ({ t, id: `t${i}` }))
      .filter(({ t }) => t.group === g)
      .sort((a, b) => a.t.table - b.t.table)
      .map(({ id }) => id),
  })),
  tableOf: Object.fromEntries(fixture.teams.map((t, i) => [`t${i}`, t.table])),
  brackets: suggestBracketPlan(categories, teams),
  grandChampionship: true,
};

// Rounds 1–4: A run 1, B run 1, A run 2, B run 2. Rounds 5–9: synthetic times from recorded places.
const results: EventProgress['results'] = {};
const seedingRound = { A: [1, 3], B: [2, 4] } as const;
fixture.teams.forEach((t, i) => {
  const [r1, r2] = seedingRound[t.group as 'A' | 'B'];
  (results[r1] ??= {})[`t${i}`] = finished(parseClockTime(t.run1));
  (results[r2] ??= {})[`t${i}`] = finished(parseClockTime(t.run2));
});
for (const { round, rows } of fixture.bracketRounds) {
  results[round] = Object.fromEntries(rows.map((row) => [idOf.get(row.team)!, finished(200_000 + row.place * 5_000)]));
}

const ev = deriveEvent(input, { finishedRounds: 9, results, tieDecisions: {} });

describe('acceptance: previous event', () => {
  it('has the same round structure', () => {
    expect(buildRoundPlan(input).map((r) => r.kind)).toEqual([
      'seeding', 'seeding', 'seeding', 'seeding', 'heats', 'heats', 'placement', 'placement', 'grand',
    ]);
  });

  it('reproduces every seeding rank', () => {
    fixture.teams.forEach((t, i) => expect([t.name, ev.seedRank?.[`t${i}`]]).toEqual([t.name, t.expectedSeedRank]));
  });

  it.each([5, 6, 7, 8])('reproduces round %i table assignments', (round) => {
    const derived = ev.rounds[round - 1]!.races
      .flatMap((r) => r.entrants)
      .sort((a, b) => a.table - b.table)
      .map((e) => [e.table, nameOf(e.teamId)]);
    const expected = fixture.bracketRounds
      .find((r) => r.round === round)!
      .rows.map((row) => [row.table, row.team]);
    expect(derived).toEqual(expected);
  });

  it('reproduces the final standings', () => {
    for (const c of fixture.categories) {
      expect(ev.standings[c]!.map(nameOf)).toEqual(fixture.expectedStandings[c as keyof typeof fixture.expectedStandings]);
    }
  });

  it('crowns the same Grand Champion with nothing blocking', () => {
    expect(nameOf(ev.grandChampion)).toBe(fixture.expectedGrandChampion);
    expect(ev.blockers).toEqual([]);
  });
});
