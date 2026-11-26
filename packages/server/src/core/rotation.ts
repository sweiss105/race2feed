import { stationOfTable, tablesOfStation, type DerivedEvent } from '@race2feed/engine';
import { perStation, type Actor, type Assignment, type LiveEvent, type RosterEntry } from './model';

/** Referees move between stations each round. Missing (events stored before rotation) means off. */
export const rotationOn = (e: LiveEvent): boolean => e.settings.rotateReferees === true;

/** The saved assignment of a device in a round, or undefined (rotation off, round not saved, or device unassigned). */
export function assignmentOf(e: LiveEvent, round: number, deviceId: string | undefined): Assignment | undefined {
  return deviceId === undefined ? undefined : e.assignments?.[round]?.find((a) => a.deviceId === deviceId);
}

/**
 * Tables an actor judges in a round: the saved assignment's tables when the round has saved assignments
 * ([] if the device has none); otherwise the tables of the station the device was paired to.
 */
export function tablesFor(e: LiveEvent, actor: Pick<Actor, 'station' | 'deviceId'>, round: number): number[] {
  if (e.assignments?.[round]) return assignmentOf(e, round, actor.deviceId)?.tables ?? [];
  return actor.station === undefined ? [] : tablesOfStation(actor.station, e.setup.tableCount, perStation(e));
}

const entrantsOf = (d: DerivedEvent, round: number) => d.rounds[round - 1]?.races.flatMap((r) => r.entrants) ?? [];

/** The teams each referee had in each round with saved assignments: round → deviceId → teamIds. */
export function refereeTeams(e: LiveEvent, d: DerivedEvent): Record<number, Record<string, string[]>> {
  const out: Record<number, Record<string, string[]>> = {};
  for (const [roundText, saved] of Object.entries(e.assignments ?? {})) {
    const round = Number(roundText);
    const entrants = entrantsOf(d, round);
    const byDevice: Record<string, string[]> = {};
    for (const a of saved) {
      (byDevice[a.deviceId] ??= []).push(...entrants.filter((x) => a.tables.includes(x.table)).map((x) => x.teamId));
    }
    out[round] = byDevice;
  }
  return out;
}

/** A referee had this team in the round before: counted on top of the 1 for each earlier round. */
const JUST_HAD = 3;
const FINALS: string[] = ['final', 'winners', 'grand'];

/**
 * The referee of each station that has a team in `round`, and of each table of a split final.
 * Pure and deterministic: the same event and the same referees (in any order) give the same answer.
 *
 * Every busy station gets a referee while referees last (the lowest stations when there are too few).
 * Among those, the choice with the lowest cost wins, where a referee at a station costs, per team there,
 * 1 for each earlier round they had that team plus JUST_HAD if that was the round before. Equal costs:
 * the fewest referees away from the station they had last round (their home station if none), then the
 * smallest list of device ids in station order.
 */
export function assignRound(e: LiveEvent, d: DerivedEvent, round: number, roster: RosterEntry[]): Assignment[] {
  const referees = [...new Map(roster.map((r) => [r.deviceId, r])).values()]
    .sort((a, b) => (a.deviceId < b.deviceId ? -1 : a.deviceId > b.deviceId ? 1 : 0));
  const per = perStation(e);
  const entrants = entrantsOf(d, round);
  const occupied = new Set(entrants.map((x) => x.table));
  const busy = [...new Set(entrants.map((x) => stationOfTable(x.table, per)))].sort((a, b) => a - b);
  const stations = busy.slice(0, referees.length);
  if (!stations.length) return [];

  const had = refereeTeams(e, d);
  /** What it costs to give this referee these teams. */
  const cost = (deviceId: string, teams: string[]): number => {
    let total = 0;
    for (const [roundText, byDevice] of Object.entries(had)) {
      const earlier = Number(roundText);
      if (earlier >= round) continue;
      const theirs = byDevice[deviceId] ?? [];
      total += teams.filter((t) => theirs.includes(t)).length * (earlier === round - 1 ? 1 + JUST_HAD : 1);
    }
    return total;
  };
  const tablesOf = (station: number) => tablesOfStation(station, e.setup.tableCount, per).filter((t) => occupied.has(t));
  const teamsAt = (tables: number[]) => entrants.filter((x) => tables.includes(x.table)).map((x) => x.teamId);
  const lastStation = (r: RosterEntry) => assignmentOf(e, round - 1, r.deviceId)?.station ?? r.home;

  // One number per (station, referee) that orders choices by cost, then referees moved, then device ids in
  // station order. The numbers get too large for doubles (17^13 for the last part alone), hence BigInt.
  const base = BigInt(referees.length + 1);
  const idsRange = base ** BigInt(stations.length);
  const movedRange = BigInt(stations.length + 1);
  const weights = stations.map((station, i) => {
    const teams = teamsAt(tablesOf(station));
    const place = base ** BigInt(stations.length - 1 - i);
    return referees.map((r, j) =>
      (BigInt(cost(r.deviceId, teams)) * movedRange + (lastStation(r) === station ? 0n : 1n)) * idsRange + BigInt(j) * place);
  });
  const chosen = cheapestMatching(weights);

  const out: Assignment[] = stations.map((station, i) => {
    const r = referees[chosen[i]!]!;
    return { deviceId: r.deviceId, name: r.name, station, tables: tablesOf(station) };
  });

  // Finals split: a spare referee takes the higher table of a deciding race whose two teams share a station.
  if (per === 2) {
    const spares = referees.filter((r) => !out.some((a) => a.deviceId === r.deviceId));
    const finals = (d.rounds[round - 1]?.races ?? [])
      .filter((race) => FINALS.includes(race.role) && race.entrants.length === 2)
      .map((race) => race.entrants.map((x) => x.table).sort((a, b) => a - b) as [number, number])
      .filter(([lower, higher]) => stationOfTable(lower, per) === stationOfTable(higher, per))
      .sort((a, b) => a[0] - b[0]);
    for (const [lower, higher] of finals) {
      const judge = out.find((a) => a.station === stationOfTable(lower, per));
      if (!spares.length || !judge) break;
      const teams = teamsAt([higher]);
      // Lowest cost; spares are in device id order, so the first of equals has the lowest id.
      const spare = spares.reduce((best, r) => (cost(r.deviceId, teams) < cost(best.deviceId, teams) ? r : best));
      spares.splice(spares.indexOf(spare), 1);
      judge.tables = [lower];
      out.push({ deviceId: spare.deviceId, name: spare.name, station: judge.station, tables: [higher] });
    }
  }
  return out.sort((a, b) => a.station - b.station || a.tables[0]! - b.tables[0]!);
}

/**
 * Hungarian algorithm: gives every row a different column so that the sum of weights is the lowest possible.
 * weights[row][column], with at least as many columns as rows. Returns the column of each row.
 */
function cheapestMatching(weights: bigint[][]): number[] {
  const rows = weights.length;
  const cols = weights[0]!.length;
  const INF = 1n << 200n;
  const u = Array<bigint>(rows + 1).fill(0n);
  const v = Array<bigint>(cols + 1).fill(0n);
  /** rowOf[c]: the row matched to column c (1-based; 0 = none). Column 0 is the row being placed. */
  const rowOf = Array<number>(cols + 1).fill(0);
  const way = Array<number>(cols + 1).fill(0);
  for (let row = 1; row <= rows; row++) {
    rowOf[0] = row;
    let col = 0;
    const min = Array<bigint>(cols + 1).fill(INF);
    const used = Array<boolean>(cols + 1).fill(false);
    do {
      used[col] = true;
      const r = rowOf[col]!;
      let delta = INF;
      let next = 0;
      for (let c = 1; c <= cols; c++) {
        if (used[c]) continue;
        const reduced = weights[r - 1]![c - 1]! - u[r]! - v[c]!;
        if (reduced < min[c]!) { min[c] = reduced; way[c] = col; }
        if (min[c]! < delta) { delta = min[c]!; next = c; }
      }
      for (let c = 0; c <= cols; c++) {
        if (used[c]) { u[rowOf[c]!] = u[rowOf[c]!]! + delta; v[c] = v[c]! - delta; } else min[c] = min[c]! - delta;
      }
      col = next;
    } while (rowOf[col] !== 0);
    do {
      const prev = way[col]!;
      rowOf[col] = rowOf[prev]!;
      col = prev;
    } while (col !== 0);
  }
  const out = Array<number>(rows).fill(0);
  for (let c = 1; c <= cols; c++) if (rowOf[c]) out[rowOf[c]! - 1] = c - 1;
  return out;
}
