import type { Actor, Ctx, LiveEvent, CommandResult, PenaltyReason } from '../../src/core/model';
import { newEvent } from '../../src/core/model';

export const admin: Actor = { role: 'admin', label: 'admin' };
export const companion: Actor = { role: 'companion', label: 'companion' };
export const referee = (station: number, deviceId = `dev${station}`): Actor =>
  ({ role: 'referee', label: `ref ${station}`, station, deviceId });

let n = 0;
export const ctx = (actor: Actor = admin, now = 1_000_000): Ctx => ({ actor, now, newId: () => `id${++n}` });

export function ok(r: CommandResult): LiveEvent {
  if (!r.ok) throw new Error(`${r.code}: ${r.message} ${JSON.stringify(r.detail ?? '')}`);
  return r.event;
}

export function csvFor(counts: Record<string, number>): string {
  const lines = ['team,category'];
  for (const [cat, count] of Object.entries(counts)) {
    for (let i = 1; i <= count; i++) lines.push(`${cat} ${i},${cat}`);
  }
  return lines.join('\n');
}

/** The penalty list tests run with: fixed here (and including a DQ) so tests don't depend on the product's starter list. */
export const TEST_REASONS: PenaltyReason[] = [
  { id: 'sealed', name: 'Bag not sealed', kind: 'time', amountMs: 5000 },
  { id: 'count', name: 'Wrong item count', kind: 'time', amountMs: 5000 },
  { id: 'early', name: 'Started early', kind: 'time', amountMs: 10_000 },
  { id: 'unsafe', name: 'Unsafe conduct', kind: 'dq' },
];
export const blank = (tables = 26): LiveEvent =>
  ({ ...newEvent('ev1', 'Test', '2026-12-01', tables), penaltyReasons: TEST_REASONS.map((r) => ({ ...r })) });

import { handleSetup } from '../../src/core/setup';
import { handleLifecycle } from '../../src/core/lifecycle';
import { derive, teamsInRound } from '../../src/core/results';

/** 4 teams (T1..T4) in one category on 4 tables, setup locked. Rounds: 2 seeding, heats, placement. */
export function lockedFour(): LiveEvent {
  let e = ok(handleSetup(blank(4), { type: 'importTeams', csv: csvFor({ T: 4 }).replace(/T (\d)/g, 'T$1') }, ctx(admin)));
  e = ok(handleSetup(e, { type: 'setGrandChampionship', enabled: false }, ctx(admin)));
  e = ok(handleSetup(e, { type: 'suggestSetup' }, ctx(admin)));
  return ok(handleSetup(e, { type: 'lockSetup' }, ctx(admin)));
}

export const teamId = (e: LiveEvent, name: string) => e.setup.teams.find((t) => t.name === name)!.id;

/** Opens the next round, readies every station, starts at `now`, records times by team name, finishes. */
export function runRound(e: LiveEvent, timesByName: Record<string, number>, now = 2_000_000): LiveEvent {
  e = ok(handleLifecycle(e, { type: 'openNextRound' }, ctx(admin, now)));
  for (const s of Object.keys(e.stations)) {
    e = ok(handleLifecycle(e, { type: 'overrideStation', station: Number(s), state: 'ready' }, ctx(admin, now)));
  }
  e = ok(handleLifecycle(e, { type: 'startRace' }, ctx(admin, now)));
  const inRound = new Set(teamsInRound(derive(e), e.round.current).map((t) => t.teamId));
  const overrides = Object.entries(timesByName)
    .map(([name, rawMs]) => ({ teamId: teamId(e, name), rawMs }))
    .filter((o) => inRound.has(o.teamId))
    .map((o) => ({ round: e.round.current, teamId: o.teamId, at: now, set: { kind: 'time' as const, rawMs: o.rawMs } }));
  e = { ...e, overrides: [...e.overrides, ...overrides] };
  return ok(handleLifecycle(e, { type: 'finishRace' }, ctx(admin, now + 1)));
}
