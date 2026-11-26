import { describe, it, expect } from 'vitest';
import { deriveEvent } from '../src/event';
import { makeEvent, progress, seedInOrder, fin, dns } from './helpers/events';

describe('deriveEvent edge cases', () => {
  // One category of 4 on 4 tables: rounds 1–2 seeding, 3 heats, 4 placement.
  const four = makeEvent([['c', 4]], 4, false);
  const seeded = seedInOrder(four, [1, 2]);

  it('an unresolved tie blocks later rounds until decided', () => {
    // Heat 1 is c0 vs c3; both finish within the same hundredth.
    const heats = { 3: { c0: fin(192.401), c3: fin(192.409), c1: fin(200), c2: fin(210) } };
    const blocked = deriveEvent(four, progress(3, { ...seeded, ...heats }));
    expect(blocked.rounds[3]!.status).toBe('blocked');
    expect(blocked.blockers).toEqual(['Round 3: tie in r3:c:0:heat1']);

    const decided = deriveEvent(four, progress(3, { ...seeded, ...heats }, { 'r3:c:0:heat1': ['c3', 'c0'] }));
    expect(decided.rounds[3]!.status).toBe('ready');
    expect(decided.blockers).toEqual([]);
    expect(decided.rounds[3]!.races[0]!.entrants.map((e) => e.teamId)).toEqual(['c3', 'c1']);
  });

  it('a finished round with a missing result is not settled and blocks later rounds', () => {
    // Heat 1 is c0 vs c3; neither has a result (both were cleared after the round finished).
    const heats = { 3: { c1: fin(200), c2: fin(210) } };
    const ev = deriveEvent(four, progress(3, { ...seeded, ...heats }));
    expect(ev.rounds[3]!.status).toBe('blocked');
    expect(ev.blockers).toEqual(['Round 3: c0 and c3 have no result. Enter a time, DNF or DNS.']);
    expect(ev.missing).toEqual([{ round: 3, teamIds: ['c0', 'c3'] }]);

    const pending = { 3: { ...heats[3], c0: { status: 'pending' as const, rawMs: null, penaltiesMs: 0 }, c3: fin(190) } };
    expect(deriveEvent(four, progress(3, { ...seeded, ...pending })).blockers).toEqual(['Round 3: c0 has no result. Enter a time, DNF or DNS.']);

    const entered = deriveEvent(four, progress(3, { ...seeded, 3: { ...heats[3], c0: dns, c3: fin(250) } }));
    expect(entered.blockers).toEqual([]);
    expect(entered.rounds[3]!.races[0]!.entrants.map((e) => e.teamId)).toEqual(['c3', 'c1']);
  });

  it('a missing seeding result blocks the heats; a missing final result leaves the standings undecided', () => {
    const { c2: _cleared, ...run2 } = seeded[2]!;
    const seeding = deriveEvent(four, progress(2, { 1: seeded[1]!, 2: run2 }));
    expect(seeding.rounds[2]!.status).toBe('blocked');
    expect(seeding.blockers).toEqual(['Round 2: c2 has no result. Enter a time, DNF or DNS.']);

    const results = { ...seeded, 3: { c0: fin(200), c3: fin(210), c1: fin(200), c2: fin(210) }, 4: { c1: fin(190), c3: fin(200), c2: fin(200) } };
    const ev = deriveEvent(four, progress(4, results));
    expect(ev.standings.c).toEqual([null, null, null, null]);
    expect(ev.missing).toEqual([{ round: 4, teamIds: ['c0'] }]);
  });

  it('a 3-team category races once and still reaches the Grand Championship', () => {
    // Categories a(4) and b(3) on 8 tables: one seeding group.
    // Rounds: 1–2 seeding, 3 heats (upper: a Gold heats + b Gold final), 4 placement (a only), 5 grand.
    const input = makeEvent([['a', 4], ['b', 3]], 8, true);
    const results = {
      ...seedInOrder(input, [1, 2]),
      3: { a0: fin(200), a3: fin(210), a1: fin(200), a2: fin(210), b2: fin(190), b0: fin(195), b1: fin(199) },
      4: { a0: fin(200), a1: fin(205), a3: fin(200), a2: fin(205) },
      5: { a0: fin(220), b2: fin(210) },
    };
    const ev = deriveEvent(input, progress(5, results));
    expect(ev.rounds[2]!.races.map((r) => r.id)).toContain('r3:b:0:final');
    expect(ev.rounds[3]!.races.some((r) => r.bracketId === 'b:0')).toBe(false);
    expect(ev.standings.b).toEqual(['b2', 'b0', 'b1']);
    expect(ev.rounds[4]!.races[0]!.entrants.map((e) => e.teamId)).toEqual(['a0', 'b2']);
    expect(ev.grandChampion).toBe('b2');
  });

  it('a team that never starts still gets a place, last in its race', () => {
    const results = {
      ...seeded,
      3: { c0: dns, c3: fin(200), c1: fin(200), c2: fin(210) },
      4: { c3: fin(200), c1: fin(190), c0: dns, c2: fin(200) },
    };
    const ev = deriveEvent(four, progress(4, results));
    expect(ev.standings.c).toEqual(['c1', 'c3', 'c2', 'c0']);
  });

  it('standings stay null until the deciding round is locked', () => {
    const heats = { 3: { c0: fin(200), c3: fin(210), c1: fin(200), c2: fin(210) } };
    const live = { 4: { c0: fin(200), c1: fin(190), c3: fin(200), c2: fin(210) } };
    const ev = deriveEvent(four, progress(3, { ...seeded, ...heats, ...live }));
    expect(ev.standings.c).toEqual([null, null, null, null]);
    expect(ev.rounds[3]!.races[0]!.ranking.order).toEqual(['c1', 'c0']); // live ranking still shown
  });
});
