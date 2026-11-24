import { describe, it, expect } from 'vitest';
import { parseClockTime, stationOfTable } from '@race2feed/engine';
import { applyCommand } from '../../src/core/apply';
import { derive } from '../../src/core/results';
import type { Command, LiveEvent } from '../../src/core/model';
import { admin, blank, ctx, ok, referee } from './helpers';
import { fixture } from './fixture';

const quote = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

describe('the previous event, driven through commands', () => {
  it('produces the same standings and Grand Champion', () => {
    let now = 10_000_000;
    const run = (e: LiveEvent, cmd: Command, actor = admin) => ok(applyCommand(e, cmd, ctx(actor, now)));

    // Setup
    const csv = ['team,category', ...fixture.teams.map((t) => `${quote(t.name)},${quote(t.category)}`)].join('\n');
    let e = run(blank(fixture.tableCount), { type: 'importTeams', csv });
    e = run(e, { type: 'suggestSetup' });
    const idOf = new Map(e.setup.teams.map((t) => [t.name, t.id]));
    const nameOf = (id: string | null) => e.setup.teams.find((t) => t.id === id)?.name ?? null;
    const groups = ['A', 'B'].map((g) => ({
      id: g,
      teamIds: fixture.teams.filter((t) => t.group === g).sort((a, b) => a.table - b.table).map((t) => idOf.get(t.name)!),
    }));
    e = run(e, { type: 'setGroups', groups, tableOf: Object.fromEntries(fixture.teams.map((t) => [idOf.get(t.name)!, t.table])) });
    e = run(e, { type: 'setGrandChampionship', enabled: true });
    e = run(e, { type: 'lockSetup' });

    // Times per round and team
    const placeIn = new Map(fixture.bracketRounds.map((r) => [r.round, new Map(r.rows.map((x) => [x.team, x.place]))]));
    const timeFor = (round: number, name: string): number => {
      const spec = derive(e).rounds[round - 1]!.spec;
      if (spec.kind === 'seeding') {
        const t = fixture.teams.find((x) => x.name === name)!;
        return parseClockTime(spec.run === 1 ? t.run1 : t.run2);
      }
      return 200_000 + placeIn.get(round)!.get(name)! * 5_000;
    };

    for (let round = 1; round <= 9; round++) {
      e = run(e, { type: 'openNextRound' }, admin);
      for (const [s, st] of Object.entries(e.stations)) {
        if (!st.excluded) e = run(e, { type: 'overrideStation', station: Number(s), state: 'ready' }, admin);
      }
      e = run(e, { type: 'startRace' }, admin);
      const startedAt = e.round.startedAt!;
      now = startedAt + 900_000;
      for (const race of derive(e).rounds[round - 1]!.races) {
        for (const { teamId, table } of race.entrants) {
          const atServerMs = startedAt + timeFor(round, nameOf(teamId)!);
          e = run(e, { type: 'tapFinish', teamId, atServerMs, clientTapId: `${round}-${teamId}` }, referee(stationOfTable(table)));
        }
      }
      e = run(e, { type: 'finishRace' }, admin);
      now += 60_000;
    }

    const d = derive(e);
    expect(nameOf(d.grandChampion)).toBe(fixture.expectedGrandChampion);
    for (const c of e.setup.categories) {
      expect(d.standings[c.id]!.map(nameOf)).toEqual(fixture.expectedStandings[c.name as keyof typeof fixture.expectedStandings]);
    }
    const r = applyCommand(e, { type: 'openNextRound' }, ctx(admin, now));
    expect(r.ok ? 'ok' : r.code).toBe('event_complete');
  });
});
