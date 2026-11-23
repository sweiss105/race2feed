# Penalty Review, Show Champion and End Event: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** three features the user asked for after the first live test:
1. **Penalty review:** referees note penalties, race control approves or rejects them with a reason from a list.
2. **Show champion:** race control puts the champion and the bag total on every phone and on the projector.
3. **End event:** admin closes an event, which locks it and leaves its final results visible.

**Architecture:** the same layers as before.
- **Pure command core** (`packages/server/src/core`): new state on `LiveEvent`, new commands, new gates.
- **Views:** carry the new fields.
- **Hub:** handles `endEvent` and keeps a "display event" (the active event, or else the most recently ended one) for public sockets.
- **Pages:** render the new state.

The engine is unchanged: a DQ is ranked as `dnf`.

**Spec:** `docs/design.md`, §4.1 (show champion, end event) and §5.2 (penalty notes and review). UX follows the `anthropic-skills:apple-design` skill.

## Global Constraints

- **Penalty reasons:**
  - Each reason is `{ id: string; name: string; kind: 'time' | 'dq'; amountMs?: number }`.
  - Names are non-empty and unique (case-insensitive), at most 60 characters.
  - `amountMs` is an integer ≥ 0, required when `kind` is `'time'`.
  - Starter list for new events, and for stored events that have no list:

    | id | name | kind | amountMs |
    |---|---|---|---|
    | `sealed` | Bag not sealed | time | 5000 |
    | `count` | Wrong item count | time | 5000 |
    | `early` | Started early | time | 10000 |
    | `unsafe` | Unsafe conduct | dq | — |

- **Referee notes** are at most 200 characters, trimmed.
- **A penalty is pending while** `review.status === 'pending'` and `removedAt === null`.
  - Referee taps start pending.
  - Penalties race control adds start approved.
- **Approving:**
  - With a time reason, the tap's `amountMs` becomes the reason's amount.
  - With a DQ reason, the team's result for that round becomes `dnf`, plus `dq: true` and the reason name in views.
- **Rejecting** sets `removedAt` and keeps the record (`review.status = 'rejected'`).
- **New error codes:**
  - `openNextRound` returns `penalties_pending`, with `detail: { tapId, round, teamId }[]`.
  - `showChampion` returns `not_finished` unless the phase is `finished` and `current === rounds.length`.
  - Every command on an ended event returns `event_ended`. In practice the ended event is no longer active, so commands get `no_active_event` from the hub.
- **Public view additions:**
  - `championShown: boolean` and `ended: boolean`.
  - On each entrant: `penaltyNotes: string[]` (approved reason names), `penaltyPending: boolean` and `dq: string | null`.
  - `publicRoundUpdate` must stay ≤ 8 KB for 26 entrants.
- **Projector screen:** `champion` whenever `championShown || ended`, unless a pin says otherwise.

## Review Focus

1. **A referee sends a note after race control has already decided that penalty.** The command is refused (`already_decided`) and nothing changes. Covered by a test in Task 2.
2. **Race control approves a DQ, then later approves a different time reason for a second penalty on the same team.** The team stays DQ: any approved DQ wins. Covered by a test in Task 2.
3. **The DQ'd team had the fastest time in a head-to-head.** The opponent wins the heat, and the next round is built accordingly. Covered by a test in Task 2.
4. **The admin ends the event while a round is running.** It's allowed after the confirmation. Tablets are disconnected (4401), and phones get a snapshot with `ended: true`. Covered by tests in Task 4.
5. **A stored event from before this change**, with no `penaltyReasons` and taps without `review`, loads and works. Old penalty taps count as approved. Covered by a test in Task 1.

---

### Task 1: Penalty reasons list

**Files:**
- Modify: `packages/server/src/core/model.ts`, `setup.ts`, `apply.ts`
- Create: `packages/server/src/core/reasons.ts`
- Test: `packages/server/test/core/reasons.test.ts`

**Interfaces:**
- `PenaltyReason` type and `STARTER_REASONS` (Global Constraints).
- `reasonsOf(e: LiveEvent): PenaltyReason[]` returns `e.penaltyReasons ?? STARTER_REASONS`.
- `LiveEvent.penaltyReasons?: PenaltyReason[]`. `newEvent` sets it to the starter list.
- Command `setPenaltyReasons {reasons}`: admin only, allowed while setup is locked. Validated per Global Constraints; failures return `invalid` with the problems in `detail`.
- `Tap.review?: { status: 'pending' | 'approved' | 'rejected'; reasonId?: string; reasonName?: string; refereeReasonId?: string; refereeNote?: string; dq?: boolean; decidedAt?: number }`.
- `reviewOf(t: Tap)`: a penalty tap without `review` is treated as `{ status: 'approved' }` (old data).

- [ ] **Step 1: Write the failing tests.**
  - New events have the 4 starter reasons.
  - An event without the field still gets the starter reasons from `reasonsOf`.
  - `setPenaltyReasons` with a duplicate name or a time reason without an amount gives `invalid`.
  - It works while setup is locked.
  - Race control gets `forbidden`.
  - `reviewOf` on a legacy penalty tap gives approved.
- [ ] **Step 2:** Run the tests; expect FAIL. Implement. Run again; expect PASS.
- [ ] **Step 3: Commit:** `feat(server): penalty reasons list`

### Task 2: Penalty review lifecycle

**Files:**
- Modify: `taps.ts`, `lifecycle.ts`, `results.ts`, `apply.ts`, `model.ts`
- Test: `packages/server/test/core/penalty-review.test.ts`

**Interfaces:**
- **Referee `tapPenalty`** creates `review: { status: 'pending' }`.
- **`notePenalty {tapId, reasonId, note?}`** (referee):
  - The tap must be the actor's (`not_your_tap`), not removed, and still pending (`already_decided`).
  - The round must be finished, or the tap's round must be before the current one (`round_not_finished`).
  - `reasonId` must exist (`invalid`).
  - Sets `refereeReasonId` and `refereeNote`.
- **`decidePenalty {tapId, decision: 'approve' | 'reject', reasonId?, confirmUnlock?}`** (control):
  - Approving needs a valid `reasonId`.
  - Applies the rules in Global Constraints.
  - Goes through `checkCorrection` for rounds before the current one.
  - Re-deciding an already-decided penalty is allowed, for corrections.
- **`addPenalty {round, teamId, reasonId, confirmUnlock?}`:** `reasonId` is now required. The penalty is approved immediately; a time reason sets the amount and a DQ reason sets `dq`.
- **`buildProgress`:** any active penalty with an approved `dq` makes that team's result `dnf` (`rawMs: null`), whatever its finish tap says.
- **`openNextRound`:** returns `penalties_pending` while any penalty in rounds 1 to current is pending.

- [ ] **Step 1: Write the failing tests.**
  - Referee penalty starts pending.
  - A note is refused while running (`round_not_finished`) and accepted after finish.
  - A note after the decision gives `already_decided` (Review Focus 1).
  - Approve with `early` sets `amountMs` to 10000.
  - Reject sets `removedAt`, so the penalty no longer counts.
  - Approve with DQ makes the result `dnf`. A later time approval on the same team doesn't undo the DQ (Review Focus 2).
  - A DQ'd fastest team loses the heat: the next round's winners race contains the opponent (Review Focus 3).
  - `openNextRound` with a pending penalty gives `penalties_pending`; after a decision, `ok`.
  - `addPenalty` without a reason gives `invalid`; with one it's approved immediately.
- [ ] **Step 2:** FAIL → implement → PASS. Update the earlier tests that called `addPenalty` without `reasonId`, and the console's call site in Task 6.
- [ ] **Step 3: Commit:** `feat(server): penalty notes and race-control review`

### Task 3: Views and export for penalties

**Files:**
- Modify: `views.ts`, `hub.ts` (CSV)
- Test: `packages/server/test/core/views.test.ts`, `packages/server/test/worker/api.test.ts`

**Interfaces:**
- **Public entrants:** add `penaltyNotes`, `penaltyPending` and `dq` (Global Constraints).
- **`refereeView`:**
  - Adds `reasons: PenaltyReason[]`.
  - Each tap adds `review: { status, refereeReasonId, refereeNote }` and `source` (`'referee' | 'control'`).
- **`controlView`:**
  - Adds `penaltyReasons`.
  - Adds `penaltyReviews: { tapId, round, teamId, status, amountMs, refereeReasonId, refereeNote, reasonId, createdAt }[]` covering every referee penalty, newest first.
- **CSV:** adds columns `penalty_reasons` (`;`-joined), `dq_reason` and `referee_notes`.

- [ ] **Step 1: Write the failing tests.**
  - A public entrant with an approved penalty lists its name, and a pending one sets `penaltyPending`.
  - A DQ shows its reason.
  - `penaltyReviews` lists the referee note.
  - The CSV export contains the reason and the note.
  - The round update still fits 8 KB.
- [ ] **Step 2:** FAIL → implement → PASS.
- [ ] **Step 3: Commit:** `feat(server): penalty reasons in views and export`

### Task 4: Show champion and end event (server)

**Files:**
- Modify: `model.ts`, `lifecycle.ts`, `views.ts`, `hub.ts`, `apply.ts`, `core/broadcast.ts`
- Test: `packages/server/test/core/champion.test.ts`, `packages/server/test/worker/end-event.test.ts`

**Interfaces:**
- **`LiveEvent`** gains `championShown?: boolean` and `endedAt?: number | null`.
- **`showChampion {bagTotal}`** (control and admin):
  - Returns `not_finished` unless the phase is `finished` and `current === rounds.length`.
  - Sets `bagTotal` (trimmed, null if empty) and `championShown = true`.
- **`hideChampion`** sets `championShown = false`.
- Both commands trigger a full snapshot.
- **`projectorScreen`** returns `champion` when `championShown || endedAt`, unless pinned.
- **Hub `endEvent {eventId}`** (admin):
  - Sets `endedAt = now`, `active = 0` and `championShown = true` in the stored doc.
  - Revokes all of the event's devices and closes referee sockets (4401).
  - Sets the **display event** to that event and sends public sockets a snapshot.
- **Hub `activateEvent`** on an ended event clears `endedAt`.
- **Hub display event:** `this.display = active ?? mostRecentlyEnded`. Public sockets (initial message and broadcasts) use the display event; control and companion use the active event only. `listEvents` gains `ended: boolean`.
- **Public view** adds `championShown` and `ended`.

- [ ] **Step 1: Write the failing tests.**
  - Core:
    - `showChampion` before the last round gives `not_finished`.
    - After it, `championShown` is set, the bag total is set, and the projector shows `champion`.
    - `hideChampion` returns the projector to `seeding-results` or `brackets`, as the round dictates.
  - Worker:
    - `endEvent` closes a referee socket with 4401.
    - A public socket receives a snapshot with `ended: true` and `projector: 'champion'`.
    - A new public socket after the end gets the ended event.
    - `/api/events` lists it with `ended: true, active: false`.
    - Commands then give `no_active_event`.
    - `activateEvent` reopens it (`ended: false`).
- [ ] **Step 2:** FAIL → implement → PASS.
- [ ] **Step 3: Commit:** `feat(server): show champion and end event`

### Task 5: Participant and projector pages

**Files:**
- Modify: `packages/web/src/ui/Time.tsx`, `src/pages/participant/*`, `src/pages/projector/ProjectorPage.tsx`
- Test: `packages/web/test/pages/participant.test.tsx`, `projector.test.tsx`

**Behaviour:**
- **`timeText`:**
  - `3:46.20 (incl. +15s · Started early)` for an approved penalty.
  - `(incl. +5s · under review)` while pending.
  - `DQ · Unsafe conduct` for a DQ.
  - The projector ticker uses only `+15s` or `DQ`.
- **Participant champion screen,** shown when `championShown || ended`:
  - A champion card at the top: Grand Champion (or each category winner if there is no grand round), its category, and the bag total.
  - Below it, final standings per category, with the remembered team highlighted.
  - If `ended`, an "Event complete" banner.
  - The existing tabs stay available below.

- [ ] **Step 1: Write the failing tests.**
  - The penalty texts above.
  - The champion card shows when `championShown`.
  - Without a grand round, it lists the category winners.
  - The ended banner shows.
- [ ] **Step 2:** FAIL → implement → PASS.
- [ ] **Step 3: Commit:** `feat(web): penalty reasons and champion screen for participants`

### Task 6: Referee penalty notes and console controls

**Files:**
- Modify: `src/pages/referee/RefereePage.tsx`
- Modify: `src/pages/control/sections/{Race,Settings,Events}.tsx`
- Create: `src/pages/control/sections/PenaltyReviews.tsx`
- Test: `test/pages/referee.test.tsx`, `control-race.test.tsx`, `control-admin.test.tsx`

**Behaviour:**
- **Referee:** while the phase is `finished`, a **Penalty notes** card appears for each of the station's referee penalties that are still pending.
  - Reason buttons (from `view.reasons`), a note field, and **Send**, which sends `notePenalty`.
  - Once sent, it shows "Sent ✓, race control will review".
- **Console Race section:**
  - A **Penalties to review** panel, above Results, while any are pending. Each card shows team, round, referee pick and note, a reason select (pre-selected with the referee's pick), and **Approve** / **Reject**.
  - The Results "+" penalty button becomes a reason menu (a select plus **Add**).
  - **Show champion** appears when no rounds are left: a sheet with a bags-packed input (pre-filled) and **Show**. While shown, it becomes **Hide champion**.
- **Settings (admin):** a penalty list editor with name, kind (time or DQ) and seconds per row, add and remove rows, and **Save penalty list**.
- **Events (admin):**
  - The active row gets **End event**, with a confirmation sheet that warns "N rounds not raced yet" when relevant.
  - Ended rows show an **Ended** pill.
  - **Make active** on an ended row asks to confirm "Reopen…".

- [ ] **Step 1: Write the failing tests.**
  - The referee notes card appears only after finish and only for pending penalties. Sending posts `notePenalty`.
  - Console review: Approve sends `decidePenalty` with the selected reason; Reject sends reject.
  - Show champion sends `showChampion {bagTotal}`.
  - The settings editor saves the list.
  - End event asks for confirmation, then sends `endEvent`.
- [ ] **Step 2:** FAIL → implement → PASS.
- [ ] **Step 3: Commit:** `feat(web): penalty notes, review, show champion and end event controls`

### Task 7: End-to-end and screens

**Files:**
- Modify: `e2e/event.spec.ts` or add `e2e/finale.spec.ts`; update `e2e/screens.spec.ts`

- [ ] **Step 1: Write `finale.spec.ts`.** Use a 4-team event with penalties on.
  1. The referee taps **+5s** on Alpha. After finish, the referee sends a note ("Started early").
  2. Open next round is refused while the penalty is pending.
  3. Race control approves with `Started early` (+10s), and the phone shows `(incl. +10s · Started early)`.
  4. Run the remaining rounds by entering times in the console, then **Show champion** with bags `1,234`. The phone and projector show the champion and `1,234`.
  5. **End event:** the referee page shows the "Scan" screen, and the phone still shows the champion.
- [ ] **Step 2:** Run `npm run e2e`; expect PASS. Add champion and review screenshots and review them visually against the apple-design checklist.
- [ ] **Step 3: Commit:** `test(e2e): penalty review, champion and end of event`

### Task 8: Tables per referee (1 or 2)

**Files:**
- Modify: `packages/engine/src/{types,stations,layout,event}.ts`
- Modify: `packages/server/src/core/{model,setup,apply,lifecycle,taps,views}.ts`
- Modify: `packages/web/src/pages/{referee/RefereePage,control/sections/Race,control/sections/Devices,control/sections/Setup}.tsx`
- Test: engine `stations.test.ts` and `layout.test.ts`; server `setup.test.ts` and `lifecycle.test.ts`; web `control-admin.test.tsx` and `referee.test.tsx`

**Interfaces:**
- **Engine:**
  - `EventInput.tablesPerStation?: 1 | 2` (default 2).
  - `stationOfTable(table, perStation = 2)`, `tablesOfStation(station, tableCount, perStation = 2)` and `stationCount(tableCount, perStation = 2)`.
  - `layoutTables(races, perStation = 2)` applies the parity rule only when `perStation === 2`. `deriveEvent` passes `input.tablesPerStation ?? 2`.
- **Server:**
  - Setup command `setTablesPerReferee {count: 1 | 2}` (admin, refused once setup is locked).
  - Every station computation (opening a round, referee team checks, views) uses `e.setup.tablesPerStation ?? 2`.
- **Pages:**
  - Setup gets a segmented control: "One referee per table" / "One referee per two tables".
  - Station labels read "Table 3" or "Tables 3 & 4" from the station's tables.

- [ ] **Step 1: Write the failing tests.**
  - `stationOfTable(3, 1) === 3`, `tablesOfStation(3, 26, 1)` gives `[3]` and `stationCount(25, 1) === 25`.
  - With per-station 1, `layoutTables([[a,b,c],[d,e]], 1)` keeps the original order.
  - With per-station 1, opening a 4-team round gives 4 stations, and a station-3 referee can tap table 3 only.
  - `setTablesPerReferee` is refused after lock.
  - The Setup control sends the command.
  - A referee view for a one-table station shows one team button and the label "Table 3".
- [ ] **Step 2:** FAIL → implement → PASS. Re-run the engine acceptance test; it must still reproduce the previous event with the default of 2.
- [ ] **Step 3: Commit:** `feat: choose one or two tables per referee`
