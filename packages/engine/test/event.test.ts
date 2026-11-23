import { describe, it, expect } from 'vitest';
import { deriveEvent } from '../src/event';
import { makeEvent, progress, seedInOrder, fin } from './helpers/events';

// One category 'c' of 4 teams on 4 tables, one seeding group, no grand.
// Rounds: 1 seeding A run 1, 2 seeding A run 2, 3 heats (upper), 4 placement (upper).
const input = makeEvent([['c', 4]], 4, false);
const seeded = seedInOrder(input, [1, 2]); // c0 seed 1 … c3 seed 4
const heats = { 3: { c0: fin(210), c3: fin(200), c1: fin(200), c2: fin(210) } }; // c3 beats c0, c1 beats c2
const placement = { 4: { c3: fin(200), c1: fin(190), c0: fin(190), c2: fin(200) } }; // c1 > c3, c0 > c2
const entrants = (ev: ReturnType<typeof deriveEvent>, round: number) =>
  ev.rounds[round - 1]!.races.map((r) => r.entrants.map((e) => [e.teamId, e.table]));

describe('deriveEvent', () => {
  it('before any results: seeding ready, brackets blocked, no seed rank', () => {
    const ev = deriveEvent(input, progress(0));
    expect(ev.rounds.map((r) => r.status)).toEqual(['ready', 'blocked', 'blocked', 'blocked']);
    expect(ev.rounds[0]!.races.map((r) => r.id)).toEqual(['r1:seed:c0', 'r1:seed:c1', 'r1:seed:c2', 'r1:seed:c3']);
    expect(ev.rounds[2]!.races).toEqual([]);
    expect(ev.seedRank).toBeNull();
  });

  it('after seeding: heats pair 1v4 and 2v3 on station pairs', () => {
    const ev = deriveEvent(input, progress(2, seeded));
    expect(ev.seedRank).toEqual({ c0: 1, c1: 2, c2: 3, c3: 4 });
    expect(ev.rounds[2]!.status).toBe('ready');
    expect(entrants(ev, 3)).toEqual([[['c0', 1], ['c3', 2]], [['c1', 3], ['c2', 4]]]);
    expect(ev.rounds[2]!.races.map((r) => r.label)).toEqual(['C Gold · Heat 1', 'C Gold · Heat 2']);
    expect(ev.rounds[2]!.races[0]!.id).toBe('r3:c:0:heat1');
  });

  it('after heats: winners race and others race', () => {
    const ev = deriveEvent(input, progress(3, { ...seeded, ...heats }));
    const races = ev.rounds[3]!.races;
    expect(races.map((r) => r.id)).toEqual(['r4:c:0:winners', 'r4:c:0:others']);
    expect(races.map((r) => r.entrants.map((e) => e.teamId))).toEqual([['c3', 'c1'], ['c0', 'c2']]);
    expect(races.map((r) => r.label)).toEqual(['C Gold · Winners race', 'C Gold · Others race']);
  });

  it('after placement: standings filled', () => {
    const ev = deriveEvent(input, progress(4, { ...seeded, ...heats, ...placement }));
    expect(ev.standings).toEqual({ c: ['c1', 'c3', 'c0', 'c2'] });
    expect(ev.rounds.every((r) => r.status === 'locked')).toBe(true);
    expect(ev.blockers).toEqual([]);
    expect(ev.grandChampion).toBeNull();
  });
});
