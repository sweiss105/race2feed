import { describe, expect, it } from 'vitest';
import { applyCommand } from '../../src/core/apply';
import { fairnessCsv } from '../../src/core/fairnessExport';
import { fairnessWarnings } from '../../src/core/fairness';
import type { Actor, Command, LiveEvent, RosterEntry } from '../../src/core/model';
import { derive } from '../../src/core/results';
import { admin, ctx, lockedFour, ok, referee, roster, teamId } from './helpers';

const TITLES = ['Warnings', 'Race control edits', 'Referee assignments'];
const HEADERS = [
  'kind,round,referee,teams,message,status,dismissed_by,dismissed_at,note',
  'at,by,round,team,change',
  'round,referee,station,tables,teams',
];
const kim: Actor = { role: 'admin', label: 'kim@example.com' };
const iso = (ms: number) => new Date(ms).toISOString();

const run = (e: LiveEvent, cmd: Command, actor: Actor = admin, now = 2_000_000, r: RosterEntry[] = []) =>
  ok(applyCommand(e, cmd, { ...ctx(actor, now), roster: r }));

/** The rows of each section (without its title and header), by title. */
function sections(csv: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const block of csv.split('\n\n')) {
    const [title, , ...rows] = block.split('\n');
    if (title) out[title] = rows.filter((r) => r !== '');
  }
  return out;
}

/** Opens the next round with these referees, readies every station and starts it at `now`. */
function start(e: LiveEvent, now: number, r: RosterEntry[] = []): LiveEvent {
  e = run(e, { type: 'openNextRound' }, admin, now, r);
  for (const [s, st] of Object.entries(e.stations)) if (!st.excluded) e = run(e, { type: 'overrideStation', station: Number(s), state: 'ready' }, admin, now);
  return run(e, { type: 'startRace' }, admin, now);
}

/**
 * Round 1 with rotation on and two referees: T2 ("=SUM(A1)") gets a time 50 s faster than T1's, dismissed with a note;
 * race control adds, removes and rejects penalties and corrects a time.
 */
function raced(): LiveEvent {
  let e: LiveEvent = { ...lockedFour(), settings: { ...lockedFour().settings, rotateReferees: true } };
  e = lockedFourNamed(e);
  e = run(e, { type: 'setPenaltiesEnabled', enabled: true });
  e = start(e, 3_000_000, roster(2));
  const t = (name: string) => teamId(e, name);
  e = run(e, { type: 'tapPenalty', teamId: t('T1'), clientTapId: 'p' }, { ...referee(1), deviceId: 'dev1' }, 3_001_000);
  const fromReferee = e.taps.at(-1)!.id;
  e = run(e, { type: 'setResult', round: 1, teamId: t('T1'), set: { kind: 'time', rawMs: 200_000 } }, kim, 3_010_000);
  e = run(e, { type: 'setResult', round: 1, teamId: t('=SUM(A1)'), set: { kind: 'time', rawMs: 150_000 } }, kim, 3_020_000);
  e = run(e, { type: 'setResult', round: 1, teamId: t('T3'), set: { kind: 'status', status: 'dnf' } }, kim, 3_030_000);
  e = run(e, { type: 'setResult', round: 1, teamId: t('T4'), set: { kind: 'status', status: 'dns' } }, kim, 3_040_000);
  e = run(e, { type: 'finishRace' }, admin, 3_050_000);
  e = run(e, { type: 'decidePenalty', tapId: fromReferee, decision: 'reject' }, kim, 3_060_000);
  e = run(e, { type: 'addPenalty', round: 1, teamId: t('=SUM(A1)'), reasonId: 'sealed' }, kim, 3_070_000);
  e = run(e, { type: 'removePenalty', tapId: e.taps.at(-1)!.id }, admin, 3_080_000);
  e = run(e, { type: 'setResult', round: 1, teamId: t('T3'), set: { kind: 'clear' } }, kim, 3_090_000);
  e = run(e, { type: 'setResult', round: 1, teamId: t('T3'), set: { kind: 'time', rawMs: 221_200 } }, kim, 3_100_000);
  const fast = fairnessWarnings(e, derive(e)).find((w) => w.kind === 'fast_time')!;
  return run(e, { type: 'dismissWarning', id: fast.id, note: 'Checked, "fine"' }, kim, 3_200_000);
}

const lockedFourNamed = (e: LiveEvent) => run(e, { type: 'renameTeam', teamId: teamId(e, 'T2'), name: '=SUM(A1)' });

describe('fairnessCsv', () => {
  it('has three sections in order, each a title, a header and a blank line', () => {
    const lines = fairnessCsv(raced()).split('\n');
    const at = TITLES.map((t) => lines.indexOf(t));
    expect(at[0]).toBe(0);
    expect(at[1]).toBeGreaterThan(at[0]!);
    expect(at[2]).toBeGreaterThan(at[1]!);
    TITLES.forEach((_, i) => expect(lines[at[i]! + 1]).toBe(HEADERS[i]));
    expect(lines[at[1]! - 1]).toBe('');
    expect(lines[at[2]! - 1]).toBe('');
    expect(lines.at(-1)).toBe('');
    expect(lines.at(-2)).not.toBe('');
  });

  it('gives an event with nothing to report the three headers and no rows', () => {
    expect(fairnessCsv(lockedFour())).toBe(`${TITLES.map((t, i) => `${t}\n${HEADERS[i]}\n`).join('\n')}`);
    const stored = lockedFour();
    delete stored.assignments;
    delete stored.dismissed;
    delete stored.settings.rotateReferees;
    expect(sections(fairnessCsv(stored))).toEqual({ Warnings: [], 'Race control edits': [], 'Referee assignments': [] });
  });

  it('lists every warning with its status, and a dismissed one with who, when and the note', () => {
    const e = raced();
    const rows = sections(fairnessCsv(e)).Warnings!;
    const all = fairnessWarnings(e, derive(e));
    expect(rows).toHaveLength(all.length);
    expect(rows).toContain(
      `fast_time,1,Ref 1,'=SUM(A1),'=SUM(A1)'s time of 2:30.00 in round 1 is 50.0 s faster than the fastest time before it.,dismissed,kim@example.com,${iso(3_200_000)},"Checked, ""fine"""`);
    // Every other warning is open, with the dismissal cells empty.
    expect(rows.filter((r) => r.endsWith(',open,,,'))).toHaveLength(all.length - 1);
  });

  it('lists late finishes race control confirmed or rejected, not ones still waiting', () => {
    const base = raced();
    const tap = (id: string, name: string, hold: NonNullable<LiveEvent['taps'][number]['hold']>): LiveEvent['taps'][number] => ({
      id, kind: 'finish', round: 1, teamId: base.setup.teams.find((t) => t.name === name)!.id, elapsedMs: 200_450, lateMs: 45_300,
      source: 'referee', deviceId: 'dev1', createdAt: 3_000_000, removedAt: hold.status === 'rejected' ? 3_300_000 : null, hold,
    });
    const e = { ...base, taps: [...base.taps,
      tap('h1', 'T1', { status: 'confirmed', decidedAt: 3_300_000, by: 'kim@example.com' }),
      tap('h2', 'T3', { status: 'rejected', decidedAt: 3_310_000, by: 'kim@example.com' }),
      tap('h3', 'T4', { status: 'pending' }),
    ] };
    const rows = sections(fairnessCsv(e))['Race control edits']!;
    expect(rows.slice(-2)).toEqual([
      `${iso(3_300_000)},kim@example.com,1,T1,"late finish confirmed (3:20.45, received 45 s late)"`,
      `${iso(3_310_000)},kim@example.com,1,T3,"late finish rejected (3:20.45, received 45 s late)"`,
    ]);
    expect(rows.join()).not.toContain('T4,late');
  });

  it('lists what race control entered, changed or removed by hand, in time order', () => {
    const rows = sections(fairnessCsv(raced()))['Race control edits']!;
    expect(rows).toEqual([
      `${iso(3_010_000)},kim@example.com,1,T1,time 3:20.00`,
      `${iso(3_020_000)},kim@example.com,1,'=SUM(A1),time 2:30.00`,
      `${iso(3_030_000)},kim@example.com,1,T3,DNF`,
      `${iso(3_040_000)},kim@example.com,1,T4,DNS`,
      `${iso(3_060_000)},kim@example.com,1,T1,penalty rejected`,
      `${iso(3_070_000)},kim@example.com,1,'=SUM(A1),penalty added: Bag not sealed`,
      `${iso(3_080_000)},admin,1,'=SUM(A1),penalty removed`,
      `${iso(3_090_000)},kim@example.com,1,T3,cleared`,
      `${iso(3_100_000)},kim@example.com,1,T3,time 3:41.20`,
    ]);
  });

  it('leaves out a referee\'s own taps and undos, and has an empty "by" for records stored before it was saved', () => {
    let e = start(run(lockedFour(), { type: 'setPenaltiesEnabled', enabled: true }), 3_000_000);
    e = run(e, { type: 'tapFinish', teamId: teamId(e, 'T1'), atServerMs: 3_005_000, clientTapId: 'f' }, referee(1), 3_005_000);
    e = run(e, { type: 'tapPenalty', teamId: teamId(e, 'T1'), clientTapId: 'p' }, referee(1), 3_006_000);
    e = run(e, { type: 'undoTap', tapId: e.taps.at(-1)!.id }, referee(1), 3_007_000);
    e = run(e, { type: 'tapPenalty', teamId: teamId(e, 'T2'), clientTapId: 'q' }, referee(1), 3_008_000);
    const approved = e.taps.at(-1)!.id;
    expect(sections(fairnessCsv(e))['Race control edits']).toEqual([]);
    e = run(e, { type: 'setResult', round: 1, teamId: teamId(e, 'T2'), set: { kind: 'time', rawMs: 200_000 } }, kim, 3_010_000);
    e = run(e, { type: 'decidePenalty', tapId: approved, decision: 'approve', reasonId: 'early' }, kim, 3_011_000);
    e = run(e, { type: 'addPenalty', round: 1, teamId: teamId(e, 'T2'), reasonId: 'count' }, kim, 3_012_000);
    // Race control takes back a referee's penalty it had approved.
    e = run(e, { type: 'removePenalty', tapId: approved }, kim, 3_013_000);
    const stored = structuredClone(e);
    for (const t of stored.taps) { delete t.by; delete t.removedBy; }
    for (const o of stored.overrides) delete o.by;
    expect(sections(fairnessCsv(stored))['Race control edits']).toEqual([
      `${iso(3_010_000)},,1,T2,time 3:20.00`,
      `${iso(3_012_000)},,1,T2,penalty added: Wrong item count`,
      `${iso(3_013_000)},,1,T2,penalty removed`,
    ]);
  });

  it('lists one row per referee per round, by round then station', () => {
    let e = raced();
    e = start(e, 4_000_000, roster(2));
    const rows = sections(fairnessCsv(e))['Referee assignments']!;
    const cell = (name: string) => (name.startsWith('=') ? `'${name}` : name);
    const expected = [1, 2].flatMap((round) => e.assignments![round]!.map((a) => {
      const teams = derive(e).rounds[round - 1]!.races.flatMap((r) => r.entrants).filter((x) => a.tables.includes(x.table))
        .sort((x, y) => x.table - y.table).map((x) => e.setup.teams.find((t) => t.id === x.teamId)!.name);
      return `${round},${a.name},${a.station},${a.tables.join('; ')},${cell(teams.join('; '))}`;
    }));
    expect(rows).toEqual(expected);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toBe("1,Ref 1,1,1; 2,T1; =SUM(A1)");
    expect(rows.map((r) => r.split(',')[0])).toEqual(['1', '1', '2', '2']);
  });

  it('neutralises a formula in a team name, a referee name and a note, in all three sections', () => {
    let e = raced();
    e = { ...e, assignments: { 1: e.assignments![1]!.map((a) => (a.deviceId === 'dev2' ? { ...a, name: '@Ref' } : a)) } };
    e = run(e, { type: 'renameTeam', teamId: teamId(e, 'T3'), name: '+T3' });
    e = run(e, { type: 'dismissWarning', id: e.dismissed ? Object.keys(e.dismissed)[0]! : '', note: '=HYPERLINK("http://x")' }, kim, 3_300_000);
    const csv = fairnessCsv(e);
    const parts = sections(csv);
    expect(parts.Warnings!.some((r) => r.includes(",'=SUM(A1),'=SUM(A1)'s time"))).toBe(true);
    expect(csv).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(parts['Race control edits']!.some((r) => r.includes(",'=SUM(A1),time"))).toBe(true);
    expect(parts['Race control edits']!.some((r) => r.includes(",'+T3,"))).toBe(true);
    expect(parts['Referee assignments']).toContain("1,'@Ref,2,3; 4,'+T3; T4");
    // No cell anywhere starts with a formula character.
    expect(csv).not.toMatch(/(^|,)"?[=+@-]/m);
  });
});
