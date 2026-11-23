# Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the bugs found in the two code reviews of 2026-11-23 that are still present on `main` (commit `3797011`).

**Architecture:** One new stored record: each round's line-up is saved when the round is opened, and bracket membership is saved when the first bracket round is opened. The rules engine reads opened rounds from that record and builds only unopened rounds from results. Everything else tightens an existing unit: the referee tap queue, the referee page's undo and messages, referee authentication, setup validation, the group suggestion, the live views, and the CSV export. Server rules stay in the pure `packages/server/src/core` functions; the hub only wires them.

**Tech Stack:** TypeScript, Cloudflare Workers + Durable Object (SQLite), Preact, Vitest (projects `engine`, `server-core`, `server-worker`, `web`), Playwright.

**Spec:** `docs/design.md` (§3.2, §4, §5, §6, §7.3, §9). `CLAUDE.md` sets the doc rules.

## Global Constraints

- `CLAUDE.md`: any change to what staff see or do updates `docs/user-guide.md` in the same commit; `docs/design.md` changes before or alongside behaviour changes.
- Run a single file with `npx vitest run <path>`. Do not use `npm test` for one file: it rebuilds the web bundle first.
- Before the last commit of every task: `npm run typecheck` and `npm test` both pass.
- Never skip, loosen or delete an existing assertion to get green. Where this plan changes behaviour, it names the existing assertion that changes and its new value.
- Results stay keyed by team id. Events stored before this plan have no saved line-ups and must keep loading.
- No new dependencies.

## Decisions (made by the user, 2026-11-23)

1. **Late corrections: record and re-tabulate.** Each round's line-up is saved when it opens. A late correction updates times and seeding; opened rounds keep their real line-ups and winners; unopened rounds are built from the corrected data. Race control is warned first when an opened round's line-up no longer matches the corrected data.
2. **Seeding group suggestion: keep categories together.** Groups are filled in category order up to the table count (14/16/20 teams on 26 tables gives A = 14 High School + 12 Community, B = 4 Community + 20 Corporate).

## Review Focus

Failure modes the spec implies that are most likely to bite on event day. Each is pinned by a test in the task named.

1. Race control fixes a seeding time after bracket rounds have been raced: raced rounds keep their line-ups and winners (Task 1).
2. A seeding fix lands after the lower brackets' heats opened and before the upper brackets' heats: no team may end up in two brackets or in none (Task 1).
3. A tablet's browser storage is full or blocked and Wi-Fi drops: a tap made offline must still be sent (Task 2).
4. Both teams at a station finish within the undo window: each tap must be undoable on its own (Task 3).
5. An organiser signed in to race control opens a pairing QR on the same browser: the referee page must work as a referee (Task 4).

---

### Task 1: Saved line-ups, part 1 — the engine reads opened rounds from a record

**Files:**
- Modify: `packages/engine/src/types.ts` (`EventProgress`), `packages/engine/src/event.ts` (`RaceView`, `DerivedEvent`, `deriveEvent`)
- Test: `packages/engine/test/event-lineups.test.ts` (create; reuse builders from `packages/engine/test/helpers/events.ts`)

**Interfaces:**
- Produces, in `types.ts`:

```ts
export type RaceRole = 'seed' | 'heat' | 'final' | 'winners' | 'others' | 'grand';
/** One race as it was published when its round opened. */
export interface SavedRace { id: string; label: string; bracketId?: string; role: RaceRole; teams: string[]; tables: number[]; fallbackOrder: string[] }
export interface EventProgress {
  // existing fields unchanged, plus:
  /** round → the races it was opened with. A round listed here is never rebuilt. */
  lineups?: Record<number, SavedRace[]>;
  /** bracketId → team ids in seed order, as they stood when the first bracket round opened. */
  bracketMembers?: Record<string, string[]>;
}
```

- Produces, in `event.ts`: `RaceView` gains `role: RaceRole` and `fallbackOrder: string[]`; `DerivedEvent` gains `bracketMembers: Record<string, string[]> | null` (null until the first non-seeding round is reached). `deriveEvent(input, progress)` keeps its signature.

**Rules:**
- For a round with `progress.lineups[round]`, races come from the saved record (ids, labels, teams, tables, fallback order); rankings are still computed from current results and tie decisions.
- Which races decide a bracket (`heats`, `final`, `winners`, `others`) and which race is the grand race are taken from `role` + `bracketId`, for saved and built rounds alike.
- When `progress.bracketMembers` is present it replaces the membership computed from seed ranks. `seedRank` itself is always computed from current results.
- Unopened placement rounds are built from the rankings of the (saved or built) heats; an unopened grand race from the bracket winners.

- [ ] **Step 1: Write the failing tests** (four teams T1–T4 in one category, 4 tables, grand off; seeding times 60/61/62/63 s in both runs unless stated):

```ts
it('reads an opened round from its saved line-up, whatever the results now say', () => {
  // lineups[3] = heats saved as [T1,T4] on tables [1,2] and [T2,T3] on [3,4]
  // results: round 1 T4 = 1_000 ms (T4 now ranks 1), finishedRounds 2
  // expect rounds[2].races entrants === [[T1@1,T4@2],[T2@3,T3@4]] and seedRank[T4] === 1
});

it('builds the placement round from the saved heats', () => {
  // as above plus round-3 results T1 50s, T4 55s, T2 51s, T3 56s, finishedRounds 3
  // expect rounds[3] winners race teams [T1,T2], others race [T4,T3]
});

it('uses saved bracket membership for brackets whose heats are not open yet', () => {
  // 12 teams, one category, 12 tables → brackets Gold(1-4), Silver(5-8), Bronze(9-12); rounds: 2 seeding, r3 lower heats, r4 upper heats
  // bracketMembers saved from the original ranks; lineups[3] saved; then round-1 result changed so seeds 8 and 9 swap; finishedRounds 3
  // expect every team to appear in exactly one race across rounds[2] and rounds[3]
});

it('derives exactly as before when nothing is saved', () => {
  // for the acceptance fixture: deriveEvent(input, progress) deep-equals deriveEvent(input, { ...progress, lineups: {} })
});
```

- [ ] **Step 2: Run** `npx vitest run packages/engine/test/event-lineups.test.ts` — Expected: FAIL (unknown fields ignored, rounds rebuilt).
- [ ] **Step 3: Implement** per the rules above.
- [ ] **Step 4: Run** `npx vitest run packages/engine` — Expected: PASS, including the unchanged acceptance test.
- [ ] **Step 5: Commit** — `feat(engine): derive opened rounds from saved line-ups`

---

### Task 1b (run directly after Task 1): Saved line-ups, part 2 — the server records them and corrections re-tabulate

**Files:**
- Modify: `packages/server/src/core/model.ts` (`LiveEvent`), `packages/server/src/core/results.ts` (`buildProgress`), `packages/server/src/core/lifecycle.ts` (`openNextRound`), `packages/server/src/core/corrections.ts`
- Create: `packages/server/src/core/lineups.ts`
- Modify: `packages/server/src/hub.ts` (`loadActive`)
- Modify: `packages/web/src/pages/control/runner.tsx:18-76`
- Modify: `docs/design.md:195-197` and §10 "Core data", `docs/user-guide.md:232-233,267`
- Test: `packages/server/test/core/lineups.test.ts` (create), `packages/server/test/core/taps.test.ts:143-164`, `packages/server/test/core/lifecycle.test.ts:90-94`, `packages/web/test/pages/control-race.test.tsx`

**Interfaces:**
- Consumes: `SavedRace`, `EventProgress.lineups`, `EventProgress.bracketMembers`, `RaceView.role`, `RaceView.fallbackOrder`, `DerivedEvent.bracketMembers` from Task 1.
- Produces:
  - `LiveEvent.lineups?: Record<number, SavedRace[]>` and `LiveEvent.bracketMembers?: Record<string, string[]>` (both optional: missing on events stored before this change).
  - `lineups.ts`: `saveLineup(e: LiveEvent, round: number): LiveEvent` — returns `e` with that round's races saved from `derive(e)`, and with `bracketMembers` saved if the round is not a seeding round and none is saved yet. `backfillLineups(e: LiveEvent): LiveEvent` — saves every round `1..e.round.current` that has none; returns `e` itself when nothing is missing.
  - `checkCorrection(before, after, round, confirm)` keeps its signature. `unlock_required` detail becomes `{ laterRounds: number[]; keptRounds: number[] }`. The `changes_current_round` refusal is removed everywhere.

**Rules:**
- `openNextRound` returns `saveLineup` of the event with the new round number.
- `buildProgress` passes `lineups` and `bracketMembers` through.
- `checkCorrection` when `round < current`: `keptRounds` is every round in `round+1..current` whose saved line-up differs from what `after` would produce with `lineups` and `bracketMembers` removed. Without `confirm` → `unlock_required` with `{ laterRounds, keptRounds }`. With `confirm` → `null`.
- The hub calls `backfillLineups` on the active event when it loads it, and stores the result if it changed, so an event already in progress at deploy time is protected.

- [ ] **Step 1: Write the failing tests** in `lineups.test.ts` (helpers from `./helpers`: `lockedFour`, `runRound`, `teamId`, `ctx`, `control`, `admin`, `ok`, `blank`, `csvFor`):

```ts
const names = (e: LiveEvent, round: number) =>
  derive(e).rounds[round - 1]!.races.map((r) => r.entrants.map((x) => e.setup.teams.find((t) => t.id === x.teamId)!.name).join(' v '));
const times = { T1: 60_000, T2: 61_000, T3: 62_000, T4: 63_000 };

it('saves the line-up when a round opens', () => {
  const e = ok(handleLifecycle(lockedFour(), { type: 'openNextRound' }, ctx(control)));
  expect(e.lineups![1]!.map((r) => r.teams.length)).toEqual([1, 1, 1, 1]);
});

it('a confirmed seeding correction re-tabulates without changing a raced round', () => {
  let e = runRound(runRound(lockedFour(), times), times);
  e = runRound(e, { T1: 50_000, T4: 55_000, T2: 51_000, T3: 56_000 });
  const cmd = { type: 'setResult' as const, round: 1, teamId: teamId(e, 'T4'), set: { kind: 'time' as const, rawMs: 1_000 } };
  const asked = handleTaps(e, cmd, ctx(control, 9_000_000));
  expect(asked.ok ? 'ok' : asked.code).toBe('unlock_required');
  if (!asked.ok) expect(asked.detail).toEqual({ laterRounds: [2, 3], keptRounds: [3] });
  const after = ok(handleTaps(e, { ...cmd, confirmUnlock: true }, ctx(control, 9_000_000)));
  expect(names(after, 3)).toEqual(['T1 v T4', 'T2 v T3']);
  expect(derive(after).seedRank![teamId(e, 'T4')]).toBe(1);
  expect(derive(after).rounds[3]!.races.map((r) => r.entrants.length)).toEqual([2, 2]); // placement still built from the raced heats
});

it('keeps every team in exactly one bracket when seeding is corrected between bracket rounds', () => {
  // blank(12) + importTeams csvFor({ T: 12 }) + setGrandChampionship false + suggestSetup + lockSetup
  // run seeding rounds 1 and 2 with strictly increasing times; open round 3 (Bronze heats)
  // confirmed setResult on round 1 that swaps seeds 8 and 9
  // finish round 3 with any times, open round 4
  // expect the 12 team ids across rounds 3 and 4 to be 12 distinct ids
});

it('backfills line-ups for an event stored before they existed', () => {
  let e = runRound(runRound(lockedFour(), times), times);
  const legacy = { ...e, lineups: undefined, bracketMembers: undefined };
  const filled = backfillLineups(legacy);
  expect(Object.keys(filled.lineups!)).toEqual(['1', '2']);
  expect(backfillLineups(filled)).toBe(filled);
});
```

- [ ] **Step 2: Update the existing assertions that pin the old behaviour**
  - `taps.test.ts` "a correction to an earlier round needs confirmation…": detail becomes `{ laterRounds: [2, 3], keptRounds: [] }`.
  - `taps.test.ts` "lists the rounds whose matchups a correction would change": detail becomes `{ laterRounds: [3], keptRounds: [3] }`.
  - `taps.test.ts` "never reshuffles the round that is open or running, even when confirmed": the confirmed command now succeeds; assert `names(result, 3)` equals `names(e, 3)`.
  - `lifecycle.test.ts:92-94`: the unconfirmed `decideTie` still expects `unlock_required`; the confirmed one now succeeds and round 4's line-up is unchanged.
- [ ] **Step 3: Run** `npx vitest run packages/server/test/core` — Expected: the new tests and the edited ones FAIL.
- [ ] **Step 4: Implement** per the rules above.
- [ ] **Step 5: Run** `npx vitest run packages/server` — Expected: PASS.
- [ ] **Step 6: Web.** In `runner.tsx`: `Pending.changedRounds` becomes `keptRounds`; remove the `changes_current_round` branch; the confirm sheet's second paragraph reads, when `keptRounds` is non-empty, **"{Round 3} was opened with its original line-up and keeps it. The corrected results will not match who raced there."** and otherwise "No line-ups are affected." In `control-race.test.tsx` extend the existing `unlock_required` test (line ~77) with a case whose detail is `{ laterRounds: [2, 3], keptRounds: [3] }` and assert the dialog contains "Round 3 was opened with its original line-up and keeps it."
- [ ] **Step 7: Run** `npx vitest run packages/web/test/pages/control-race.test.tsx` and `npm run e2e` — Expected: PASS; 3 passed.
- [ ] **Step 8: Docs.** `design.md` §4 "Late corrections": "Each round's line-up is saved when the round is opened, and bracket membership when the first bracket round is opened. After a later round has opened, an edit needs an explicit **unlock**, which names any opened rounds that keep a line-up the corrected results no longer match. Opened rounds are never rebuilt; rounds not yet opened are built from the corrected results." Add "RoundLineup, BracketMembers" to §10 Core data. `user-guide.md:232-233,267`: describe the same in staff terms, including that a team stays in the bracket it raced in even if its corrected seed differs.
- [ ] **Step 9: Commit** — `fix(server): save round line-ups so late corrections never rewrite raced rounds`

---

### Task 2: Tap queue survives a storage failure and reports each answer

**Files:**
- Modify: `packages/web/src/lib/queue.ts`
- Test: `packages/web/test/lib/queue.test.ts`

**Interfaces:**
- Produces: `TapQueue.flush(send, onAnswer?: (entry: QueuedTap, ack: Ack) => void): Promise<number>`; `all()`, `add()`, `drop()`, `settle()` unchanged in signature. Task 3 uses `onAnswer`.

- [ ] **Step 1: Write the failing tests**

```ts
it('keeps taps in memory when storage cannot be written', () => {
  const storage = new MemoryStorage();
  storage.setItem = () => { throw new Error('QuotaExceededError'); };
  const q = new TapQueue(storage);
  q.add(entry('a'));
  expect(q.all().map((e) => e.clientTapId)).toEqual(['a']);
  q.settle('a', { ok: true });
  expect(q.all()).toEqual([]);
});

it('reports every answer from a flush', async () => {
  const q = new TapQueue(new MemoryStorage());
  ['a', 'b'].forEach((id) => q.add(entry(id)));
  const seen: [string, boolean][] = [];
  await q.flush(async (cmd: any) => (cmd.clientTapId === 'a' ? { ok: true } : { ok: false, code: 'already_finished', message: 'no' }),
    (e, ack) => seen.push([e.clientTapId, ack.ok]));
  expect(seen).toEqual([['a', true], ['b', false]]);
});
```

- [ ] **Step 2: Run** `npx vitest run packages/web/test/lib/queue.test.ts` — Expected: both FAIL.
- [ ] **Step 3: Implement.** The queue holds its list in memory, loaded from storage once in the constructor; every change writes through to storage inside the existing try/catch; `all()` returns a copy of the in-memory list. `flush` calls `onAnswer` after `settle` for each entry. The existing "survives a reload" test must still pass unchanged.
- [ ] **Step 4: Run the same command** — Expected: PASS (all queue tests).
- [ ] **Step 5: Commit** — `fix(web): keep queued taps in memory when storage fails`

---

### Task 3: Referee undo per tap, and messages that tell the truth

**Files:**
- Modify: `packages/web/src/pages/referee/RefereePage.tsx` (state at lines 25-35, flush effect, `tap`, `undo`, `UndoBar`, the render at the end)
- Modify: `packages/web/src/pages/referee/referee.css` (stacked undo rows)
- Modify: `docs/user-guide.md` (referee section: undo wording)
- Test: `packages/web/test/pages/referee.test.tsx`

**Interfaces:**
- Consumes: `TapQueue.flush(send, onAnswer)` from Task 2; view fields already present: `team.taps[].{ id, clientTapId, kind, createdAt, removedAt, review.status }`, `settings.undoWindowMs`, `clock.serverNow()`.
- Produces: no exported changes. `RefereeProps` unchanged.

**Design (replaces the single `recent` slot):**
- The page remembers the `clientTapId`s it created in a `useRef<Set<string>>`, seeded from `queue.all()` on mount and added to in `tap()`.
- Undo rows are derived on every render, not stored: every tap in `view.teams[].taps` whose `clientTapId` is in that set, with `removedAt === null`, `createdAt + settings.undoWindowMs > clock.serverNow()`, and (for penalties) `review.status === 'pending'`. This covers taps sent directly, taps delivered later by the queue, and taps whose first send timed out. Newest first.
- One row per tap: "{team} finished" or "Penalty for {team}", an **Undo** button with accessible name `Undo {team} finished` / `Undo penalty for {team}`, and the existing shrinking bar driven by `createdAt + undoWindowMs - serverNow()`.
- `undo(tapId)`: send `undoTap`; on a thrown send show "Could not undo — not connected. Try again."; on `!ack.ok` show `ack.message`. The row stays until the view says the tap is removed or the window passes.
- Messages: the sticky "No connection — the tap is saved…" error is removed (the existing "N taps waiting to send" notice already covers it). `flush`'s `onAnswer` sets the error to `The saved tap for {team} was refused: {ack.message}` when `!ack.ok` and the code is in `NON_RETRYABLE`. The error is cleared by the next tap, as now, and when `round.current` changes.
- The existing 1-second `useNow` tick only runs while the round is running, which is also the only time undo is possible; no new timer.

- [ ] **Step 1: Write the failing tests** (reuse `setup`, `enabledButton`, `refViewOf`, `start`, `openNext`, `lockedFour`, `teamId`, `NOW`; build server taps the way the existing test at line 50 does):

```tsx
it('offers a separate undo for each recent tap', async () => {
  // tap T1 then T2 (clientTapIds tap-1, tap-2); rerender with both as server taps srv-1, srv-2, createdAt NOW
  // expect buttons 'Undo T1 finished' and 'Undo T2 finished'; clicking the first sends { type: 'undoTap', tapId: 'srv-1' }
});

it('offers undo for a tap that the queue delivered after a dropout', async () => {
  // queue pre-loaded with a tapFinish for T1 (clientTapId 'old-1', round 1); view carries server tap { id: 'srv-9', clientTapId: 'old-1', createdAt: NOW }
  // expect button 'Undo T1 finished'
});

it('keeps the undo and says so when the undo cannot be sent', async () => {
  // send rejects with 'offline' for undoTap
  // expect alert text 'Could not undo — not connected. Try again.' and the Undo button still present
});

it('hides undo once the window has passed', async () => {
  // server tap createdAt = NOW - 10_001 with undoWindowMs 10_000: no Undo button
});

it('reports a saved tap the server refused for good', async () => {
  // queue pre-loaded with a tapFinish for T1; send resolves { ok: false, code: 'already_finished', message: 'That team already has a result.' }
  // expect alert 'The saved tap for T1 was refused: That team already has a result.' and queue.all() empty
});

it('does not leave a no-connection error on screen after the tap is delivered', async () => {
  // first send rejects 'offline'; no role=alert is shown; the 'waiting to send' status is shown
});
```

Update the existing test "stamps a tap with the server clock, queues it, and offers undo" only where it looks up the button: `name: /Undo T1 finished/`.

- [ ] **Step 2: Run** `npx vitest run packages/web/test/pages/referee.test.tsx` — Expected: the six new tests FAIL.
- [ ] **Step 3: Implement** per the design above. Delete the `Recent` type, the `recent` state and its timeout effect.
- [ ] **Step 4: Run the same command** — Expected: PASS (all referee tests).
- [ ] **Step 5: Update `docs/user-guide.md`** referee section: each tap has its own Undo for about 10 seconds, including taps sent after a dropout; a refused saved tap shows a message.
- [ ] **Step 6: Run** `npm run e2e` — Expected: 3 passed.
- [ ] **Step 7: Commit** — `fix(web): per-tap referee undo and honest tap messages`

---

### Task 4: The referee page authenticates as a referee only

**Files:**
- Modify: `packages/server/src/hub.ts` (`fetch`, the `role` query handling at the top)
- Modify: `packages/server/src/worker.ts` (`/api/me`)
- Modify: `packages/web/src/pages/referee/App.tsx:23,60-61`
- Test: `packages/server/test/worker/ws.test.ts`, `packages/server/test/worker/pages-api.test.ts`

**Interfaces:**
- Produces: `GET /api/ws?role=referee` authenticates with the device cookie only (session cookie and bearer key ignored; no valid device → 401). `GET /api/me?as=referee` answers from the device cookie only. Without those parameters both behave as today.

- [ ] **Step 1: Write the failing tests** (helpers in `test/worker/client.ts`: `lockedEvent`, `command`, `call`, `connect`; add a `query?: string` option to `connect` if it has none):

```ts
it('a browser with both a session and a pairing is a referee on the referee socket', async () => {
  const admin = await lockedEvent();
  const code = (await command({ type: 'createPairingCode', station: 1 }, { cookie: admin })).body.reply.code;
  const device = (await call('/api/pair', { code })).cookie!;
  const both = `${admin}; ${device}`;
  expect((await call('/api/me?as=referee', undefined, { cookie: both })).body).toMatchObject({ role: 'referee', station: 1 });
  expect((await call('/api/me?as=referee', undefined, { cookie: admin })).status).toBe(401);
  const s = await connect({ cookie: both, query: 'role=referee' });
  expect((await s.next('view')).view.station.number).toBe(1);
});
```

- [ ] **Step 2: Run** `npx vitest run packages/server/test/worker/ws.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** on the server: when the parameter is present, pass only the device credential to the existing authentication path.
- [ ] **Step 4: Client.** In `referee/App.tsx` both `authState()` calls become `authState(() => fetch('/api/me?as=referee'))` and the socket URL becomes `wsUrl('/api/ws?role=referee')`.
- [ ] **Step 5: Run** `npx vitest run packages/server/test/worker packages/web/test/pages/referee.test.tsx` and `npm run e2e` — Expected: PASS; 3 passed.
- [ ] **Step 6: Commit** — `fix: referee page uses the device pairing even when signed in to the console`

---

### Task 5: Setup validation and malformed commands

**Files:**
- Modify: `packages/engine/src/brackets.ts` (`validateBracketPlan`)
- Modify: `packages/server/src/core/setup.ts` (`categoryFor`, lines 8 and 32-36)
- Modify: `packages/server/src/core/apply.ts` (`applyCommand`)
- Test: `packages/engine/test/brackets.test.ts`, `packages/server/test/core/setup.test.ts`, `packages/server/test/core/apply.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// brackets.test.ts — five 4-team categories with suggested brackets on 4 tables, grandChampionship true
expect(validateBracketPlan(input)).toContain('Grand Championship: 5 category winners but only 4 tables');
// same input with grandChampionship false, and with 5 tables: no such error

// setup.test.ts
it('keeps categories apart when their names differ only in symbols or script', () => {
  const e = ok(handleSetup(blank(), { type: 'importTeams', csv: 'team,category\nOne,A\nTwo,A+\nThree,中学\nFour,高校\nFive,a' }, ctx(admin)));
  expect(e.setup.categories.map((c) => c.name)).toEqual(['A', 'A+', '中学', '高校']);
  expect(new Set(e.setup.categories.map((c) => c.id)).size).toBe(4);
  expect(e.setup.categories.every((c) => c.id.length > 0)).toBe(true);
  expect(e.setup.teams[4]!.categoryId).toBe(e.setup.categories[0]!.id); // 'a' joins 'A'
});

// apply.test.ts
it('refuses a malformed command instead of throwing', () => {
  for (const cmd of [{ type: 'renameTeam', teamId: 'x', name: 5 }, { type: 'importTeams', csv: null }, { type: 'setBagTotal' }, { type: 'addTeam', name: {}, category: [] }]) {
    const r = applyCommand(blank(), cmd as never, ctx(admin));
    expect(r.ok ? 'ok' : r.code).toBe('invalid');
  }
});
```

- [ ] **Step 2: Run** the three files — Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `validateBracketPlan`: when `input.grandChampionship` and the number of categories that have a bracket is at least 2 and greater than `input.tableCount`, push the message above.
  - `categoryFor(categories, name)`: match an existing category by trimmed, case-insensitive name. Otherwise the new id is `slug(name) || 'category'`, with `-2`, `-3`, … appended while that id is taken.
  - `applyCommand`: run the three handler calls inside one `try`; on a thrown error return `fail('invalid', 'That command is malformed.')`. Handlers are pure, so nothing is half-applied.
- [ ] **Step 4: Run** the three files — Expected: PASS.
- [ ] **Step 5: Commit** — `fix: validate grand championship tables, category ids and malformed commands`

---

### Task 6: Live views stay current

**Files:**
- Modify: `packages/server/src/hub.ts` (`pair`, `afterChange` parameter type)
- Modify: `packages/server/src/core/views.ts` (`publicView`, `publicRoundUpdate`)
- Modify: `packages/web/src/lib/publicState.ts` (`applyRoundUpdate`)
- Test: `packages/server/test/worker/ws.test.ts`, `packages/server/test/core/views.test.ts`, `packages/web/test/lib/publicState.test.ts`

**Interfaces:**
- Produces: `publicRoundUpdate(e, d)` gains `seedTotalsMs: Record<string, number>`, computed by one function shared with `publicView`.

- [ ] **Step 1: Write the failing tests**

```ts
// ws.test.ts
it('tells race control when a tablet pairs', async () => {
  const admin = await lockedEvent();
  const control = await connect({ cookie: admin });
  await control.next('view');
  const code = (await command({ type: 'createPairingCode', station: 2 }, { cookie: admin })).body.reply.code;
  const since = control.messages.length;
  await call('/api/pair', { code });
  const v = (await control.next('view', since)).view;
  expect(v.devices.filter((d: any) => d.station === 2 && d.revoked_at === null)).toHaveLength(1);
});

// views.test.ts — round 1 running, T1 has a 60_000 ms finish
expect(publicRoundUpdate(e, derive(e)).seedTotalsMs[teamId(e, 'T1')]).toBe(60_000);

// publicState.test.ts
expect(applyRoundUpdate(state, { ...update, seedTotalsMs: { t1: 60_000 } }).seedTotalsMs).toEqual({ t1: 60_000 });
```

- [ ] **Step 2: Run** the three files — Expected: FAIL.
- [ ] **Step 3: Implement.** `pair()` calls `afterChange` after the device row and audit entry are written (widen its first parameter to `{ type: string }`; pairing sends phones the small round update, not a snapshot). Extract the seed-total loop from `publicView` into a function both views call. `applyRoundUpdate` copies `seedTotalsMs`.
- [ ] **Step 4: Run** the three files — Expected: PASS.
- [ ] **Step 5: Commit** — `fix: refresh the device list on pairing and seeding totals during a round`

---

### Task 7: Suggested seeding groups keep categories together

**Files:**
- Modify: `packages/engine/src/groups.ts` (`suggestSeedingGroups`, lines 5-38)
- Modify: `docs/user-guide.md:95`
- Test: `packages/engine/test/groups.test.ts:15-24`

**Interfaces:**
- Produces: `suggestSeedingGroups(categories, teams, tableCount)` keeps its signature and return type.

**Rule:** the number of groups is still `max(1, ceil(teams / tableCount))`. Teams are taken in category order (the `categories` array), then `team.order`, and each group is filled to `tableCount` before the next one starts. Tables are `1..k` in that same order within each group.

- [ ] **Step 1: Replace the existing test** "splits 14/16/20 on 26 tables into two groups of 25" (it pins the behaviour the user decided to change) with:

```ts
it('fills groups in category order: 14/16/20 on 26 tables gives 26 and 24', () => {
  const ts = teams([14, 16, 20]);
  const { groups, tableOf } = suggestSeedingGroups(cats, ts, 26);
  expect(groups.map((g) => g.id)).toEqual(['A', 'B']);
  expect(groups.map((g) => g.teamIds.length)).toEqual([26, 24]);
  const count = (g: number, c: string) => groups[g]!.teamIds.filter((id) => id.startsWith(c)).length;
  expect([count(0, 'hs'), count(0, 'cm'), count(0, 'co')]).toEqual([14, 12, 0]);
  expect([count(1, 'hs'), count(1, 'cm'), count(1, 'co')]).toEqual([0, 4, 20]);
  expect(groups[0]!.teamIds.map((id) => tableOf[id])).toEqual(Array.from({ length: 26 }, (_, i) => i + 1));
  expect(groups[1]!.teamIds.map((id) => tableOf[id])).toEqual(Array.from({ length: 24 }, (_, i) => i + 1));
});

it('keeps a small category whole when it fits', () => {
  const { groups } = suggestSeedingGroups(cats, teams([30, 3]), 26);
  expect(groups.map((g) => g.teamIds.length)).toEqual([26, 7]);
  expect(groups[1]!.teamIds.filter((id) => id.startsWith('cm')).length).toBe(3);
});
```

- [ ] **Step 2: Run** `npx vitest run packages/engine/test/groups.test.ts` — Expected: both FAIL (25/25 today).
- [ ] **Step 3: Implement** the rule and update the function's doc comment.
- [ ] **Step 4: Run** `npm test` and `npm run e2e` — Expected: PASS. A test elsewhere that relied on the even split (it would use `suggestSetup` with more teams than tables) is updated to the new group contents, not loosened; name each one in the commit message.
- [ ] **Step 5: `docs/user-guide.md:95`:** keep the 26/24 example and add that the last group can be much smaller (27 teams on 26 tables gives 26 and 1) and that admin can move teams between groups to even them out.
- [ ] **Step 6: Commit** — `feat(engine): fill suggested seeding groups in category order`

---

### Task 8: Export safety and documentation corrections

**Files:**
- Modify: `packages/server/src/core/export.ts` (`cell`)
- Modify: `packages/server/src/hub.ts:2` (remove the unused `officialMs` import)
- Modify: `docs/design.md:3`
- Test: `packages/server/test/core/export.test.ts` (create)

- [ ] **Step 1: Docs.** `design.md:3` status becomes "Implemented; kept current with the code".
- [ ] **Step 2: Write the failing test** in the new file (helpers from `./helpers`; a referee penalty with `refereeNote: '=HYPERLINK("http://x","y")'` on T1 in round 1, and a team renamed to `+Plus Team`):

```ts
const csv = eventCsv(e);
expect(csv).toContain(`"'=HYPERLINK(""http://x"",""y"")"`);
expect(csv).toContain(`'+Plus Team`);
expect(csv).not.toMatch(/(^|,)"?[=+@-]/m);
```

- [ ] **Step 3: Run** `npx vitest run packages/server/test/core/export.test.ts` — Expected: FAIL.
- [ ] **Step 4: Implement.** In `cell`, a string value (not a number) starting with `=`, `+`, `-`, `@`, tab or carriage return gets a leading `'` before the existing quoting.
- [ ] **Step 5: Run** the same command, then `npm run typecheck && npm test && npm run e2e` — Expected: all PASS; 3 e2e passed.
- [ ] **Step 6: Commit** — `fix(server): neutralise spreadsheet formulas in the CSV export; correct docs`

---

## Not in this plan

- **End event with penalties still pending** is allowed after a warning. That was a deliberate choice in commit `e7470ee` and is documented in design §4.1.
- **Editing the time of a disqualified team has no visible effect** (the DQ wins). Cosmetic; left for a later pass.
- **One category with Grand Championship on** now shows that category's winner on the champion screen, so no change is needed.
