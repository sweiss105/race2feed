# Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the bugs found in the two code reviews of 2026-11-23 that are still present on `main` (commit `3797011`).

**Architecture:** No new modules. Each task tightens one existing unit: the late-correction guard, the referee tap queue, the referee page's undo and messages, referee authentication, setup validation, the live views, and the CSV export. Server rules stay in the pure `packages/server/src/core` functions; the hub only wires them.

**Tech Stack:** TypeScript, Cloudflare Workers + Durable Object (SQLite), Preact, Vitest (projects `engine`, `server-core`, `server-worker`, `web`), Playwright.

**Spec:** `docs/design.md` (§3.2, §4, §5, §6, §7.3, §9). `CLAUDE.md` sets the doc rules.

## Global Constraints

- `CLAUDE.md`: any change to what staff see or do updates `docs/user-guide.md` in the same commit; `docs/design.md` changes before or alongside behaviour changes.
- Run a single file with `npx vitest run <path>`. Do not use `npm test` for one file: it rebuilds the web bundle first.
- Before the last commit of every task: `npm run typecheck` and `npm test` both pass.
- Never skip, loosen or delete an existing assertion to get green. Where this plan changes behaviour, it names the existing assertion that changes and its new value.
- Results are keyed by team id and every round is re-derived from stored taps (`derive()`); nothing in this plan stores matchups.
- No new dependencies.

## Decisions made in this plan (confirm with the user before executing)

1. **Late corrections (Task 1):** a correction that would change who races, or at which table, in any round that has already been opened is refused outright. Today it is allowed after "Change anyway" and silently rewrites raced rounds. Corrections that change no opened round still go through the confirmation.
2. **Seeding group sizes (Task 7):** the code and its original plan split categories evenly (25/25 for 14/16/20 teams on 26 tables); the design and user guide say 26/24. This plan keeps the code and corrects the two documents. If 26/24 is wanted, replace Task 7 step 1 with an engine change.

## Review Focus

Failure modes the spec implies that are most likely to bite on event day. Each is pinned by a test in the task named.

1. Race control fixes a seeding time after bracket rounds have been raced: raced rounds must not change (Task 1).
2. A tablet's browser storage is full or blocked and Wi-Fi drops: a tap made offline must still be sent (Task 2).
3. Both teams at a station finish within the undo window: each tap must be undoable on its own (Task 3).
4. An organiser signed in to race control opens a pairing QR on the same browser: the referee page must work as a referee (Task 4).
5. A malformed command from a signed-in client (a number where text is expected): the server must refuse it, not throw (Task 5).

---

### Task 1: Corrections never change an opened round

**Files:**
- Modify: `packages/server/src/core/corrections.ts`
- Modify: `packages/web/src/pages/control/runner.tsx:18-76`
- Modify: `docs/design.md:195-197`, `docs/user-guide.md:232-233`
- Test: `packages/server/test/core/taps.test.ts:153-164`, `packages/server/test/core/lifecycle.test.ts:90-94`, `packages/web/test/pages/control-race.test.tsx`

**Interfaces:**
- Produces: `checkCorrection(before, after, round, confirm)` keeps its signature. New refusal `{ code: 'changes_opened_rounds', detail: { changedRounds: number[] } }` replaces `changes_current_round` everywhere. `unlock_required` detail becomes `{ laterRounds: number[] }` (no `changedRounds`).

- [ ] **Step 1: Write the failing test** in `taps.test.ts`, inside the existing corrections `describe` (uses its `times`, `code`, `runRound`, `lockedFour`):

```ts
it('refuses a correction that would change a round already raced, even when confirmed', () => {
  let e = runRound(runRound(lockedFour(), times), times);
  e = runRound(e, { T1: 50_000, T4: 55_000, T2: 51_000, T3: 56_000 }); // heats raced: T1 v T4, T2 v T3
  const cmd = { type: 'setResult' as const, round: 1, teamId: teamId(e, 'T4'), set: { kind: 'time' as const, rawMs: 1_000 } };
  for (const confirmUnlock of [undefined, true]) {
    const r = handleTaps(e, { ...cmd, confirmUnlock }, ctx(control, 9_000_000));
    expect(code(r)).toBe('changes_opened_rounds');
    if (!r.ok) expect(r.detail).toEqual({ changedRounds: [3] });
  }
});
```

- [ ] **Step 2: Update the three existing assertions that pin the old behaviour**
  - `taps.test.ts` "a correction to an earlier round needs confirmation…": detail becomes `{ laterRounds: [2, 3] }`.
  - `taps.test.ts` "lists the rounds whose matchups a correction would change": expects `changes_opened_rounds` with detail `{ changedRounds: [3] }` (no confirmation offered). "never reshuffles the round that is open or running…": expects `changes_opened_rounds`.
  - `lifecycle.test.ts:92-94`: both the unconfirmed and the confirmed `decideTie` expect `changes_opened_rounds`.

- [ ] **Step 3: Run** `npx vitest run packages/server/test/core/taps.test.ts packages/server/test/core/lifecycle.test.ts` — Expected: the new test and the three edited ones FAIL.

- [ ] **Step 4: Change `checkCorrection`.** Order of checks when `round < current`: compute `changedRounds` over rounds `round+1..current`; if non-empty return `fail('changes_opened_rounds', 'This would change who races in ' + rounds + ', which ' + (one ? 'has' : 'have') + ' already been opened. It cannot be changed.', { changedRounds })` where `rounds` reads "Round 3" or "Rounds 3, 4"; otherwise, without `confirm`, return `unlock_required` with `{ laterRounds }`; otherwise `null`. Remove the `live` branch. Update the doc comment.

- [ ] **Step 5: Run the same command** — Expected: PASS.

- [ ] **Step 6: Web.** In `runner.tsx`: `Pending` loses `changedRounds`; the `changes_current_round` branch becomes `changes_opened_rounds` (still a toast with the server message); the confirm sheet's second paragraph is always "No matchups change." In `control-race.test.tsx` add:

```tsx
it('shows the refusal when a correction would change an opened round', async () => {
  // same harness as the existing 'unlock_required' test at line ~77, with send returning:
  // { ok: false, code: 'changes_opened_rounds', message: 'This would change who races in Round 3, which has already been opened. It cannot be changed.' }
  // assert: screen.findByRole('alert') has that message; no dialog named 'Change an earlier round?' is shown.
});
```

Run: `npx vitest run packages/web/test/pages/control-race.test.tsx` — Expected: PASS.

- [ ] **Step 7: Docs.** `design.md` §4 "Late corrections" second bullet becomes: "After that, an edit needs an explicit **unlock**. An edit that would change who races, or at which table, in a round that has already been opened is refused; rounds not yet opened are regenerated." `user-guide.md:232-233`: say the confirmation appears only when no opened round changes, and that a change which would alter an opened round is refused with a message naming the rounds.

- [ ] **Step 8: Commit** — `fix(server): refuse corrections that would change an opened round`

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

### Task 7: Export safety and documentation corrections

**Files:**
- Modify: `packages/server/src/core/export.ts` (`cell`)
- Modify: `packages/server/src/hub.ts:2` (remove the unused `officialMs` import)
- Modify: `docs/design.md:3,87`, `docs/user-guide.md:95`
- Test: `packages/server/test/core/export.test.ts` (create)

- [ ] **Step 1: Docs.** `design.md:3` status becomes "Implemented; kept current with the code". `design.md:87` and `user-guide.md:95`: the example becomes "50 teams with 26 tables gives two groups of 25", and "keeps categories together where possible" becomes "splits each category evenly across the groups, so every group has a similar mix". (See Decision 2.)
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
