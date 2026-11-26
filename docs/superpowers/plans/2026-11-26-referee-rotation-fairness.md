# Referee Rotation and Fairness Checks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Referees rotate between stations each round, finals are split between two referees when a spare exists, race control sees fairness warnings, and a fairness report can be exported.

**Architecture:** The per-round referee assignment is computed by a pure function in server core when a round opens and saved in the event document; every referee permission and the referee view read it instead of the device's fixed station. Warnings are a pure function of the saved event, recomputed for every console view. The hub (the only code that knows the device table) passes the roster of paired devices into core through `Ctx`, and keys referee sockets by device instead of station.

**Tech Stack:** TypeScript, Cloudflare Worker + Durable Object (SQLite), Preact, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-26-referee-rotation-fairness-design.md` (read it first; it is binding).

## Global Constraints

- Follow `CLAUDE.md`: a task that changes behaviour updates `docs/design.md` in the same commit; a task that changes what staff see updates `docs/user-guide.md` in the same commit. Screenshots and the PDF are regenerated once, in Task 8.
- Test first. Run a single file with `npx vitest run <path>`; before each commit run `npm run typecheck` and `npm test` (all must pass; 587 tests pass before this plan).
- Events stored before this change have no `settings.rotateReferees`, no `assignments` and no `dismissed`: every reader must treat missing as "rotation off / none". Never rewrite `assignments` of a round that is not the open one.
- With rotation off, behaviour and every existing test stay exactly as they are (a referee's tables are `tablesOfStation(actor.station, …)`).
- Warnings, assignments of other referees and dismissals appear only in `controlView` and the fairness export. Never in `publicView`, `publicRoundUpdate`, `refereeView` (beyond the referee's own tables) or `companionView`.
- Nothing in this plan may make `openNextRound`, `startRace` or `finishRace` fail where it succeeds today.
- Thresholds (spec table) are constants in `packages/server/src/core/fairness.ts`: `FAST_MS = 30_000`, `WINS_MIN_RACES = 6`, `WINS_MARGIN = 4`, `REPEAT_TEAM_TIMES = 3`, `REPEAT_PENALTY_ROUNDS = 2`, `OUTLIER_FROM_ROUND = 3`, `OUTLIER_MIN = 3`, `OUTLIER_AVG_FOR_NONE = 2`, `CLOSE_MS = 500`.
- Staff-facing words: "referee", "race control", "Fairness". Never "device" for a person. Keep sentences plain.
- Commit trailer on every commit:
  ```
  Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Sk6v3xMXJfb5KtHLVK6ymo
  ```
- Do not push to `main`. Do not create a pull request.

## Review Focus

1. A referee whose tablet reconnects mid-round (or reloads) must get the same assigned tables, not their home station. Pinned in Task 3 (worker test: reconnect after `openNextRound`).
2. Fewer referees than busy stations, and zero referees: the round opens, uncovered stations behave as unpaired stations do today. Pinned in Task 1.
3. An event stored before this change, mid-event, loaded by the new code: referees keep home stations, no warnings crash on missing fields. Pinned in Tasks 1 and 4 (tests on an event with the new fields deleted).
4. A referee revoked or paired while a round is open. Pinned in Task 3.
5. A corrected result (race control `setResult` on an earlier round) must remove a `fast_time` or `close_finish` warning that no longer applies, and a dismissed warning must stay dismissed when unrelated results change (stable ids). Pinned in Task 4.

---

## File Structure

- Create `packages/server/src/core/rotation.ts`: roster and assignment types' logic: `assignRound`, `tablesFor`, `assignmentOf`, `withLateReferee`, `withoutReferee`, `swapAssigned`.
- Create `packages/server/src/core/fairness.ts`: thresholds, `fairnessWarnings`, `refereeTeams`.
- Create `packages/server/src/core/fairnessExport.ts`: `fairnessCsv`.
- Modify `packages/server/src/core/model.ts`, `lifecycle.ts`, `taps.ts`, `views.ts`, `setup.ts`, `apply.ts`, `broadcast.ts`, `export.ts` (export `cell`), `hub.ts`, `worker.ts`.
- Modify web: `pages/referee/RefereePage.tsx`, `pages/control/sections/Race.tsx`, new `pages/control/sections/Fairness.tsx`, `ConsolePage.tsx`, `Settings.tsx`, `Events.tsx`, `Devices.tsx`.
- Tests beside existing ones: `packages/server/test/core/rotation.test.ts`, `fairness.test.ts`, `fairness-export.test.ts`, additions to `packages/server/test/worker/api.test.ts`, `packages/web/test/pages/referee.test.tsx`, `control-race.test.tsx`, new `control-fairness.test.tsx`.

---

### Task 1: Assignment model and the per-round assignment

**Files:**
- Modify: `packages/server/src/core/model.ts`, `packages/server/src/core/setup.ts` (`setSettings`), `packages/server/src/core/lifecycle.ts` (`openNextRound`)
- Create: `packages/server/src/core/rotation.ts`
- Test: `packages/server/test/core/rotation.test.ts`; `packages/server/test/core/helpers.ts` (add helper)
- Docs: `docs/design.md`

**Interfaces — Produces (exact):**

```ts
// model.ts
export interface RosterEntry { deviceId: string; name: string; home: number }           // one paired, non-revoked referee
export interface Assignment { deviceId: string; name: string; station: number; tables: number[] } // tables: only those this referee judges this round
export interface Ctx { now: number; actor: Actor; newId: () => string; roster?: RosterEntry[] }
// LiveEvent additions
settings: { …; rotateReferees?: boolean }            // missing = off; newEvent() sets true
assignments?: Record<number, Assignment[]>            // round → assignments, saved at openNextRound when rotation is on
// SetupCommand setSettings gains: rotateReferees?: boolean  (must be boolean when present, else fail('invalid', …))

// rotation.ts
export const rotationOn = (e: LiveEvent): boolean
/** Stations with a team this round → referee. Pure and deterministic. */
export function assignRound(e: LiveEvent, d: DerivedEvent, round: number, roster: RosterEntry[]): Assignment[]
/** The saved assignment of a device in a round, or undefined (rotation off, round not saved, or device unassigned). */
export function assignmentOf(e: LiveEvent, round: number, deviceId: string | undefined): Assignment | undefined
/** Tables an actor judges in a round: the saved assignment's tables when the round has saved assignments
 *  ([] if the device has none); otherwise tablesOfStation(actor.station). [] when actor.station is undefined. */
export function tablesFor(e: LiveEvent, actor: Actor, round: number): number[]
/** teamIds each referee had in each round, from assignments + that round's entrants' tables. round → deviceId → teamIds */
export function refereeTeams(e: LiveEvent, d: DerivedEvent): Record<number, Record<string, string[]>>
```

`openNextRound`: when `rotationOn(e)`, after building `stations` and saving the line-up, set `assignments[round] = assignRound(next, derive(next), round, ctx.roster ?? [])`. When rotation is off, leave `assignments` untouched.

`assignRound` rules (spec "Rotation" and "Finals split"):
- Busy stations = stations with at least one entrant this round. Each busy station gets at most one referee from the roster; `tables` = that station's tables that have an entrant.
- Cost of putting referee R on station S = for each team at S: number of earlier rounds R had that team (from `refereeTeams`) + 3 if R had it in `round − 1`.
- Choose the assignment covering as many busy stations as possible (all of them when `roster.length >= busy.length`) with the lowest total cost; ties → fewest referees whose station differs from their station in `round − 1` (their `home` if they had none); then → lexicographically smallest list of deviceIds in station order. Exact search is required to be correct for up to 13 stations and 16 referees and to return within 50 ms in the test below (Hungarian algorithm with the tie-breakers folded into scaled integer costs is the expected approach).
- When `roster.length < busy.length`: stations are covered in ascending station order as far as referees go (choose which referee by the same cost rule).
- Finals split: only when `perStation(e) === 2`. For each race with `role` `'final'`, `'winners'` or `'grand'` whose two entrants are at one station: if a roster referee is still unassigned, give the assigned referee `tables: [lower]` and add an `Assignment` for the spare (lowest-cost spare, same rule) with the same `station` and `tables: [higher]`. Process such races in station order while spares remain. (`'winners'` is the deciding race of a 4+ bracket; `'others'` is not split.)

- [ ] **Step 1: Add the helper `roster(n: number): RosterEntry[]`** to `packages/server/test/core/helpers.ts`: entries `{ deviceId: 'dev1'…, name: 'Ref 1'…, home: i }`; and `refereeDev(deviceId: string, station: number): Actor`.

- [ ] **Step 2: Write failing tests** in `rotation.test.ts` (use `lockedFour()`, `previousEvent()`, `runRound`, `handleLifecycle`, `ctx`):
  - `newEvent(...).settings.rotateReferees === true`; `setSettings{rotateReferees:false}` works with setup locked; a non-boolean is refused with `invalid`.
  - `opening a round saves one referee per busy station`: `previousEvent()` with `rotateReferees: true`, open round 1 with `roster(13)` → `assignments[1]` has one entry per station that has a team, each station once, each device at most once, `tables` equal that station's occupied tables.
  - `rotation off saves nothing`: `assignments` stays `undefined`; `tablesFor(e, referee(2), 1)` equals `tablesOfStation(2, …)`.
  - `an event stored before rotation keeps home stations`: delete `settings.rotateReferees` → as above.
  - `no referee has the same team two rounds running when it can be avoided`: `previousEvent()`, rotation on, `roster(13)`, play all rounds with `runRound`-style opening (pass the roster in `ctx`), then from `refereeTeams`: for every round r>1 and referee, intersection of their teams in r and r−1 is empty; and across the event no referee has any team 3 times.
  - `fewer referees than stations`: `roster(2)` on a round with ≥4 busy stations → exactly 2 assignments, on the two lowest busy stations; the round still opens; `roster([])` → `[]` and the round opens.
  - `deterministic`: two calls with the same inputs (roster order shuffled) return deep-equal results.
  - `fast enough`: `assignRound` on `previousEvent()` round 1 with `roster(16)` takes < 50 ms.
  - `finals split`: `lockedFour()` with rotation on and `roster(3)`; play to the placement round (round 4: winners on tables 1–2, others on 3–4) → the winners' station has two assignments with `tables: [1]` and `[2]`, the others' station has one with `[3, 4]`. With `roster(2)` → no split. With `tablesPerStation: 1` → no split logic runs.
  - `tablesFor` returns `[]` for a paired device with no assignment in a round that has saved assignments.

- [ ] **Step 3: Run** `npx vitest run packages/server/test/core/rotation.test.ts` — expect failures (missing module).
- [ ] **Step 4: Implement** the model changes, `setSettings` validation, `rotation.ts`, and the `openNextRound` hook.
- [ ] **Step 5: Run** the file, then `npm run typecheck && npm test` — all pass.
- [ ] **Step 6: Update `docs/design.md`**: add a "Referee rotation" subsection under the referee/stations section stating the rules above in prose (assignment saved per round, cost rule, tie-breaks, fewer referees, finals split, setting default).
- [ ] **Step 7: Commit** `feat(server): assign referees to stations per round`.

---

### Task 2: Permissions, Ready and the referee view follow the assignment; swap

**Files:**
- Modify: `packages/server/src/core/taps.ts` (`refereeCheck`), `lifecycle.ts` (`stationReady`, new `swapReferees`), `views.ts` (`refereeView`), `model.ts` (command), `apply.ts` (permission), `broadcast.ts` if a snapshot is needed, `packages/web/test/support/state.ts` (`refViewOf`)
- Test: `packages/server/test/core/rotation.test.ts`, existing `views.test.ts`/`tables-per-referee.test.ts` stay green
- Docs: `docs/design.md`

**Interfaces — Consumes:** `tablesFor`, `assignmentOf`, `Assignment` (Task 1).

**Produces:**
```ts
// views.ts — signature change (all callers updated in this task; hub.ts gets a minimal call-site fix: pass the actor)
export function refereeView(e: LiveEvent, d: DerivedEvent, who: { station?: number; deviceId?: string })
// returned shape: unchanged fields, plus
//   station.tables  = tablesFor(e, who, e.round.current)  (so [] when unassigned)
//   station.number  = assigned station, or who.station when rotation is off, or 0 when unassigned
//   station.assigned: boolean        // false only when the round has saved assignments and this device has none
//   station.moved: boolean           // true when assigned and the set of tables differs from this device's tables in round−1
//                                     // (home station's tables when it had none); false in round 1 only if equal to home
// teams = entrants of the current round whose table is in station.tables
// model.ts LifecycleCommand gains:
| { type: 'swapReferees'; a: string; b: string }      // deviceIds; admin only
```
- `refereeCheck(teamId)`: entrant's table must be in `tablesFor(e, ctx.actor, e.round.current)`, else `not_your_team`.
- `stationReady`: the station is the one containing the actor's tables for the current round (`assignmentOf(...)?.station ?? actor.station`); with no tables → `not_your_station`. `table` given must be in the actor's tables (`not_your_table`). Without `table`, mark ready only the actor's tables (so with a split station each referee readies their own table and the station is ready when both have).
- `swapReferees`: gates `round_not_open` (phase must be `open`), `rotation_off` (no saved assignments for the round), `not_found` (either id not in the roster passed in `ctx.roster` — an unassigned roster referee is allowed and simply takes the other's place). Swaps `station` and `tables` between the two entries (an unassigned `b` gets `a`'s entry and `a` becomes unassigned), and clears the ready state of the tables involved. Not allowed in any other phase.

- [ ] **Step 1: Failing tests** (append to `rotation.test.ts`):
  - With rotation on, `roster(2)`, `lockedFour()` round 1: the referee assigned station 2 can `tapFinish` a table-3 team; the other referee gets `not_your_team`; an unassigned third device gets `not_your_team` and `stationReady` → `not_your_station`.
  - `refereeView(e, d, {deviceId, station: home})` lists exactly the teams at the assigned tables; for an unassigned device `station.assigned === false`, `teams` is `[]`, `tables` is `[]`.
  - `station.moved` is `true` when round 2's tables differ from round 1's and `false` when equal.
  - Split final: each of the two referees can ready and tap only their own table (`not_your_table` / `not_your_team` for the other); the station becomes `ready` only after both.
  - `swapReferees` exchanges two referees while open; refused with `round_not_open` when running; a referee already Ready loses that Ready after the swap; swapping with an unassigned roster referee moves them in.
  - Rotation off: `refereeView(e, d, {station: 1})` deep-equals the previous output plus `assigned: true, moved: false` (compare against a snapshot built from the same fields as before).
- [ ] **Step 2: Run, see failures. Step 3: Implement.** Update `refViewOf(e, station = 1)` in `packages/web/test/support/state.ts` to pass `{ station }`.
- [ ] **Step 4:** `npm run typecheck && npm test` pass.
- [ ] **Step 5:** `docs/design.md`: permissions paragraph and the `swapReferees` command.
- [ ] **Step 6: Commit** `feat(server): referee permissions and view follow the round's assignment`.

---

### Task 3: Hub wiring — roster, per-referee sockets, late pairing and revoking

**Files:**
- Modify: `packages/server/src/hub.ts`, `packages/server/src/core/rotation.ts` (two pure helpers), `packages/server/src/core/views.ts` (`controlView` extras)
- Test: `packages/server/test/worker/api.test.ts` (or a new `rotation.test.ts` in the same folder using `client.ts` helpers), `packages/server/test/core/rotation.test.ts`
- Docs: `docs/design.md`, `README.md` (only if a route or message changes — none expected)

**Interfaces — Produces:**
```ts
// rotation.ts
/** A referee paired while `round` is open: takes its home station's tables if no assignment has that station; else unchanged. No-op unless rotation on and phase 'open'. */
export function withLateReferee(e: LiveEvent, d: DerivedEvent, ref: RosterEntry): LiveEvent
/** Removes a device from the open or running round's assignments (its tables then have no referee). Earlier rounds untouched. */
export function withoutReferee(e: LiveEvent, deviceId: string): LiveEvent
// views.ts controlView adds:
//   assignments: Assignment[]            // the current round's, [] when none
//   roster: RosterEntry[]                // from extras
// controlView's extras param becomes { devices: unknown[]; audit: unknown[]; roster: RosterEntry[] }
```
Hub changes:
- `private roster(): RosterEntry[]` — `SELECT id, station, label FROM devices WHERE event_id=? AND revoked_at IS NULL ORDER BY id`; `name` = label, or `Referee {station}` for a null label.
- `command()` passes `roster: this.roster()` in the `Ctx` it builds.
- Referee sockets: tag `referee:${deviceId}` (was station). `initialMessage` and `afterChange` build `refereeView(e, d, attachment.actor)` per connected device (send one view per distinct deviceId). Revocation closing stays as is.
- `pair()`: after inserting the device, if an event is active apply `withLateReferee` and persist the doc in the same transaction as the audit row. `revokeDevice`: apply `withoutReferee` and persist. Both then go through `afterChange` as today.
- `whoAmI` unchanged.

- [ ] **Step 1: Failing core tests** for `withLateReferee` (takes free home station; no-op when the station already has a referee, when running, when rotation off) and `withoutReferee` (current round only).
- [ ] **Step 2: Failing worker tests** (use `lockedEvent`, `pairReferee`, `command`, `connect`, `settle` from `test/worker/client.ts`; turn rotation on with `setSettings`):
  - Two referees paired to stations 1 and 2; open round 1; each socket receives a `view` whose `station.tables` matches `controlView.assignments`; a finish tap for a table in the other referee's tables is refused `not_your_team`.
  - **Reconnect:** close a referee socket after the round opens, connect again with the same cookie → the first `view` has the assigned tables (Review Focus 1).
  - Open round 2: at least one referee's `view.station.moved` is `true` when their tables changed.
  - Pair a third referee while round is open to a station with no referee → their view shows that station's tables; revoke a referee → `controlView.assignments` no longer lists them and their socket closes.
  - Rotation off (default for an event with the setting cleared): behaviour identical to the existing pairing test.
- [ ] **Step 3: Implement. Step 4:** `npm run typecheck && npm test` pass (existing worker tests must stay green; update only assertions that depended on the socket tag).
- [ ] **Step 5:** `docs/design.md`: hub paragraph (roster, sockets per referee, late pair/revoke).
- [ ] **Step 6: Commit** `feat(server): hub passes the referee roster and sends each referee their own view`.

---

### Task 4: Fairness warnings

**Files:**
- Create: `packages/server/src/core/fairness.ts`
- Modify: `model.ts` (types, `Override.by`, `Tap.by`, command), `taps.ts` (record `by: ctx.actor.label` on control taps and overrides), `lifecycle.ts` or `taps.ts` (`dismissWarning`), `apply.ts`, `views.ts` (`controlView`)
- Test: `packages/server/test/core/fairness.test.ts`
- Docs: `docs/design.md`

**Interfaces — Produces:**
```ts
export type WarningKind = 'fast_time' | 'referee_wins' | 'repeat_team' | 'repeat_penalty' | 'penalty_outlier'
  | 'close_finish' | 'undo_changed_winner' | 'final_one_referee';
export interface FairnessWarning { id: string; kind: WarningKind; round: number; referee: string | null; refereeId: string | null;
  teamIds: string[]; message: string }
export interface Dismissal { by: string; at: number; note: string }
// LiveEvent: dismissed?: Record<string, Dismissal>
// Override gains by?: string; Tap gains by?: string (set for source 'control')
// LifecycleCommand gains { type: 'dismissWarning'; id: string; note: string }  admin only; note trimmed, 1–200 chars else 'invalid';
//   id must be a current warning's id else 'not_found'; saving again overwrites.
export function fairnessWarnings(e: LiveEvent, d: DerivedEvent): FairnessWarning[]   // newest round first, then kind, then id
// controlView adds: fairness: { open: FairnessWarning[]; dismissed: (FairnessWarning & { dismissal: Dismissal })[] }
```
Ids are stable strings built only from kind + round + refereeId + sorted teamIds (e.g. `close_finish:5:dev3:tA,tB`; `referee_wins:dev3`, `penalty_outlier:dev3` have no round and use `round` = the latest finished round in the object). Who judged a team in a round = the `Assignment` whose `tables` include the team's table that round; with no saved assignments for the round, fall back to the `deviceId` on the team's finish tap (name unknown → `referee: null`), and skip checks that need the referee when neither exists. Only finished rounds count, except `repeat_team`, `final_one_referee` (evaluated for the open round too) and `fast_time`/`close_finish`/`undo_changed_winner` (evaluated as results arrive in the running round).

Rules, exact (constants from Global Constraints):
- `fast_time`: order all official finish times by the time they were recorded (finish tap `createdAt` / override `at`, current value per team per round). A result fires when a fastest-so-far exists from an earlier-recorded result in **any** round and `fastestBefore − officialMs >= FAST_MS`.
- `referee_wins`: races with ≥ 2 entrants in finished rounds, excluding seeding rounds and races whose entrants were all judged by one referee. Expected order = ascending seeding total (`seedTotals`; export it from `views.ts` or move it to `results.ts`); actual place from `race.ranking.order`. For each entrant judged by R: `better` if actual place < expected place, `worse` if >. Fire for R when counted entrant-races ≥ `WINS_MIN_RACES` and `better − worse >= WINS_MARGIN`.
- `repeat_team`: from `refereeTeams`: R has team T in ≥ `REPEAT_TEAM_TIMES` rounds, or in rounds r and r−1. One warning per (R, T) at the latest such round.
- `repeat_penalty`: non-removed, non-rejected referee penalty taps by R's device on team T in ≥ `REPEAT_PENALTY_ROUNDS` distinct rounds.
- `penalty_outlier`: once `finishedRounds >= OUTLIER_FROM_ROUND`; count non-removed referee penalty taps per device over referees with ≥ 1 assignment (or ≥ 1 tap when no assignments exist); `avg` = total / referees. Fire for R when `count >= OUTLIER_MIN && count > 2 * avg`, or `count === 0 && avg >= OUTLIER_AVG_FOR_NONE`.
- `close_finish`: two entrants of one race, both judged by R, both with official times, `|a − b| <= CLOSE_MS`.
- `undo_changed_winner`: a removed referee finish tap for team T in a race with ≥ 2 entrants: compute the race winner with T's result replaced by the removed tap's `elapsedMs` (+ T's current penalties) and compare with the current winner (`ranking.order[0]`); fire when they differ and all entrants have results.
- `final_one_referee`: rotation on, `perStation === 2`, a race with role `final`/`winners`/`grand` in a round with saved assignments whose two entrants' tables are both in one `Assignment.tables`.

- [ ] **Step 1: Failing tests** in `fairness.test.ts`, one `describe` per kind, each with a firing case and the nearest non-firing case (29 999 ms vs 30 000 ms; 500 ms vs 501 ms; 5 races vs 6; margin 3 vs 4; second vs third time; consecutive rounds; one round vs two rounds of penalties; outlier both directions; undo that keeps the winner vs changes it). Build events with `lockedFour()`/`previousEvent()`, `handleLifecycle`, `handleTaps`, direct `overrides`/`taps`/`assignments` edits where simpler. Plus:
  - Review Focus 5: a `fast_time` warning disappears after `setResult` corrects the time; a dismissed `close_finish` stays in `dismissed` after an unrelated result in another race changes.
  - Review Focus 3: `fairnessWarnings` on `previousEventDone()`-style event with `assignments`, `dismissed` and `settings.rotateReferees` deleted returns without throwing and contains no kind that needs a referee name with `referee: null` crashing the message.
  - `dismissWarning`: unknown id → `not_found`; empty note → `invalid`; referee actor → `forbidden` (through `applyCommand`); audit entry written.
  - `controlView(...).fairness.open` excludes dismissed ids; `publicView`, `refereeView`, `companionView` JSON contain neither `"fairness"` nor `"assignments"` nor `"dismissed"`.
  - control taps/overrides created by `setResult`/`addPenalty` carry `by`.
- [ ] **Step 2: Run, fail. Step 3: Implement. Step 4:** `npm run typecheck && npm test` pass.
- [ ] **Step 5:** `docs/design.md`: a "Fairness warnings" section with the table of kinds and exact thresholds, dismissal, and where they are visible.
- [ ] **Step 6: Commit** `feat(server): fairness warnings for race control`.

---

### Task 5: Fairness report export

**Files:**
- Create: `packages/server/src/core/fairnessExport.ts`
- Modify: `packages/server/src/core/export.ts` (export `cell`), `hub.ts` (`exportEvent`), `worker.ts` (`format=fairness`)
- Test: `packages/server/test/core/fairness-export.test.ts`, one worker test in `api.test.ts`
- Docs: `docs/design.md`, `README.md` (export route table)

**Interfaces — Produces:**
```ts
export function fairnessCsv(e: LiveEvent): string
// hub.exportEvent(eventId, format: 'json' | 'csv' | 'fairness')
// GET {api}/export?event=<id>&format=fairness → text/csv, filename "race-to-feed-fairness.csv"
```
File layout — three sections, each a title line, a header row, rows, then one blank line:
1. `Warnings` — `kind,round,referee,teams,message,status,dismissed_by,dismissed_at,note` (`status` = `open`/`dismissed`; teams = names joined with `; `; times ISO 8601 UTC).
2. `Race control edits` — `at,by,round,team,change` for every override (`change`: `time 3:41.20`, `DNF`, `DNS`, `cleared`) and every control-source penalty tap (`penalty added: {reasonName}`; plus a `penalty removed` row at `removedAt` for removed penalty taps of either source that were removed by race control — a removed tap whose `source` is `control`, or any penalty tap with `review.status === 'rejected'` → `penalty rejected`). Sorted by `at`. `by` empty for records stored before `by` existed.
3. `Referee assignments` — `round,referee,station,tables,teams` for every saved assignment, round then station order.
Every text cell goes through `cell()` (formula escaping).

- [ ] **Step 1: Failing tests:** section titles and headers present in order; a team named `=SUM(A1)` is escaped in all three sections; an event with no assignments/warnings yields the three headers with no rows; a dismissed warning row carries the note; edits are in time order; worker test: `format=fairness` returns 200 `text/csv` for the console and 401/403 without sign-in (match how the existing export test asserts auth).
- [ ] **Step 2–4:** fail, implement, `npm run typecheck && npm test`.
- [ ] **Step 5:** docs. **Step 6: Commit** `feat(server): fairness report export`.

---

### Task 6: Referee tablet — "go to your tables"

**Files:**
- Modify: `packages/web/src/pages/referee/RefereePage.tsx` (+ its CSS file beside it)
- Test: `packages/web/test/pages/referee.test.tsx`
- Docs: `docs/user-guide.md` (Referees section), `docs/design.md` (§ referee tablet)

**Interfaces — Consumes:** `RefereeView.station.{assigned, moved, tables, number}` (Task 2).

Behaviour:
- `station.assigned === false`: header reads "No tables this round"; body: "You have no tables this round. Stay nearby: race control may still need you." No buttons.
- `station.moved === true` and phase `open`: a full-width notice above everything else: heading `Round {n}: go to {stationLabel(tables)}` and a button **I'm there**. Until pressed, the Ready buttons are hidden. The press is remembered in component state keyed by `round.current` plus the tables (so a swap by race control shows the notice again); also stored in `sessionStorage` under `r2f.there` (wrapped in try/catch) so a reload does not ask again.
- Phase `running` with an unacknowledged notice: show the tap buttons regardless (never block taps).
- Rotation off: nothing changes (existing tests untouched).

- [ ] **Step 1: Failing tests:** unassigned view shows the message and no Ready/tap buttons; moved+open shows the notice with the right tables and hides Ready until **I'm there**; after the press Ready shows; running + moved shows tap buttons without pressing; a new view with different tables for the same round shows the notice again; not moved → no notice.
- [ ] **Step 2–4:** fail, implement, `npm run typecheck && npm test`.
- [ ] **Step 5:** guide: new subsection "Moving between rounds" under Referees (what the notice says, press I'm there, then Ready; "No tables this round"); design.md.
- [ ] **Step 6: Commit** `feat(web): referee tablet shows where to go each round`.

---

### Task 7: Race control console — referee names, Swap, Fairness panel, setting, export link

**Files:**
- Modify: `packages/web/src/pages/control/sections/Race.tsx` (Stations), `ConsolePage.tsx` (badge), `Settings.tsx` (switch), `Events.tsx` (link ×2), `Devices.tsx` (this round's tables)
- Create: `packages/web/src/pages/control/sections/Fairness.tsx`
- Test: `packages/web/test/pages/control-race.test.tsx`, new `control-fairness.test.tsx`, `control-admin.test.tsx` for the setting and link
- Docs: `docs/user-guide.md`, `docs/design.md` (§7 console)

**Interfaces — Consumes:** `ControlView.assignments`, `.roster`, `.fairness`, commands `swapReferees{a,b}`, `dismissWarning{id,note}`, `setSettings{rotateReferees}`, export `format=fairness`.

Behaviour:
- **Stations panel:** under each station's label, the referee name(s) from `view.assignments` (`Dana` or, for a split final, `Dana (T1) · Lee (T2)`); `No referee` in the secondary colour when a station with teams has none and rotation is on. Nothing added when `view.assignments` is empty.
- **Swap:** while the phase is `open` and `view.assignments.length > 0`, each referee name has a `Swap…` button (aria-label `Swap {name}`) opening a small select of the other roster referees (assigned ones as `Lee — Tables 3 & 4`, unassigned as `Sam — no tables`) and a **Swap** confirm that sends `swapReferees`. Errors show under the card via the runner as elsewhere.
- **Fairness panel** (`<Fairness view={view} />`, rendered in `Race` after `PenaltyReviews`): `section.panel aria-label="Fairness"`, heading "Fairness" with a count badge of open warnings. Each open warning: message, "Round n" and the referee name in the secondary line, and **Dismiss**, which reveals a required note input (maxLength 200) and **Save**; sends `dismissWarning`. Empty state: "Nothing to look at." A `<details>` "Dismissed (n)" lists dismissed ones with the note, who and when. One intro line under the heading: "These are prompts to take a look, not proof of anything."
- **Badge:** `ConsolePage` shows the open-warning count beside the "Race Control" nav item (reuse the existing badge style used by "Penalties to review"); hidden at 0.
- **Settings:** `<Switch checked={view.settings.rotateReferees ?? false} label="Rotate referees each round" …>` sending `setSettings{rotateReferees}`, with a footnote: "Referees are sent to different tables each round so nobody judges the same team repeatedly. Takes effect from the next round opened."
- **Events:** a third link "Fairness report" beside CSV and JSON in both places (`format=fairness`).
- **Referees tab (Devices.tsx):** after each referee's name, "this round: Tables 7 & 8" (or "no tables this round") when `view.assignments` is non-empty; the column heading for the station becomes "Starting station" when `view.settings.rotateReferees`.

- [ ] **Step 1: Failing tests** covering each bullet: names on cards incl. split final and "No referee"; Swap sends `{type:'swapReferees', a, b}` and is absent while running; Fairness lists open warnings, Dismiss requires a note and sends `dismissWarning`, dismissed list shows the note; empty state; nav badge count; settings switch sends `setSettings{rotateReferees:true}`; Fairness report link href. Build views with `ctlViewOf(e)` and spread in `assignments`/`roster`/`fairness` fixtures (extend `ctlViewOf` to pass `roster: []`).
- [ ] **Step 2–4:** fail, implement, `npm run typecheck && npm test`.
- [ ] **Step 5:** guide: (a) Settings → "Rotate referees each round"; (b) Race control → "Referees on each station" and "Swap two referees"; (c) a new "Fairness" section listing the eight warnings in plain words (one line each, in the spec table's order), how to dismiss, and the sentence that they are prompts, not proof; (d) "Fairness report" under exports; (e) troubleshooting entries: "A referee's tablet says 'No tables this round'", "A station shows 'No referee'", "I turned rotation on and nothing moved" (takes effect from the next round opened). design.md §7.
- [ ] **Step 6: Commit** `feat(web): referee rotation and fairness in the race control console`.

---

### Task 8: End-to-end, guide screenshots and PDF

**Files:**
- Modify: `e2e/event.spec.ts` (or a new `e2e/rotation.spec.ts`), `e2e/guide.spec.ts`, `docs/user-guide.md` (image references), `README.md` if anything in it is now stale
- Generated: `docs/guide/images/*`, `docs/Race-to-Feed-User-Guide.pdf`

- [ ] **Step 1: e2e** (`npm run e2e`): one test with rotation on (new events default on): pair two referees (stations 1 and 2) on a 4-table event, open round 1, each tablet shows its tables; finish the round; open round 2; a tablet whose tables changed shows "Round 2: go to …", **I'm there**, Ready; race control's Stations panel shows both names; swap them and see the tablets follow; finish with two finishes within 0.5 s at one referee's tables and see a "Close finish" warning in the Fairness panel; dismiss it with a note; download the fairness report and check it contains the note. Existing e2e specs must pass: where they rely on a referee staying at station 1, set `rotateReferees` off at the start of that spec through the console (keep their intent unchanged).
- [ ] **Step 2: guide screenshots** in `e2e/guide.spec.ts`: `referee-go-to-tables.jpg` (the notice), `console-stations-referees.jpg` (Stations panel with names and Swap), `console-fairness.jpg` (Fairness panel with one open and one dismissed warning), and the Settings shot retaken with the new switch. Reference each from the guide sections written in Tasks 6–7.
- [ ] **Step 3:** `npm run guide`; open each new image and check it shows what its caption says; `npm run typecheck && npm test && npm run e2e` all pass.
- [ ] **Step 4: Commit** `docs: guide screenshots and PDF for referee rotation and fairness; e2e`.
