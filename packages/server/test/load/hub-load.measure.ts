/**
 * Hub load profile: how much CPU and bandwidth the hub spends per connection, per tap and per
 * broadcast, for events of several sizes. It answers "can one hub serve N phones?" before any
 * load test is run against a deployed Worker.
 *
 * Run with `npm run measure:hub`. It is not part of `npm test`. Environment variables:
 *   R2F_PEOPLE  phones connected to the hub (default 1750)
 *   R2F_TEAMS   comma-separated team counts to profile (default 50,100,200)
 *
 * Timings are taken in Node, which uses the same V8 engine as Workers. Treat them as an
 * estimate: the Workers runtime can be somewhat slower per request, so leave headroom.
 * The report is printed and saved to test-results/hub-load.md.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { it } from 'vitest';
import { stationOfTable } from '@race2feed/engine';
import { applyCommand } from '../../src/core/apply';
import type { Actor, Command, LiveEvent } from '../../src/core/model';
import { derive } from '../../src/core/results';
import { companionView, controlView, publicRoundUpdate, publicView, refereeView } from '../../src/core/views';
import { admin, blank, csvFor, ctx, ok, referee } from '../core/helpers';

// Race control and admin are one role now.
const control = admin;

const PEOPLE = Number(process.env.R2F_PEOPLE ?? 1750);
const TEAM_COUNTS = (process.env.R2F_TEAMS ?? '50,100,200').split(',').map(Number);
const REPORT = resolve(__dirname, '../../../../test-results/hub-load.md');

// ---------- building events ----------

/** The previous event's shape (HS 14, Community 16, Corporate 20 on 26 tables), scaled to `teams`. */
function lockedEvent(teams: number): LiveEvent {
  const hs = Math.round((teams * 14) / 50);
  const community = Math.round((teams * 16) / 50);
  const counts = { 'High School': hs, Community: community, Corporate: teams - hs - community };
  const tables = Math.ceil((teams * 26) / 50);
  const run = (e: LiveEvent, cmd: Command) => ok(applyCommand(e, cmd, ctx(admin)));
  let e = run(blank(tables), { type: 'importTeams', csv: csvFor(counts) });
  e = run(e, { type: 'suggestSetup' });
  return run(e, { type: 'lockSetup' });
}

/** A distinct, repeatable finish time per team and round, so no race ever needs a tie decision. */
function finishMs(round: number, index: number): number {
  return 150_000 + ((round * 7919 + index * 104_729) % 90_000) + index;
}

type Snapshots = { beforeFirst: LiveEvent; seedingMid: LiveEvent; bracketMid: LiveEvent; complete: LiveEvent; rounds: number };

/** Drives the whole event through commands and keeps the states worth measuring. */
function runEvent(start: LiveEvent): Snapshots {
  let now = 10_000_000;
  const run = (e: LiveEvent, cmd: Command, actor: Actor) => ok(applyCommand(e, cmd, ctx(actor, now)));
  let e = start;
  const rounds = derive(e).rounds.length;
  const firstBracket = derive(e).rounds.find((r) => r.spec.kind !== 'seeding')?.spec.round ?? rounds;
  let seedingMid = e;
  let bracketMid = e;

  for (let round = 1; round <= rounds; round++) {
    e = run(e, { type: 'openNextRound' }, control);
    for (const [s, st] of Object.entries(e.stations)) {
      if (!st.excluded) e = run(e, { type: 'overrideStation', station: Number(s), state: 'ready' }, control);
    }
    e = run(e, { type: 'startRace' }, control);
    const startedAt = e.round.startedAt!;
    now = startedAt + 600_000;
    const entrants = derive(e).rounds[round - 1]!.races.flatMap((r) => r.entrants);
    entrants.forEach(({ teamId, table }, i) => {
      if (i === Math.floor(entrants.length / 2)) {
        if (round === 1) seedingMid = e;
        if (round === firstBracket) bracketMid = e;
      }
      e = run(e, { type: 'tapFinish', teamId, atServerMs: startedAt + finishMs(round, i), clientTapId: `${round}-${teamId}` },
        referee(stationOfTable(table)));
    });
    e = run(e, { type: 'finishRace' }, control);
    now += 60_000;
  }
  e = run(e, { type: 'showChampion', bagTotal: '12,500' }, control);
  return { beforeFirst: start, seedingMid, bracketMid, complete: e, rounds };
}

// ---------- measuring ----------

/** Median wall time of `fn` in milliseconds, after a warm-up. */
function medianMs(fn: () => unknown, iterations = 40): number {
  for (let i = 0; i < 5; i++) fn();
  const samples: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const t = performance.now();
    fn();
    samples.push(performance.now() - t);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)]!;
}

/** Stand-ins for the control view's device list and audit tail, at event-day size. */
function controlExtras(e: LiveEvent) {
  const devices = Object.keys(e.stations).map((s, i) => ({
    id: `device-${i}`, station: Number(s), label: `Referee ${s}`, created_at: 1, revoked_at: null, last_seen: 1,
  }));
  const audit = Array.from({ length: 50 }, (_, i) => ({ at: i, actor: 'ref 1', action: 'tapFinish', detail: '{"teamId":"x","atServerMs":1}' }));
  return { devices, audit };
}

/** What the hub does when a phone connects: derive, build the public view, serialize (hub.initialMessage). */
function connectMessage(e: LiveEvent): string {
  return JSON.stringify({ type: 'snapshot', view: publicView(e, derive(e)) });
}

/** What the hub does for one referee tap: apply it, then rebuild every view it pushes (hub.afterChange). */
function tapWork(e: LiveEvent, tap: Command, station: number) {
  const next = ok(applyCommand(e, tap, ctx(referee(station), e.round.startedAt! + 600_000)));
  const d = derive(next);
  JSON.stringify({ type: 'view', view: controlView(next, d, { ...controlExtras(next), roster: [] }) });
  JSON.stringify({ type: 'view', view: companionView(next, d) });
  for (const s of Object.keys(next.stations)) JSON.stringify({ type: 'view', view: refereeView(next, d, { station: Number(s) }) });
  JSON.stringify({ type: 'round', update: publicRoundUpdate(next, d) });
}

/** The next untapped entrant in the running round, as a tapFinish command. */
function nextTap(e: LiveEvent): { tap: Command; station: number } {
  const d = derive(e);
  const results = e.taps
    .filter((t) => t.kind === 'finish' && t.removedAt === null && t.round === e.round.current)
    .map((t) => t.teamId);
  const entrants = d.rounds[e.round.current - 1]!.races.flatMap((r) => r.entrants);
  const i = entrants.findIndex((x) => !results.includes(x.teamId));
  const { teamId, table } = entrants[i]!;
  return {
    tap: { type: 'tapFinish', teamId, atServerMs: e.round.startedAt! + finishMs(e.round.current, i), clientTapId: 'measure' },
    station: stationOfTable(table),
  };
}

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;
const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const ms = (n: number) => (n < 10 ? `${n.toFixed(2)} ms` : `${n.toFixed(0)} ms`);
const sec = (n: number) => (n < 1000 ? `${n.toFixed(0)} ms` : `${(n / 1000).toFixed(1)} s`);

type Row = { teams: number; rounds: number; state: string; snapshot: number; gzip: number; connect: number; round: number | null; tap: number | null };

function measure(teams: number): Row[] {
  const snaps = runEvent(lockedEvent(teams));
  const states: [string, LiveEvent, boolean][] = [
    ['before round 1', snaps.beforeFirst, false],
    ['seeding round running', snaps.seedingMid, true],
    ['first bracket round running', snaps.bracketMid, true],
    ['event complete', snaps.complete, false],
  ];
  return states.map(([state, e, running]) => {
    const snapshot = connectMessage(e);
    const row: Row = {
      teams, rounds: snaps.rounds, state,
      snapshot: Buffer.byteLength(snapshot),
      gzip: gzipSync(snapshot).length,
      connect: medianMs(() => connectMessage(e)),
      round: null,
      tap: null,
    };
    if (running) {
      row.round = Buffer.byteLength(JSON.stringify({ type: 'round', update: publicRoundUpdate(e, derive(e)) }));
      const { tap, station } = nextTap(e);
      row.tap = medianMs(() => tapWork(e, tap, station));
    }
    return row;
  });
}

function report(rows: Row[]): string {
  const lines = [
    `# Hub load profile`,
    '',
    `${PEOPLE} phones connected. Generated ${new Date().toISOString()} on Node ${process.version}.`,
    '',
    '## Per message',
    '',
    '| Teams | State | Snapshot | Snapshot gzipped | Round update | Build one snapshot | One referee tap |',
    '|---:|---|---:|---:|---:|---:|---:|',
    ...rows.map((r) => `| ${r.teams} | ${r.state} | ${kb(r.snapshot)} | ${kb(r.gzip)} | ${r.round === null ? '-' : kb(r.round)} | ${ms(r.connect)} | ${r.tap === null ? '-' : ms(r.tap)} |`),
    '',
    `## For ${PEOPLE} phones`,
    '',
    '- **Reconnect storm:** every phone reconnects after a deploy or restart, and the hub builds each one its own snapshot, one at a time.',
    '- **Snapshot broadcast:** one snapshot sent to every phone (after open round, start, finish, ties, setup changes).',
    '- **Round updates:** the update sent to every phone while a round runs, at most once a second and only after a change (a tap, undo or penalty). The figure is the peak rate during a burst of finishes.',
    '- These are the hub\'s own costs. Cloudflare\'s per-socket send and accept overhead is not included: only a load test against a deployed Worker measures that.',
    '',
    '| Teams | State | Reconnect storm (hub busy) | Snapshot broadcast | Round updates |',
    '|---:|---|---:|---:|---:|',
    ...rows.map((r) => `| ${r.teams} | ${r.state} | ${sec(r.connect * PEOPLE)} | ${mb(r.snapshot * PEOPLE)} | ${r.round === null ? '-' : `${mb(r.round * PEOPLE)}/s`} |`),
    '',
  ];
  return lines.join('\n');
}

it(`profiles the hub for ${PEOPLE} phones`, () => {
  const rows = TEAM_COUNTS.flatMap(measure);
  const text = report(rows);
  mkdirSync(dirname(REPORT), { recursive: true });
  writeFileSync(REPORT, text);
  console.log(`\n${text}\nSaved to ${REPORT}`);
}, 600_000);
