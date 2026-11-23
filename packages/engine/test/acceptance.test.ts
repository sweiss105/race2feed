import { describe, it, expect } from 'vitest';
import fixture from './fixtures/previous-event.json';
import { buildRoundPlan } from '../src/schedule';
import { deriveEvent } from '../src/event';
import { previousEvent } from './helpers/events';

const { input, results } = previousEvent();
const nameOf = (id: string | null) => input.teams.find((t) => t.id === id)?.name ?? null;

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
