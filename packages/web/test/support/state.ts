import { publicView } from '../../../server/src/core/views';
import { derive } from '../../../server/src/core/results';
import { handleLifecycle } from '../../../server/src/core/lifecycle';
import type { LiveEvent } from '../../../server/src/core/model';
import { control, ctx, lockedFour, ok, runRound, teamId } from '../../../server/test/core/helpers';
import { fixture, previousEvent } from '../../../server/test/core/fixture';
import type { PublicView } from '../../src/lib/types';

export { lockedFour, runRound, teamId, fixture, previousEvent };

export const viewOf = (e: LiveEvent): PublicView => publicView(e, derive(e));

export function openNext(e: LiveEvent): LiveEvent {
  return ok(handleLifecycle(e, { type: 'openNextRound' }, ctx(control)));
}

export function start(e: LiveEvent, now = 1_000_000): LiveEvent {
  for (const [s, st] of Object.entries(e.stations)) {
    if (!st.excluded) e = ok(handleLifecycle(e, { type: 'overrideStation', station: Number(s), state: 'ready' }, ctx(control, now)));
  }
  return ok(handleLifecycle(e, { type: 'startRace' }, ctx(control, now)));
}

export const seedTimes = { T1: 100_000, T2: 110_000, T3: 120_000, T4: 130_000 };

/** Four teams, both seeding rounds raced, heats round open (T1 v T4 on 1–2, T2 v T3 on 3–4). */
export function heatsOpen(): LiveEvent {
  return openNext(runRound(runRound(lockedFour(), seedTimes), seedTimes));
}

/** The previous event with every round raced (fixture times; bracket rounds from places). */
export function previousEventDone(): LiveEvent {
  let e = previousEvent();
  const time = (round: number, name: string): number => {
    const spec = derive(e).rounds[round - 1]!.spec;
    if (spec.kind === 'seeding') {
      const t = fixture.teams.find((x) => x.name === name)!;
      const [m, s] = (spec.run === 1 ? t.run1 : t.run2).split(':').map(Number);
      return (m! * 60 + s!) * 1000;
    }
    const row = fixture.bracketRounds.find((r) => r.round === round)!.rows.find((x) => x.team === name);
    return row ? 200_000 + row.place * 5_000 : 0; // teams not in this round are ignored by runRound
  };
  for (let round = 1; round <= 9; round++) {
    const names = Object.fromEntries(e.setup.teams.map((t) => [t.name, time(round, t.name)]));
    e = runRound(e, names, 2_000_000 + round * 1_000_000);
  }
  return e;
}

import { refereeView } from '../../../server/src/core/views';
import type { RefereeView } from '../../src/lib/types';
export const refViewOf = (e: LiveEvent, station = 1): RefereeView => refereeView(e, derive(e), station);

import { controlView } from '../../../server/src/core/views';
import type { ControlView } from '../../src/lib/types';
export const ctlViewOf = (e: LiveEvent): ControlView => controlView(e, derive(e), { devices: [], audit: [] });
