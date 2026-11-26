import { describe, it, expect } from 'vitest';
import { handleSetup } from '../../src/core/setup';
import { handleLifecycle } from '../../src/core/lifecycle';
import { handleTaps } from '../../src/core/taps';
import { derive } from '../../src/core/results';
import { companionView, controlView, projectorScreen, publicRoundUpdate, publicView, refereeView } from '../../src/core/views';
import { eventCsv } from '../../src/core/export';
import { fairnessWarnings } from '../../src/core/fairness';
import { fairnessCsv } from '../../src/core/fairnessExport';
import type { CommandResult, LiveEvent, RosterEntry } from '../../src/core/model';
import { admin, blank, csvFor, ctx, lockedFour, ok, roster, runRound, teamId } from './helpers';

const code = (r: CommandResult) => (r.ok ? 'ok' : r.code);
const names = (e: LiveEvent, ids: (string | null)[]) => ids.map((id) => e.setup.teams.find((t) => t.id === id)?.name ?? null);
const s = (seconds: number) => Math.round(seconds * 1000);

/**
 * A knockout event set up through commands: A has 6 teams, B has 4, on 8 tables, Grand Championship on. Two
 * seeding groups, so rounds 1–4 are seeding; 5 = A's two quarter-finals (A 1 and A 2 have a bye); 6 = both
 * brackets' semi-finals; 7 = both finals and third-place races; 8 = grand.
 */
function lockedKnockout(): LiveEvent {
  let e = ok(handleSetup(blank(8), { type: 'importTeams', csv: csvFor({ A: 6, B: 4 }) }, ctx(admin)));
  e = ok(handleSetup(e, { type: 'setGrandChampionship', enabled: true }, ctx(admin)));
  e = ok(handleSetup(e, { type: 'setFormat', format: { brackets: 'knockout' } }, ctx(admin)));
  e = ok(handleSetup(e, { type: 'suggestSetup' }, ctx(admin)));
  return ok(handleSetup(e, { type: 'lockSetup' }, ctx(admin)));
}

/** Every view and export of the event as it stands; none may throw. */
function probe(e: LiveEvent) {
  const d = derive(e);
  const control = controlView(e, d, { devices: [], audit: [], roster: [] });
  const pub = publicView(e, d);
  const ref = refereeView(e, d, { station: 1, deviceId: 'dev1' });
  publicRoundUpdate(e, d);
  companionView(e, d);
  fairnessCsv(e);
  return { d, control, pub, ref, warnings: fairnessWarnings(e, d), csv: eventCsv(e), screen: projectorScreen(e, d) };
}

const seedingTimes: Record<string, number> = Object.fromEntries([
  ...[1, 2, 3, 4, 5, 6].map((i) => [`A ${i}`, s(60 + i)]),
  ...[1, 2, 3, 4].map((i) => [`B ${i}`, s(70 + i)]),
]);

function seeded(): LiveEvent {
  let e = lockedKnockout();
  for (let round = 1; round <= 4; round++) e = runRound(e, seedingTimes, 2_000_000 + round * 10_000);
  return e;
}
const entrants = (e: LiveEvent, round: number) =>
  derive(e).rounds[round - 1]!.races.map((r) => [r.id, r.label, names(e, r.entrants.map((x) => x.teamId))]);

describe('a knockout event through the server core', () => {
  it('is chosen, suggested and locked through commands', () => {
    const e = lockedKnockout();
    expect([e.setupLocked, e.setup.format, e.setup.brackets.map((b) => b.size)]).toEqual([true, { brackets: 'knockout' }, [6, 4]]);
  });

  it('Suggest never builds a bracket larger than the tables, so what it builds can be locked', () => {
    for (const [teams, tables, sizes] of [[9, 8, [7, 2]], [11, 8, [8, 3]], [17, 8, [8, 7, 2]], [11, 16, [11]]] as const) {
      let e = ok(handleSetup(blank(tables), { type: 'importTeams', csv: csvFor({ A: teams }) }, ctx(admin)));
      e = ok(handleSetup(e, { type: 'setFormat', format: { brackets: 'knockout' } }, ctx(admin)));
      e = ok(handleSetup(e, { type: 'suggestSetup' }, ctx(admin)));
      expect(e.setup.brackets.map((b) => b.size)).toEqual(sizes);
      expect(code(handleSetup(e, { type: 'lockSetup' }, ctx(admin)))).toBe('ok');
    }
  });

  it('publishes the bracket members with the first bracket round, not before; race control sees them as soon as they are drawn', () => {
    let e = seeded();
    const before = probe(e);
    expect(before.pub.bracketMembers).toBeNull();
    expect(Object.keys(before.control.bracketMembers ?? {})).toEqual(['a:0', 'b:0']);
    e = ok(handleLifecycle(e, { type: 'openNextRound' }, ctx(admin, 2_100_000)));
    const pub = probe(e).pub;
    expect(Object.fromEntries(Object.entries(pub.bracketMembers!).map(([id, ids]) => [id, names(e, ids)]))).toEqual({
      'a:0': ['A 1', 'A 2', 'A 3', 'A 4', 'A 5', 'A 6'], 'b:0': ['B 1', 'B 2', 'B 3', 'B 4'],
    });
    // The standard format publishes them the same way.
    const standard = publicView(lockedFour(), derive(lockedFour()));
    expect(standard.bracketMembers).toBeNull();
  });

  it('is planned with every final in the last knockout round', () => {
    const e = lockedKnockout();
    expect(e.setup.brackets.map((b) => [b.id, b.size])).toEqual([['a:0', 6], ['b:0', 4]]);
    const { d, control, pub } = probe(e);
    expect(d.rounds.map((r) => (r.spec.kind === 'knockout' ? [r.spec.stage, r.spec.bracketIds] : r.spec.kind))).toEqual([
      'seeding', 'seeding', 'seeding', 'seeding', [3, ['a:0']], [2, ['a:0', 'b:0']], [1, ['a:0', 'b:0']], 'grand',
    ]);
    expect(control.format.brackets).toBe('knockout');
    expect(pub.rounds.map((r) => r.kind)).toEqual(['seeding', 'seeding', 'seeding', 'seeding', 'knockout', 'knockout', 'knockout', 'grand']);
  });

  it('races every round to a decided bracket and a Grand Champion', () => {
    let e = seeded();
    expect(probe(e).screen).toBe('seeding-results');

    // Round 5: A's quarter-finals. A 1 and A 2 have a bye: no race, no table, nothing to wait for.
    e = ok(handleLifecycle(e, { type: 'openNextRound' }, ctx(admin, 2_100_000)));
    expect(entrants(e, 5)).toEqual([
      ['r5:a:0:ko3-1', 'A Gold · Quarter-final 1', ['A 4', 'A 5']],
      ['r5:a:0:ko3-2', 'A Gold · Quarter-final 2', ['A 3', 'A 6']],
    ]);
    expect(e.lineups![5]!.map((r) => [r.id, r.role, r.tables])).toEqual([['r5:a:0:ko3-1', 'ko', [1, 2]], ['r5:a:0:ko3-2', 'ko', [3, 4]]]);
    expect(Object.fromEntries(Object.entries(e.bracketMembers!).map(([id, ids]) => [id, names(e, ids)]))).toEqual({
      'a:0': ['A 1', 'A 2', 'A 3', 'A 4', 'A 5', 'A 6'], 'b:0': ['B 1', 'B 2', 'B 3', 'B 4'],
    });
    const open = probe(e);
    expect(names(e, open.control.outstanding.map((x) => x.teamId))).toEqual(['A 4', 'A 5', 'A 3', 'A 6']);
    expect(open.ref.teams.map((t) => t.name)).toEqual(['A 4', 'A 5']);
    expect(Object.values(e.stations).map((st) => st.excluded)).toEqual([false, false, true, true]);
    for (const station of [1, 2]) e = ok(handleLifecycle(e, { type: 'overrideStation', station, state: 'ready' }, ctx(admin, 2_100_000)));
    e = ok(handleLifecycle(e, { type: 'startRace' }, ctx(admin, 2_100_000)));
    probe(e);
    // A 4 and A 5 finish in the same hundredth.
    const quarter = { 'A 4': s(80), 'A 5': s(80) + 4, 'A 3': s(81), 'A 6': s(85) };
    e = { ...e, overrides: [...e.overrides, ...Object.entries(quarter).map(([name, rawMs]) => ({ round: 5, teamId: teamId(e, name), at: 2_100_500, set: { kind: 'time' as const, rawMs } }))] };
    e = ok(handleLifecycle(e, { type: 'finishRace' }, ctx(admin, 2_101_000)));

    // The tie blocks the semi-final round until race control decides it.
    const tied = probe(e);
    expect(tied.screen).toBe('brackets');
    expect(tied.control.blockers).toEqual(['Round 5: tie in r5:a:0:ko3-1']);
    expect(tied.control.ties.map((t) => t.raceId)).toEqual(['r5:a:0:ko3-1']);
    expect(tied.d.missing).toEqual([]);
    expect(code(handleLifecycle(e, { type: 'openNextRound' }, ctx(admin, 2_102_000)))).toBe('blocked');
    e = ok(handleLifecycle(e, { type: 'decideTie', raceId: 'r5:a:0:ko3-1', order: [teamId(e, 'A 5'), teamId(e, 'A 4')] }, ctx(admin, 2_103_000)));
    expect(probe(e).control.blockers).toEqual([]);

    // Round 6: the semi-finals of both brackets. The bye teams come in; B starts here.
    e = runRound(e, { 'A 1': s(70), 'A 5': s(75), 'A 2': s(71), 'A 3': s(76), 'B 1': s(72), 'B 4': s(78), 'B 2': s(73), 'B 3': s(79) }, 2_200_000);
    expect(entrants(e, 6)).toEqual([
      ['r6:a:0:ko2-1', 'A Gold · Semi-final 1', ['A 1', 'A 5']],
      ['r6:a:0:ko2-2', 'A Gold · Semi-final 2', ['A 2', 'A 3']],
      ['r6:b:0:ko2-1', 'B Gold · Semi-final 1', ['B 1', 'B 4']],
      ['r6:b:0:ko2-2', 'B Gold · Semi-final 2', ['B 2', 'B 3']],
    ]);
    expect(probe(e).pub.standings).toEqual({ a: [null, null, null, null, null, null], b: [null, null, null, null] });

    // A late correction to a quarter-final: A 6 now beat A 3. The semi-final that was raced keeps its entrants.
    const fix = { type: 'setResult' as const, round: 5, teamId: teamId(e, 'A 6'), set: { kind: 'time' as const, rawMs: s(79) } };
    const refused = handleTaps(e, fix, ctx(admin, 2_250_000));
    expect(!refused.ok && [refused.code, refused.detail]).toEqual(['unlock_required', { laterRounds: [6], keptRounds: [6], bracketsKept: false }]);
    const before = entrants(e, 6);
    e = ok(handleTaps(e, { ...fix, confirmUnlock: true }, ctx(admin, 2_250_000)));
    expect(names(e, derive(e).rounds[4]!.races[1]!.ranking.order)).toEqual(['A 6', 'A 3']);
    expect(entrants(e, 6)).toEqual(before);
    expect(probe(e).control.blockers).toEqual([]);

    // Round 7: both finals and both third-place races, in the last knockout round.
    e = runRound(e, { 'A 1': s(70), 'A 2': s(69), 'A 5': s(75), 'A 3': s(74), 'B 1': s(70.5), 'B 2': s(71), 'B 4': s(80), 'B 3': s(79) }, 2_300_000);
    expect(entrants(e, 7)).toEqual([
      ['r7:a:0:final', 'A Gold · Final', ['A 1', 'A 2']],
      ['r7:a:0:third', 'A Gold · Third place', ['A 5', 'A 3']],
      ['r7:b:0:final', 'B Gold · Final', ['B 1', 'B 2']],
      ['r7:b:0:third', 'B Gold · Third place', ['B 4', 'B 3']],
    ]);
    const decided = probe(e);
    expect(decided.screen).toBe('brackets');
    // A 4 and A 6 did not reach the semi-finals: placed by their quarter-final times (A 6 after the correction).
    expect(names(e, decided.pub.standings.a!)).toEqual(['A 2', 'A 1', 'A 3', 'A 5', 'A 6', 'A 4']);
    expect(names(e, decided.pub.standings.b!)).toEqual(['B 1', 'B 2', 'B 3', 'B 4']);
    expect(names(e, Object.values(decided.pub.categoryWinners))).toEqual(['A 2', 'B 1']);
    expect(code(handleLifecycle(e, { type: 'showChampion', bagTotal: '' }, ctx(admin, 2_350_000)))).toBe('not_finished');

    // Round 8: the Grand Championship between the two knockout winners.
    e = runRound(e, { 'A 2': s(66), 'B 1': s(67) }, 2_400_000);
    expect(entrants(e, 8)).toEqual([['r8:grand', 'Grand Championship', ['A 2', 'B 1']]]);
    const done = probe(e);
    expect(names(e, [done.d.grandChampion])).toEqual(['A 2']);
    expect(done.screen).toBe('champion');
    expect(done.control.blockers).toEqual([]);
    e = ok(handleLifecycle(e, { type: 'showChampion', bagTotal: '1200' }, ctx(admin, 2_450_000)));
    expect(probe(e).pub.championShown).toBe(true);
    expect(code(handleLifecycle(e, { type: 'openNextRound' }, ctx(admin, 2_460_000)))).toBe('event_complete');

    // The export has one row per team per race: two seeding runs for each of the 10 teams, then 4 + 8 + 8 + 2.
    const rows = done.csv.split('\n').slice(1);
    expect(rows.length).toBe(20 + 4 + 8 + 8 + 2);
    expect(rows.filter((r) => r.startsWith('5,')).map((r) => r.split(',')[1])).toEqual(['A 4', 'A 5', 'A 3', 'A 6']);
    // Places in the tied quarter-final follow the decision.
    expect(rows.filter((r) => r.startsWith('5,')).map((r) => r.split(',')[8])).toEqual(['2', '1', '2', '1']);
  });

  it('a cleared result in an early round blocks the next, and names only teams that raced', () => {
    let e = seeded();
    e = runRound(e, { 'A 4': s(80), 'A 5': s(81), 'A 3': s(82), 'A 6': s(83) }, 2_100_000);
    e = ok(handleTaps(e, { type: 'setResult', round: 5, teamId: teamId(e, 'A 3'), set: { kind: 'clear' } }, ctx(admin, 2_150_000)));
    const view = probe(e);
    expect(view.control.blockers).toEqual(['Round 5: A 3 has no result. Enter a time, DNF or DNS.']);
    expect(code(handleLifecycle(e, { type: 'openNextRound' }, ctx(admin, 2_160_000)))).toBe('blocked');
    e = ok(handleTaps(e, { type: 'setResult', round: 5, teamId: teamId(e, 'A 3'), set: { kind: 'status', status: 'dnf' } }, ctx(admin, 2_170_000)));
    e = ok(handleLifecycle(e, { type: 'openNextRound' }, ctx(admin, 2_180_000)));
    expect(entrants(e, 6)[1]).toEqual(['r6:a:0:ko2-2', 'A Gold · Semi-final 2', ['A 2', 'A 6']]);
  });

  it('with rotating referees: the finals are split between two referees, the third-place races are not', () => {
    const refs: RosterEntry[] = roster(6);
    let e = seeded();
    e = { ...e, settings: { ...e.settings, rotateReferees: true } };
    const open = (ev: LiveEvent, now: number) => ok(handleLifecycle(ev, { type: 'openNextRound' }, { ...ctx(admin, now), roster: refs }));
    const race = (ev: LiveEvent, times: Record<string, number>, now: number) => {
      let x = open(ev, now);
      for (const st of Object.keys(x.stations)) x = ok(handleLifecycle(x, { type: 'overrideStation', station: Number(st), state: 'ready' }, ctx(admin, now)));
      x = ok(handleLifecycle(x, { type: 'startRace' }, ctx(admin, now)));
      const inRound = new Set(derive(x).rounds[x.round.current - 1]!.races.flatMap((r) => r.entrants.map((t) => t.teamId)));
      const overrides = Object.entries(times).map(([name, rawMs]) => ({ round: x.round.current, teamId: teamId(x, name), at: now, set: { kind: 'time' as const, rawMs } }))
        .filter((o) => inRound.has(o.teamId));
      return ok(handleLifecycle({ ...x, overrides: [...x.overrides, ...overrides] }, { type: 'finishRace' }, ctx(admin, now + 1)));
    };
    const all = Object.fromEntries(Object.entries(seedingTimes).map(([name, ms]) => [name, ms + 20_000]));
    e = race(e, all, 2_100_000);
    expect(e.assignments![5]!.map((a) => a.tables)).toEqual([[1, 2], [3, 4]]);
    e = race(e, all, 2_200_000);
    expect(e.assignments![6]!.map((a) => a.tables)).toEqual([[1, 2], [3, 4], [5, 6], [7, 8]]);
    e = open(e, 2_300_000);
    expect(derive(e).rounds[6]!.races.map((r) => [r.role, r.entrants.map((x) => x.table)])).toEqual([
      ['final', [1, 2]], ['third', [3, 4]], ['final', [5, 6]], ['third', [7, 8]],
    ]);
    expect(e.assignments![7]!.map((a) => a.tables)).toEqual([[1], [2], [3, 4], [5], [6], [7, 8]]);
    expect(() => probe(e)).not.toThrow();
    expect(probe(e).warnings.filter((w) => w.kind === 'final_one_referee')).toEqual([]);
  });
});
