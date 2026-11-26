import { formatMs, formatOf, hundredths, officialMs, rankRace, type DerivedEvent, type EntryResult } from '@race2feed/engine';
import { perStation, type Dismissal, type LiveEvent } from './model';
import { buildProgress, recordedAt, seedRuns, seedScores, seedTotals } from './results';
import { refereeTeams, rotationOn } from './rotation';

export type { Dismissal };

/** A time this much faster than the fastest time recorded before it is flagged (both taken at the hundredth, as shown). */
export const FAST_MS = 30_000;
/** A referee's tables keep winning: at least this many counted races… */
export const WINS_MIN_RACES = 6;
/** …and this many more "better than seeded" than "worse than seeded". */
export const WINS_MARGIN = 4;
/** A referee has the same team this many times. */
export const REPEAT_TEAM_TIMES = 3;
/** A referee penalised the same team in this many rounds. */
export const REPEAT_PENALTY_ROUNDS = 2;
/** Penalty counts per referee are compared once this many rounds are finished. */
export const OUTLIER_FROM_ROUND = 3;
/** Too many: at least this many penalties and more than twice the average. */
export const OUTLIER_MIN = 3;
/** Too few: none, while the average is at least this. */
export const OUTLIER_AVG_FOR_NONE = 2;
/** Two teams at one referee finished this close together (both times taken at the hundredth, as shown). */
export const CLOSE_MS = 500;

export type WarningKind = 'fast_time' | 'referee_wins' | 'repeat_team' | 'repeat_penalty' | 'penalty_outlier'
  | 'close_finish' | 'undo_changed_winner' | 'final_one_referee' | 'late_finish';

/**
 * A pattern race control should look at. It never blocks anything.
 * id: stable, built only from the kind, the round, the referee's device id and the sorted team ids, so a dismissal
 * (keyed by id) survives unrelated changes. referee: the referee's name, null when it is not known.
 * round: for referee_wins and penalty_outlier (which cover the whole event) the latest finished round.
 */
export interface FairnessWarning {
  id: string; kind: WarningKind; round: number; referee: string | null; refereeId: string | null;
  teamIds: string[]; message: string;
}

const FINALS: string[] = ['final', 'winners', 'grand'];

/** "1", "1 and 2", "1, 2 and 3". */
const listed = (items: (string | number)[]): string =>
  items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;

/**
 * Every fairness warning that applies to the event as saved: newest round first, then kind, then id.
 * Computed, never stored, so a corrected result removes a warning that no longer applies.
 *
 * Who judged a team in a round: the referee whose saved assignment has the team's table; without one, the device
 * that made the team's finish tap (its name is known only if it has an assignment in some round).
 * Finished rounds count for every kind. The open or running round also counts for repeat_team and
 * final_one_referee (known when it opens) and for fast_time, close_finish, undo_changed_winner and late_finish (as results arrive).
 */
export function fairnessWarnings(e: LiveEvent, d: DerivedEvent): FairnessWarning[] {
  const results = buildProgress(e).results;
  const finished = e.finishedRounds;
  const current = e.round.current;
  const teamNames = new Map(e.setup.teams.map((t) => [t.id, t.name]));
  const team = (id: string) => teamNames.get(id) ?? id;

  /** The latest name each referee was saved under. */
  const names = new Map<string, string>();
  for (const round of Object.keys(e.assignments ?? {}).map(Number).sort((a, b) => a - b)) {
    for (const a of e.assignments?.[round] ?? []) names.set(a.deviceId, a.name);
  }
  const nameOf = (round: number, deviceId: string | null): string | null =>
    deviceId === null ? null : e.assignments?.[round]?.find((a) => a.deviceId === deviceId)?.name ?? names.get(deviceId) ?? null;

  const judgeOf = (round: number, teamId: string, table: number): string | null => {
    const assigned = e.assignments?.[round]?.find((a) => a.tables.includes(table));
    if (assigned) return assigned.deviceId;
    const tap = e.taps.filter((t) => t.kind === 'finish' && t.source === 'referee' && t.round === round && t.teamId === teamId
      && t.removedAt === null && t.deviceId !== undefined).at(-1);
    return tap?.deviceId ?? null;
  };

  const out = new Map<string, FairnessWarning>();
  const warn = (kind: WarningKind, round: number | null, refereeId: string | null, teamIds: string[], message: string) => {
    const sorted = [...teamIds].sort();
    const id = [kind, ...(round === null ? [] : [round]), refereeId ?? '-', ...(sorted.length ? [sorted.join(',')] : [])].join(':');
    const shown = round ?? finished;
    if (!out.has(id)) out.set(id, { id, kind, round: shown, referee: nameOf(shown, refereeId), refereeId, teamIds: sorted, message });
  };

  const races = d.rounds.flatMap((r) => r.races.map((race) => ({ round: r.spec.round, seeding: r.spec.kind === 'seeding', race })));
  const official = (round: number, teamId: string): number | null => {
    const r = results[round]?.[teamId];
    return r ? officialMs(r) : null;
  };

  // fast_time: a time far below every time recorded before it, in any round.
  const at = recordedAt(e);
  const timed = races
    .filter((x) => x.round <= current)
    .flatMap(({ round, race }) => race.entrants.map((x) => ({ round, ...x, ms: official(round, x.teamId), at: at[round]?.[x.teamId] })))
    .filter((x): x is typeof x & { ms: number; at: number } => x.ms !== null && x.at !== undefined);
  for (const x of timed) {
    const before = timed.filter((y) => y.at < x.at).map((y) => y.ms);
    if (!before.length) continue;
    // Compared as the times are shown and ranked: at the hundredth.
    const gain = hundredths(Math.min(...before)) - hundredths(x.ms);
    if (gain < FAST_MS / 10) continue;
    warn('fast_time', x.round, judgeOf(x.round, x.teamId, x.table), [x.teamId],
      `${team(x.teamId)}'s time of ${formatMs(x.ms, 'hundredths')} in round ${x.round} is ${(Math.floor(gain / 10) / 10).toFixed(1)} s faster than the fastest time before it.`);
  }

  // close_finish: two teams of one race, both judged by the same referee, almost level.
  for (const { round, race } of races) {
    if (round > current) continue;
    race.entrants.forEach((a, i) => race.entrants.slice(i + 1).forEach((b) => {
      const [msA, msB] = [official(round, a.teamId), official(round, b.teamId)];
      const judge = judgeOf(round, a.teamId, a.table);
      if (msA === null || msB === null || judge === null || judge !== judgeOf(round, b.teamId, b.table)) return;
      // The gap between the two times as they are shown and ranked: at the hundredth.
      const gap = Math.abs(hundredths(msA) - hundredths(msB));
      if (gap > CLOSE_MS / 10) return;
      const who = nameOf(round, judge);
      warn('close_finish', round, judge, [a.teamId, b.teamId],
        `${team(a.teamId)} and ${team(b.teamId)} finished ${(gap / 100).toFixed(2)} s apart in round ${round}, both judged by ${who ?? 'one referee'}.`);
    }));
  }

  // late_finish: a finish whose time comes from the device alone, because the server received it well after that time.
  for (const tap of e.taps) {
    if (tap.kind !== 'finish' || tap.source !== 'referee' || tap.removedAt !== null || tap.round > current) continue;
    if (tap.deviceId === undefined || !Number.isFinite(tap.lateMs)) continue;
    warn('late_finish', tap.round, tap.deviceId, [tap.teamId],
      `${team(tap.teamId)}'s finish in round ${tap.round} reached the server ${Math.round((tap.lateMs as number) / 1000)} s after the time the referee's device gave for it.`);
  }

  // undo_changed_winner: a referee took back a finish tap, and with that tap another team would have won.
  for (const tap of e.taps) {
    if (tap.kind !== 'finish' || tap.source !== 'referee' || tap.removedAt === null || tap.round > current) continue;
    if (tap.deviceId === undefined || !Number.isFinite(tap.elapsedMs)) continue;
    const race = races.find((x) => x.round === tap.round && x.race.entrants.some((y) => y.teamId === tap.teamId))?.race;
    const now = results[tap.round] ?? {};
    if (!race || race.entrants.length < 2 || !race.entrants.every((x) => now[x.teamId])) continue;
    const withTap: EntryResult = { status: 'finished', rawMs: tap.elapsedMs as number, penaltiesMs: now[tap.teamId]!.penaltiesMs };
    const then = rankRace(
      race.entrants.map((x) => ({ teamId: x.teamId, result: x.teamId === tap.teamId ? withTap : now[x.teamId] })),
      { fallbackOrder: race.fallbackOrder, tieOrder: e.tieDecisions[race.id] },
    ).order[0]!;
    const winner = race.ranking.order[0]!;
    if (then === winner) continue;
    const who = nameOf(tap.round, tap.deviceId);
    warn('undo_changed_winner', tap.round, tap.deviceId, [tap.teamId],
      `${who ?? 'A referee'} removed a finish tap for ${team(tap.teamId)} in round ${tap.round}, which changed the winner from ${team(then)} to ${team(winner)}.`);
  }

  // repeat_team: a swap by race control gave a referee a team for the third time, or two rounds running.
  // One warning at the latest such round.
  const roundsOf = new Map<string, { deviceId: string; teamId: string; rounds: number[] }>();
  for (const [roundText, byDevice] of Object.entries(refereeTeams(e, d)).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    for (const [deviceId, teams] of Object.entries(byDevice)) {
      for (const teamId of new Set(teams)) {
        const k = `${deviceId}\u0000${teamId}`;
        const entry = roundsOf.get(k) ?? { deviceId, teamId, rounds: [] };
        entry.rounds.push(Number(roundText));
        roundsOf.set(k, entry);
      }
    }
  }
  for (const { deviceId, teamId, rounds } of roundsOf.values()) {
    // Only a repeat race control caused by hand: the app already picks the assignment with the fewest repeats, so
    // one it could not avoid (too few referees) is nothing anyone can act on. Those stay in the fairness report.
    const byHand = (r: number) => e.assignments?.[r]?.some((x) => x.deviceId === deviceId && x.swapped) ?? false;
    const hit = rounds.filter((r, i) => (i + 1 >= REPEAT_TEAM_TIMES || rounds.includes(r - 1)) && byHand(r)).at(-1);
    if (hit === undefined) continue;
    const upTo = rounds.filter((r) => r <= hit);
    const who = nameOf(hit, deviceId) ?? 'A referee';
    warn('repeat_team', hit, deviceId, [teamId], upTo.length >= REPEAT_TEAM_TIMES
      ? `${who} has had ${team(teamId)} at their tables ${upTo.length} times: rounds ${listed(upTo)}.`
      : `${who} had ${team(teamId)} at their tables in rounds ${hit - 1} and ${hit}.`);
  }

  // final_one_referee: a final whose two teams have the same referee, because no spare was free to split it.
  if (rotationOn(e) && perStation(e) === 2) {
    for (const { round, race } of races) {
      if (round > current || !FINALS.includes(race.role) || race.entrants.length !== 2) continue;
      const [a, b] = race.entrants as [typeof race.entrants[number], typeof race.entrants[number]];
      const judge = e.assignments?.[round]?.find((x) => x.tables.includes(a.table) && x.tables.includes(b.table));
      if (!judge) continue;
      warn('final_one_referee', round, judge.deviceId, [a.teamId, b.teamId],
        `The ${race.role === 'grand' ? 'Grand Championship' : 'final'} between ${team(a.teamId)} and ${team(b.teamId)} in round ${round} is judged by one referee, ${judge.name}.`);
    }
  }

  // referee_wins: over the bracket races, teams at one referee keep finishing better than their seeding predicted.
  // Predicted from the value the teams were seeded on: the total of their runs under the standard rule, otherwise
  // the score of the event's rule (best run, or the total without the slowest run).
  const totals: Record<string, number | null> = formatOf(e.setup).seedingRank === 'total'
    ? seedTotals(d, results)
    : seedScores(e.setup, seedRuns(e.setup, d, results));
  const tally = new Map<string, { races: number; better: number; worse: number }>();
  for (const { round, seeding, race } of races) {
    if (round > finished || seeding || race.entrants.length < 2) continue;
    const judges = race.entrants.map((x) => judgeOf(round, x.teamId, x.table));
    if (judges[0] !== null && judges.every((j) => j === judges[0])) continue;
    const seed = (id: string) => race.fallbackOrder.indexOf(id);
    const expected = race.entrants.map((x) => x.teamId)
      .sort((x, y) => ((totals[x] ?? Infinity) - (totals[y] ?? Infinity)) || seed(x) - seed(y));
    race.entrants.forEach((x, i) => {
      const judge = judges[i];
      if (judge === null || judge === undefined) return;
      const t = tally.get(judge) ?? { races: 0, better: 0, worse: 0 };
      const [actual, predicted] = [race.ranking.order.indexOf(x.teamId), expected.indexOf(x.teamId)];
      t.races++;
      if (actual < predicted) t.better++;
      else if (actual > predicted) t.worse++;
      tally.set(judge, t);
    });
  }
  for (const [deviceId, t] of tally) {
    if (t.races < WINS_MIN_RACES || t.better - t.worse < WINS_MARGIN) continue;
    const who = nameOf(finished, deviceId);
    warn('referee_wins', null, deviceId, [],
      `Teams at ${who ? `${who}'s` : "one referee's"} tables finished better than their seeding predicted in ${t.better} of ${t.races} races, and worse in ${t.worse}.`);
  }

  // Referee penalty taps that stand (not undone, not rejected), in finished rounds.
  const penalties = e.taps.filter((t) => t.kind === 'penalty' && t.source === 'referee' && t.deviceId !== undefined
    && t.removedAt === null && t.review?.status !== 'rejected' && t.round <= finished);

  // repeat_penalty: a referee penalised the same team in two or more rounds.
  const penalised = new Map<string, { deviceId: string; teamId: string; rounds: Set<number> }>();
  for (const t of penalties) {
    const k = `${t.deviceId}\u0000${t.teamId}`;
    const entry = penalised.get(k) ?? { deviceId: t.deviceId!, teamId: t.teamId, rounds: new Set<number>() };
    entry.rounds.add(t.round);
    penalised.set(k, entry);
  }
  for (const { deviceId, teamId, rounds } of penalised.values()) {
    if (rounds.size < REPEAT_PENALTY_ROUNDS) continue;
    const sorted = [...rounds].sort((a, b) => a - b);
    const last = sorted.at(-1)!;
    warn('repeat_penalty', last, deviceId, [teamId],
      `${nameOf(last, deviceId) ?? 'A referee'} gave ${team(teamId)} penalties in rounds ${listed(sorted)}.`);
  }

  // penalty_outlier: a referee far above the average number of penalties, or with none while the others give many.
  if (finished >= OUTLIER_FROM_ROUND) {
    // The referees: everyone with tables in a finished round, and every device that tapped in one.
    const referees = new Set<string>();
    for (const [roundText, saved] of Object.entries(e.assignments ?? {})) {
      if (Number(roundText) <= finished) for (const a of saved) referees.add(a.deviceId);
    }
    for (const t of e.taps) if (t.source === 'referee' && t.deviceId !== undefined && t.round <= finished) referees.add(t.deviceId);
    const count = (deviceId: string) => penalties.filter((t) => t.deviceId === deviceId).length;
    const average = referees.size ? penalties.length / referees.size : 0;
    for (const deviceId of referees) {
      const n = count(deviceId);
      const many = n >= OUTLIER_MIN && n > 2 * average;
      const none = n === 0 && average >= OUTLIER_AVG_FOR_NONE;
      if (!many && !none) continue;
      warn('penalty_outlier', null, deviceId, [],
        `${nameOf(finished, deviceId) ?? 'A referee'} has given ${n === 0 ? 'no' : n} penalties; the average per referee is ${average.toFixed(1)}.`);
    }
  }

  return [...out.values()].sort((a, b) => b.round - a.round || cmp(a.kind, b.kind) || cmp(a.id, b.id));
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The warnings split for race control: those still open, and those dismissed with their dismissal. */
export function fairnessOf(e: LiveEvent, d: DerivedEvent): { open: FairnessWarning[]; dismissed: (FairnessWarning & { dismissal: Dismissal })[] } {
  const all = fairnessWarnings(e, d);
  const dismissed = e.dismissed ?? {};
  return {
    open: all.filter((w) => !Object.hasOwn(dismissed, w.id)),
    dismissed: all.filter((w) => Object.hasOwn(dismissed, w.id)).map((w) => ({ ...w, dismissal: dismissed[w.id]! })),
  };
}
