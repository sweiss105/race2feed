# Race Page Workflow, Penalty Labels, Console Sign-in and Referee Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give race control one obvious next step and a plain status on the Race page, finish races automatically, stop showing "+5s", sign the console in through Cloudflare Access with an emergency fallback, record referee names, and close the remaining tablet and test gaps.

**Architecture:** Server rules stay in pure functions under `packages/server/src/core`; the hub (Durable Object) wires them, and its single alarm now serves both the phone update pacing and auto-finish. The Race page's button and status come from one pure selector so every state is table-tested. Console requests move under `/api/control/` (Cloudflare Access) and `/api/emergency/` (emergency password), both served by the same handlers; referee, Companion and public routes are unchanged.

**Tech Stack:** TypeScript, Cloudflare Workers + Durable Object (SQLite), Cloudflare Access (one-time PIN), Preact, Vitest (projects `engine`, `server-core`, `server-worker`, `web`), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-23-race-page-workflow-design.md` (approved). Product spec: `docs/design.md`. Project rules: `CLAUDE.md`.

## Global Constraints

- `CLAUDE.md`: any change to what staff see or do updates `docs/user-guide.md` in the same commit; `docs/design.md` changes before or alongside behaviour changes; `README.md` when a route, secret, script or workflow changes.
- Run a single test file with `npx vitest run <path>`. Do not use `npm test` for one file.
- Before the last commit of every task: `npm run typecheck`, `npm test` and `npm run e2e` all pass.
- Never skip, loosen or delete an existing assertion to get green. Where this plan changes behaviour, the task says which existing assertions change; anything else that fails is reported, not edited.
- Events and devices stored by earlier versions must keep loading (fields added by this plan are optional when read).
- No new dependencies.
- Exact copy from the spec, used verbatim: button labels **Open round N**, **Start**, **Finish now**, **Show champion**, **Hide champion**; the label **pending: under review**; the tablet button **Penalty**; the switch **Time penalties**; the setting **Auto-finish delay (seconds)**, default 30; the second-tab message **The referee page is already open in another tab on this tablet** with button **Use this tab instead**.
- Cloudflare Access values (not secrets): team domain `silent-butterfly-7498.cloudflareaccess.com`; application audience tag `00d2d484090bf7ba4b3a038668fea3c5daaa94a1b3861f3178d13bf83486d879`; the application covers `r2f.weiss-audio.com/control*` and `r2f.weiss-audio.com/api/control/*`.

## Review Focus

1. A race must never finish by itself while a team has no result, or sooner after the last finish than the referee undo window (Task 4).
2. The server goes idle mid-countdown: the race still finishes on time (Task 4).
3. A console request that reaches the Worker without Cloudflare's proof, or with a token for another application, or expired, is refused; missing Access settings refuse everything (Task 8).
4. A request from the internet carrying the Worker's internal identity header must not be trusted (Task 8).
5. A browser without the Web Locks feature still works as a referee tablet (Task 2).

---

### Task 1: Close the test gaps from the last review

**Files (tests only; no source changes expected):**
- `packages/server/test/worker/pages-api.test.ts`, `packages/server/test/worker/ws.test.ts`, `packages/server/test/core/lineups.test.ts`, `packages/server/test/core/export.test.ts`, `packages/engine/test/brackets.test.ts`, `packages/web/test/pages/control-race.test.tsx`

- [ ] **Step 1: Add these seven tests.** Each must pass against the current code; if one fails, stop and report it as a defect instead of changing source.
  1. Worker: an event document stored without `lineups` (write it straight into the hub's `events` table with rounds 1–2 raced, using `runInDurableObject` from `cloudflare:test`), then `activateEvent` for it; the JSON export of that event has `lineups` with keys `1` and `2`.
  2. Core (`lineups.test.ts`): 12-team event, heats raced, a confirmed correction that creates an exact tie in a round-3 heat; `openNextRound` returns code `blocked`.
  3. Worker (`ws.test.ts`): a WebSocket upgrade to `/api/ws?role=referee` with an admin session cookie and no device cookie is answered `401`; the same with only a bearer API key is `401`.
  4. Core (`export.test.ts`): team names `@At`, `-Dash`, `=Eq`, `+Plus` each appear with a leading `'`; a team with a 5000 ms penalty has `5000` in `penalties_ms` with no apostrophe.
  5. Worker (`ws.test.ts`): with a public socket connected, pairing a tablet produces no message of type `snapshot` on it (a `round` message is allowed).
  6. Engine (`brackets.test.ts`): Grand Championship on, exactly one category with brackets, 1 table: `validateBracketPlan` has no "Grand Championship" error; two categories on 1 table: it has the error with "2 category winners but only 1 tables".
  7. Web (`control-race.test.tsx`): `unlock_required` with `keptRounds: [3, 4]` shows "Round 3, Round 4 were opened with their original line-ups and keep them."
- [ ] **Step 2: Run** the six files — Expected: PASS.
- [ ] **Step 3: Commit** — `test: close coverage gaps from the review`

---

### Task 2: Referee tablet — refusals always shown, one live tab

**Files:**
- Modify: `packages/web/src/pages/referee/RefereePage.tsx` (flush effect and its `onAnswer`)
- Create: `packages/web/src/lib/singleTab.ts`
- Modify: `packages/web/src/pages/referee/App.tsx`
- Modify: `docs/user-guide.md` (referee section and troubleshooting), `docs/design.md` §7.3
- Test: `packages/web/test/pages/referee.test.tsx`, `packages/web/test/lib/singleTab.test.ts` (create)

**Interfaces:**
- Produces: `singleTab.ts` exports `claimTab(opts: { locks?: LockManager; channel?: BroadcastChannel; onLost(): void }): { ready: Promise<'active' | 'blocked' | 'unsupported'>; takeOver(): Promise<void>; release(): void }`.

**Rules:**
- Refusal message: `onAnswer` sets the error for a non-retryable refusal whether or not the effect that started the flush is still current. Text: `The saved tap for {team} in round {round} was refused: {message}` (`round` from the queued entry; omit " in round {round}" when the entry has none).
- One live tab: lock name `r2f-referee`. `claimTab` requests it with `ifAvailable`; got it → `active`; not available → `blocked`. `takeOver()` posts `takeover` on a `BroadcastChannel('r2f-referee')`; the active tab releases its lock and calls `onLost`; the caller then acquires the lock (waiting) and becomes active. If `navigator.locks` or `BroadcastChannel` is missing → `unsupported`, and the page behaves as today.
- `App.tsx`: while `blocked`, or after `onLost`, render only the message and the **Use this tab instead** button (after `onLost` the button takes over again). The live connection and the tap queue are not created until the tab is `active` or `unsupported`.

- [ ] **Step 1: Write the failing tests**
  - `referee.test.tsx`: "reports a refused saved tap even if the round changed while it was being sent": queue pre-loaded with a `tapFinish` for T1 with `round: 1`; `send` resolves `{ ok: false, code: 'already_finished', message: 'That team already has a result.' }` only after the page has been re-rendered with a view whose `round.current` is 2; expect an alert with `The saved tap for T1 in round 1 was refused: That team already has a result.`
  - `singleTab.test.ts` with small in-memory fakes for the lock manager and channel: first claim resolves `active`; a second claim on the same fakes resolves `blocked`; after the second calls `takeOver()`, the first's `onLost` has been called once and a third claim resolves `blocked` (the second holds the lock); with `locks: undefined` the result is `unsupported`.
- [ ] **Step 2: Run** both files — Expected: FAIL.
- [ ] **Step 3: Implement** per the rules.
- [ ] **Step 4: Run** both files — Expected: PASS.
- [ ] **Step 5: Docs, full checks, commit** — `fix(web): one live referee tab; always report a refused saved tap`

---

### Task 3: A referee's penalty adds no time; "+5s" removed

**Files:**
- Modify: `packages/server/src/core/taps.ts` (`tapPenalty`), `packages/server/src/core/model.ts` (`settings`), `packages/server/src/core/setup.ts` (`setSettings`), `packages/server/src/core/views.ts` (`refereeView`)
- Modify: `packages/web/src/ui/Time.tsx`, `packages/web/src/pages/referee/RefereePage.tsx`, `packages/web/src/pages/control/sections/PenaltyReviews.tsx`, `packages/web/src/pages/control/sections/Settings.tsx`, `packages/web/src/pages/control/sections/Race.tsx` (switch label only)
- Modify: `docs/design.md` §5.1, §5.2, §7.3; `docs/user-guide.md`
- Test: `packages/server/test/core/taps.test.ts`, `packages/server/test/core/penalty-review.test.ts`, `packages/web/test/pages/referee.test.tsx`, `packages/web/test/pages/participant.test.tsx`, a new `packages/web/test/ui/time.test.ts`

**Interfaces:**
- Produces: `LiveEvent.settings` is `{ penaltiesEnabled: boolean; undoWindowMs: number; penaltyMs?: number }` (`penaltyMs` kept optional only so old documents type-check; nothing reads it). `setSettings` no longer accepts `penaltyMs`. `refereeView` teams gain `penaltyPending: boolean`.
- `timeText(x, { short })` in `Time.tsx`:
  - DQ, DNF, DNS and pending-result cases unchanged.
  - Otherwise the time, then ` (incl. +15s · Reason)` when approved time penalties exist (unchanged), then, when `penaltyPending`, ` · pending: under review` (or ` · under review` when `short`).
  - Examples: `3:41.20 · pending: under review`; `3:46.20 (incl. +5s · Bag not sealed) · pending: under review`; short: `3:41.20 · under review`.

**Rules:**
- `tapPenalty` records `amountMs: 0`. Approval and rejection are unchanged. Penalty taps already stored keep their amounts.
- Tablet: the button text is `Penalty` (with the existing `×N` count), aria-label `Penalty for {team}`.
- Console: the switch label is `Time penalties`; the review card's sub-line reads `Round {n} · flagged by the referee`; the "Penalty (seconds)" setting is removed.

- [ ] **Step 1: Write the failing tests**

```ts
// taps.test.ts
it('a referee penalty adds no time until race control approves it', () => {
  // running round, penalties on, T1 finished at 60_000; referee tapPenalty for T1
  // expect the tap's amountMs to be 0, status 'pending', and buildProgress(e).results[1][T1].penaltiesMs to be 0
  // then decidePenalty approve with reason 'early' (10_000): penaltiesMs is 10_000
});
// time.test.ts
expect(timeText({ status: 'finished', officialMs: 221_200, penaltiesMs: 0, penaltyPending: true })).toBe('3:41.20 · pending: under review');
expect(timeText({ status: 'finished', officialMs: 226_200, penaltiesMs: 5000, penaltyNotes: ['Bag not sealed'], penaltyPending: true })).toBe('3:46.20 (incl. +5s · Bag not sealed) · pending: under review');
expect(timeText({ status: 'finished', officialMs: 221_200, penaltiesMs: 0, penaltyPending: true }, { short: true })).toBe('3:41.20 · under review');
expect(timeText({ status: 'finished', officialMs: 221_200, penaltiesMs: 0 })).toBe('3:41.20');
```

  - `referee.test.tsx`: with penalties on, the buttons are named `Penalty for T1` and `Penalty for T2`, and no button name contains `+5s`.
  - `participant.test.tsx`: a team with a pending referee penalty shows `pending: under review` beside its time.
- [ ] **Step 2: Update existing assertions that pin the old behaviour:** every existing assertion on the `+5s` tablet button name, on a pending penalty contributing 5000 ms, on `(incl. +5s · under review)`, on "referee gave +5s", and on `setSettings` with `penaltyMs` changes to the new behaviour above; list each in the report.
- [ ] **Step 3: Run** the affected files — Expected: FAIL.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run** — Expected: PASS.
- [ ] **Step 6: Docs, full checks, commit** — `feat: referee penalties add no time until reviewed; drop +5s wording`

---

### Task 4: Auto-finish

**Files:**
- Create: `packages/server/src/core/autofinish.ts`
- Modify: `packages/server/src/core/model.ts`, `packages/server/src/core/apply.ts`, `packages/server/src/core/setup.ts` (`setSettings`), `packages/server/src/core/views.ts` (`companionView`), `packages/server/src/hub.ts` (`alarm`, alarm scheduling)
- Modify: `packages/web/src/pages/control/sections/Settings.tsx`
- Modify: `docs/design.md` §4, §5.1, §8; `docs/user-guide.md`
- Test: `packages/server/test/core/autofinish.test.ts` (create), `packages/server/test/worker/autofinish.test.ts` (create)

**Interfaces:**
- `LiveEvent.settings.autoFinishMs?: number` (missing means 30 000; 0 means off). `LiveEvent.round.autoFinishAt?: number | null`. `setSettings` accepts `autoFinishMs` (whole number ≥ 0).
- `autofinish.ts`:
  - `autoFinishDelay(e: LiveEvent): number` — 0 when off, otherwise `max(autoFinishMs ?? 30_000, undoWindowMs)`.
  - `withAutoFinish(before: LiveEvent, after: LiveEvent, now: number): LiveEvent` — returns `after` with `round.autoFinishAt` set by these rules, in order: not `running`, or delay 0, or any team in the round without a result → `null`; `after.taps !== before.taps` or `after.overrides !== before.overrides` or no time set yet → `now + delay`; otherwise unchanged.
  - `nextAlarm(publicDue: number | null, autoFinishAt: number | null | undefined): number | null` — the earlier of the two, or the one that exists.
- `applyCommand` applies `withAutoFinish(e, result.event, ctx.now)` to every successful result.
- `companionView` gains `autoFinishAt: number | null`. The public and console views already carry `round`, so they carry `autoFinishAt` with it.
- Hub: after every command and at the end of `alarm()`, the alarm is set to `nextAlarm(...)` (or deleted when null). `alarm()`: if the active event's `autoFinishAt` is at or before now, run `finishRace` through the normal command path with actor `{ role: 'admin', label: 'auto-finish' }`; then send the paced public update if one is due.
- Settings: a number field **Auto-finish delay (seconds)** saved with `setSettings`.

- [ ] **Step 1: Write the failing tests**

```ts
// autofinish.test.ts (helpers: lockedFour, openNext/start equivalents via handleLifecycle, ctx, control, referee, teamId)
it('starts a 30 s countdown when the last team has a result', () => {
  // round 1 running, started at 2_000_000; setResult for 3 teams at now 2_050_000 → autoFinishAt null each time
  // 4th result at now 2_060_000 → round.autoFinishAt === 2_090_000
});
it('restarts on any later tap, penalty or correction, and cancels when a result is cleared', () => {
  // from the state above: tapPenalty at 2_070_000 → 2_100_000; setResult clear at 2_075_000 → null
});
it('never undercuts the referee undo window', () => {
  // setSettings autoFinishMs 5_000 with undoWindowMs 10_000 → the countdown is 10_000
});
it('is off when the delay is 0', () => { /* autoFinishMs 0 → autoFinishAt stays null */ });
it('picks the earlier alarm', () => {
  expect(nextAlarm(1000, 500)).toBe(500); expect(nextAlarm(null, 500)).toBe(500);
  expect(nextAlarm(1000, null)).toBe(1000); expect(nextAlarm(null, undefined)).toBe(null);
});
```

  - `worker/autofinish.test.ts`: lock a 4-team event, set `autoFinishMs` to 1000 and `undoWindowMs` to 0, open and start round 1, give all four teams a result over the API; run the hub's alarm (`runDurableObjectAlarm` from `cloudflare:test`, after advancing past the time or waiting 1.1 s); the console view's `round.phase` is `finished` and the newest audit entry's actor is `auto-finish`. A second case: with one team still out, running the alarm leaves the phase `running`.
- [ ] **Step 2: Run** both files — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — Expected: PASS. Existing end-to-end tests finish rounds by button within seconds; if one now races the countdown, report it.
- [ ] **Step 5: Docs, full checks, commit** — `feat: finish a race automatically after the last team is in`

---

### Task 5: Race page — one large button and a status line

**Files:**
- Create: `packages/web/src/lib/raceAction.ts`, `packages/web/src/pages/control/sections/RaceHeader.tsx`
- Modify: `packages/web/src/pages/control/sections/Race.tsx` (header replaced; penalty switch removed), `packages/web/src/pages/control/sections/Settings.tsx` (penalty switch added to the event's settings), `packages/web/src/pages/control/control.css`
- Modify: `e2e/helpers.ts`, `e2e/*.spec.ts` (button names), `docs/design.md` §7.2, `docs/user-guide.md`
- Test: `packages/web/test/lib/raceAction.test.ts` (create), `packages/web/test/pages/control-race.test.tsx`, `packages/web/test/pages/control-admin.test.tsx`

**Interfaces:**
- Consumes: `view.round.autoFinishAt` (Task 4), `view.penaltyReviews`, `view.ties`, `view.blockers`, `view.stations`, `view.outstanding`, `view.championShown`, `view.rounds`.
- Produces: `raceAction(view: ControlView, now: number): { label: string; kind: 'open' | 'start' | 'finish' | 'showChampion' | 'hideChampion'; enabled: boolean; pulse: boolean; status: string }`.

**The table `raceAction` implements (first matching row wins):**

| Condition | label | enabled | pulse | status |
|---|---|---|---|---|
| champion showing | Hide champion | yes | no | Champion is showing |
| phase `running`, teams outstanding (N) | Finish now | no | no | Racing — waiting on N team(s) |
| phase `running`, none outstanding, `autoFinishAt` set | Finish now | yes | no | All teams in — finishing in S s (S = seconds left, rounded up, never below 0) |
| phase `running`, none outstanding, no `autoFinishAt` | Finish now | yes | yes | All teams in |
| phase `open`, N tables not ready | Start | no | no | Waiting on N table(s) to be ready |
| phase `open`, all ready | Start | yes | yes | All tables ready |
| pending penalty reviews (N) | Open round M (or Show champion after the last round) | no | no | Waiting on N penalty/penalties to be reviewed |
| undecided tie or other blocker | same label as the row above | no | no | Waiting on a tie to be decided |
| last round finished | Show champion | yes | yes | Event complete |
| otherwise | Open round M | yes | yes | Ready to open round M (before round 1: Not started) |

Singular/plural: "1 team", "2 teams"; "1 table", "2 tables"; "1 penalty", "2 penalties". M is `round.current + 1`.

**Rules:**
- `RaceHeader` renders the round title, the running clock, the status line (`role="status"`) and one button. Clicking sends `openNextRound`, `startRace`, `finishRace` or `hideChampion`; `showChampion` opens the existing bag-count sheet.
- The button is about three times the current button's height and width (min-height 6rem, min-width 16rem, title-sized text). Class `pulse` runs a 2-second scale-and-glow loop and is disabled under `@media (prefers-reduced-motion: reduce)`.
- The old three buttons and the old champion button are removed. Command errors still show under the header.
- The **Time penalties** switch moves into the event's panel in Settings.

- [ ] **Step 1: Write the failing tests**: one `it.each` in `raceAction.test.ts` with a row per line of the table (use the fixtures in `packages/web/test/support/state.ts`), asserting all five fields; plus plural cases for 1 and 2. In `control-race.test.tsx`: the header shows exactly one action button; with all tables ready it is named `Start`, has class `pulse`, and clicking it sends `{ type: 'startRace' }`; with a table not ready it is disabled and the status reads `Waiting on 1 table to be ready`. In `control-admin.test.tsx`: Settings has a switch named `Time penalties` that sends `setPenaltiesEnabled`.
- [ ] **Step 2: Update existing tests and e2e helpers** that click `Open next round`, `Start` or `Finish`, or toggle the penalty switch on the Race page, to the new names and location; list each.
- [ ] **Step 3: Run** — Expected: FAIL. **Step 4: Implement.** **Step 5: Run** — Expected: PASS.
- [ ] **Step 6: Docs, full checks, commit** — `feat(web): one large next-step button and a status line on the Race page`

---

### Task 6: Referee name at pairing

**Files:**
- Modify: `packages/server/src/worker.ts` (`/api/pair`), `packages/server/src/hub.ts` (`pair`, the referee actor label)
- Modify: `packages/web/src/pages/referee/pairing.ts`, `packages/web/src/pages/referee/App.tsx`, `packages/web/src/pages/control/sections/Devices.tsx`
- Modify: `e2e/helpers.ts` (`pairReferee`), `docs/design.md` §7.3, §9; `docs/user-guide.md`; `README.md` route table
- Test: `packages/server/test/worker/api.test.ts`, `packages/web/test/pages/referee.test.tsx`

**Rules:**
- `POST /api/pair` takes `{ code, name }`. `name` is trimmed; empty or longer than 40 characters → `400 { error: 'name_required' }` **without consuming the code**. The name is stored in the device's existing `label` column.
- The referee actor label is `{name} (station {n})`; a device stored before this change (label `Station {n}`) keeps `referee station {n}`.
- Tablet: opening `/ref?code=…` shows a form with one field **Your name** and a button **Start**; submitting pairs. A bad code shows the existing message.
- `pairing.ts` exports `codeFromUrl(href: string): string | null` and `pair(code: string, name: string, fetchFn): Promise<{ paired: true; station: number } | { paired: false; error: string }>`; `pairFromUrl` is removed.
- Devices list shows `{name} — {station label}`.

- [ ] **Step 1: Write the failing tests**: `api.test.ts`: pairing with no name is `400 name_required` and the same code then works with `name: ' Dana '`; a command from that tablet is audited with actor `Dana (station 1)` (read through the console view's `audit`). `referee.test.tsx`: `codeFromUrl` and `pair` cases replacing the three `pairFromUrl` tests (same expectations, plus the name in the posted body).
- [ ] **Step 2–4: Fail, implement, pass.**
- [ ] **Step 5: Docs, full checks, commit** — `feat: referees give their name when pairing a tablet`

---

### Task 7: One console role

**Files:**
- Modify: `packages/server/src/core/model.ts` (`Role`), `packages/server/src/core/apply.ts`, `packages/server/src/hub.ts`, `packages/server/src/worker.ts` (`/api/login`)
- Modify: `packages/web/src/pages/control/ConsolePage.tsx` (`sectionsFor`), `packages/web/src/pages/control/Login.tsx`, `packages/web/src/pages/control/App.tsx`, `packages/web/src/pages/control/sections/Settings.tsx`, `packages/web/src/lib/api.ts`
- Modify: tests that use the `control` actor or role; `docs/design.md` §7.1, §7.2, §9; `docs/user-guide.md`; `README.md`
- Test: `packages/server/test/core/apply.test.ts`, `packages/server/test/worker/api.test.ts`, `packages/web/test/pages/control-admin.test.tsx`

**Rules:**
- `Role` is `'admin' | 'referee' | 'companion' | 'public'`. Every command `control` could send is allowed for `admin`. `Tap.source: 'control'` (who added a penalty) is a data value and stays.
- At hub start: `DELETE FROM credentials WHERE role = 'control'` and `DELETE FROM sessions WHERE role = 'control'`.
- `/api/login` takes `{ password }` only. `setPassword` takes `{ password }` only.
- Web: the sign-in form loses its "Sign in as" choice; every signed-in user sees all seven sections; Settings has one **Console password** field.
- Tests: replace the `control` test actor with `admin` everywhere (same assertions). Assertions that a `control` actor is refused a setup command are removed with the role; list them in the report.

- [ ] **Step 1: Write the failing tests**: a stored `control` credential and session are gone after the hub restarts, and that session cookie is `401` on `/api/me`; `sectionsFor('admin')` is all seven sections; the sign-in form has no radio group.
- [ ] **Step 2–4: Fail, implement, pass.**
- [ ] **Step 5: Docs, full checks, commit** — `feat: merge race control and admin into one console role`

---

### Task 8: Console sign-in through Cloudflare Access, with an emergency password

**Files:**
- Create: `packages/server/src/auth/access.ts`, `packages/server/src/auth/console.ts`
- Modify: `packages/server/src/worker.ts`, `packages/server/src/hub.ts`, `packages/server/src/http.ts`, `packages/server/wrangler.jsonc` (vars), `packages/server/vitest.worker.config.ts`, `e2e/playwright.config.ts`, `e2e/helpers.ts`
- Create: `packages/web/emergency/index.html`, `packages/web/src/pages/emergency/main.tsx`
- Modify: `packages/web/vite.config.ts` (new entry), `packages/web/src/lib/api.ts`, `packages/web/src/pages/control/App.tsx`, `packages/web/src/pages/control/Login.tsx` (becomes the emergency form), `packages/web/src/pages/control/sections/Settings.tsx` (password section removed), `packages/web/src/pages/control/sections/Events.tsx` (export links)
- Modify: `docs/design.md` §9, §11; `docs/user-guide.md` (signing in, troubleshooting); `README.md` (routes, secrets, local development, deploy); `packages/server/README.md`
- Test: `packages/server/test/core/access.test.ts` (create), `packages/server/test/core/console.test.ts` (create), `packages/server/test/worker/api.test.ts`, `packages/server/test/worker/client.ts`, `packages/web/test/pages/control-admin.test.tsx`

**Interfaces:**
- `Env` gains `ACCESS_TEAM_DOMAIN?: string`, `ACCESS_AUD?: string`, `EMERGENCY_PASSWORD?: string`, `DEV_CONSOLE_USER?: string`; `ADMIN_PASSWORD` is removed.
- `access.ts`: `verifyAccessJwt(token: string, opts: { teamDomain: string; aud: string; now: number; fetchKeys(): Promise<JsonWebKey[]> }): Promise<{ email: string; exp: number } | null>` — RS256 with WebCrypto; requires a `kid` matching a fetched key, `iss === 'https://' + teamDomain`, `aud` containing `opts.aud`, `exp` in the future, `nbf` (if present) not in the future, and a non-empty `email`. Any failure is `null`, never a throw. Keys come from `https://{teamDomain}/cdn-cgi/access/certs`, cached in memory for one hour and refetched once when a `kid` is unknown.
- `console.ts`: `consoleUser(request: Request, env: Env, deps: { now: number; fetchKeys(): Promise<JsonWebKey[]> }): Promise<{ label: string; exp: number | null } | { error: 'access_not_configured' | 'unauthorized' }>`:
  1. `DEV_CONSOLE_USER` set and the request's hostname is not `r2f.weiss-audio.com` → that user.
  2. `ACCESS_TEAM_DOMAIN` or `ACCESS_AUD` missing → `access_not_configured`.
  3. The `Cf-Access-Jwt-Assertion` header verified with `verifyAccessJwt` → the email; otherwise `unauthorized`.

**Routes:**
- `/api/control/me`, `/command`, `/events`, `/apikeys`, `/export`, `/ws`: authenticated by `consoleUser`; actor `{ role: 'admin', label: email }`. Errors: `401 { error: 'unauthorized' }`, `503 { error: 'access_not_configured' }`.
- `/api/emergency/login` (POST `{ password }`): when `EMERGENCY_PASSWORD` is unset every `/api/emergency/*` route is `404`. Compared by SHA-256 as the old admin fallback was; failures are rate-limited with the existing per-address limiter; success sets the existing session cookie for 12 hours with role `admin`. `/api/emergency/logout` clears it.
- `/api/emergency/me`, `/command`, `/events`, `/apikeys`, `/export`, `/ws`: the same handlers as `/api/control/*`, authenticated by that session cookie; actor `{ role: 'admin', label: 'emergency sign-in' }`.
- `/api/command` and `/api/ws` keep serving referee tablets (device cookie), Companion (bearer key) and public sockets only; a session cookie there no longer signs anyone in. `/api/login`, `/api/logout`, `/api/events`, `/api/apikeys`, `/api/export` and the console use of `/api/me` are removed (`/api/me?as=referee` stays).
- Console sockets: the Worker authenticates, then forwards to the hub with header `x-r2f-console` set to a JSON `{ label, exp }`. **The Worker deletes any incoming `x-r2f-console` header on every request before routing.** The hub trusts that header only on the two console socket paths; the socket's attachment stores `label` and `exp`, and a message arriving after `exp` closes the socket with code 4401. Emergency sockets keep the existing per-message session check.
- Removed: `Hub.login`'s stored-password path, the `setPassword` command, the `credentials` table's use, the Settings password section.

**Web:**
- `lib/api.ts` functions take the API base (`/api/control` or `/api/emergency`).
- `/control`: no sign-in form. If `me` answers 401 or 503 the page shows "You are not signed in. Reload this page to sign in." (or "Console sign-in is not set up." for 503) with a **Reload** button. **Sign out** navigates to `/cdn-cgi/access/logout`.
- `/emergency`: the password form (`Login.tsx`, one field), then the same console against `/api/emergency`. If the login route answers 404 it shows "Emergency sign-in is not enabled." Not linked from any other page.

**Configuration:**
- `wrangler.jsonc` `vars`: `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` with the values in Global Constraints.
- `vitest.worker.config.ts` bindings: `DEV_CONSOLE_USER: 'tester@example.com'`, `EMERGENCY_PASSWORD: 'test-emergency'`; `ADMIN_PASSWORD` removed. `e2e/playwright.config.ts`: `--var DEV_CONSOLE_USER:e2e@example.com` replaces `--var ADMIN_PASSWORD:e2e-admin`; `signInAdmin` just opens `/control`.
- `README.md`: secrets list (`EMERGENCY_PASSWORD` via `wrangler secret put`; `ADMIN_PASSWORD` to be deleted with `wrangler secret delete`), local development (`.dev.vars` with `DEV_CONSOLE_USER`), and the deploy order from the spec.

- [ ] **Step 1: Write the failing tests**

```ts
// access.test.ts — generate an RSA key pair with crypto.subtle, export the public JWK with kid 'k1', sign tokens with a small local helper
const opts = { teamDomain: 'team.cloudflareaccess.com', aud: 'aud-1', now: 1_700_000_000_000, fetchKeys: async () => [publicJwk] };
// valid token (iss https://team.cloudflareaccess.com, aud ['aud-1'], exp now+60s, email 'a@b.c') → { email: 'a@b.c', exp }
// each of these → null: wrong aud; wrong iss; expired; nbf in the future; unknown kid; signature from another key; alg 'none'; missing email; not three parts; garbage
// console.test.ts
// no DEV user, ACCESS vars missing → { error: 'access_not_configured' }
// ACCESS vars set, no header → { error: 'unauthorized' }; valid header → { label: 'a@b.c', exp }
// DEV_CONSOLE_USER set, url https://localhost/api/control/me → that user; url https://r2f.weiss-audio.com/api/control/me with no header → { error: 'unauthorized' }
```

  - `api.test.ts` (worker): `/api/control/me` answers the dev user as `admin`; a console command is audited with that label; `/api/emergency/me` is `401` without a cookie; a wrong emergency password is `401` and the sixth wrong attempt from one address is `429`; the right one sets a cookie that works on `/api/emergency/command` and not on `/api/command` (`401`); an incoming `x-r2f-console` header on `/api/ws` does not produce a console view (the socket gets a public snapshot or `401`); `/api/login` is `404`.
  - `control-admin.test.tsx`: Settings has no password field; the console's Sign out points at `/cdn-cgi/access/logout`.
- [ ] **Step 2: Update existing worker tests and helpers** from session-cookie sign-in to the dev console user and the new paths; assertions about what a signed-in console can do are unchanged; assertions about password login move to the emergency route with the same strictness. List each.
- [ ] **Step 3: Run** — Expected: FAIL. **Step 4: Implement.** **Step 5: Run** — Expected: PASS.
- [ ] **Step 6: Docs, full checks, commit** — `feat: console sign-in through Cloudflare Access with an emergency password`

---

## After the last task

- Whole-branch review, then a pull request is opened only if the owner asks.
- Before merging to `main` (which deploys): set the `EMERGENCY_PASSWORD` secret; after the first successful deploy, delete the `ADMIN_PASSWORD` secret.
