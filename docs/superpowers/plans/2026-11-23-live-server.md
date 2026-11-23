# Live Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a Cloudflare Worker plus one Durable Object ("hub") that runs a Race to Feed event live. It handles event setup, the round lifecycle with its start/finish gates, referee finish and penalty taps on a synced master clock, race-control corrections and tie decisions, sign-in, referee tablet pairing, a Companion API key, and live WebSocket views for every role.

**Architecture:**
- **Pure core:** all event rules live in a pure command core (`src/core/`), with no Workers APIs, clock or randomness. It applies commands to a `LiveEvent` document and projects role-specific views, using `@race2feed/engine` for matchups and rankings.
- **Hub Durable Object:** a thin adapter around the core. It persists each event document and an audit row atomically in its SQLite, authenticates connections, and broadcasts views over hibernatable WebSockets.
- **Worker:** routes `/api/*` to the hub and serves static assets for everything else. Plan 3 builds the pages.

**Tech Stack:** Cloudflare Workers + Durable Objects (SQLite storage, WebSocket hibernation), Wrangler 4, TypeScript, Vitest 5 with `@cloudflare/vitest-plugin` for runtime tests, WebCrypto.

**Spec:** `docs/design.md`. The relevant sections are §3.2 (setup), §4 (round lifecycle), §5 and §5.1 (timing, penalties), §6 (corrections and audit), §7 (what each page needs), §8 (Companion), §9 (access), §10–§11 (architecture, deployment).

**Build series:** plan 2 of 4. Plan 1 (rules engine) is done. Plan 3 is the pages, built with the `anthropic-skills:apple-design` skill. Plan 4 is the Companion module and going live.

## Global Constraints

- `src/core/**` and `src/auth/**` must not reference `Date`, `Math.random`, `crypto.randomUUID` or any Workers or Node API. Time (`now`) and ids (`newId`) are passed in. The one exception is `src/auth/crypto.ts`, which uses `crypto.subtle` and `crypto.getRandomValues`; both exist in Node 22 and Workers.
- Times are integer ms.
  - Server time is `Date.now()` in the hub only.
  - A finish's elapsed time = `atServerMs − round.startedAt`.
- A tap is rejected if:
  - `atServerMs < startedAt`, or
  - `atServerMs > now + 2000`, or
  - the round phase is not `running`.
- Defaults: penalty `5000` ms, undo window `10000` ms, penalties **off** for a new event.
- Passwords use PBKDF2-SHA256 with **100000** iterations (the Workers maximum) and a 16-byte random salt.
- Tokens are 32 random bytes, base64url-encoded, stored only as SHA-256 hex.
- Cookies:
  - `r2f_session` (12 h) and `r2f_device` (30 days) are `HttpOnly; Secure; SameSite=Strict; Path=/`.
- Login lockout: 5 failures from one IP within 5 minutes return 429 until the oldest failure in that window is more than 5 minutes old.
- **Sized for up to ~1,750 participant phones** on venue cellular, all connected to one hub.
  - Public sockets get a full `publicSnapshot` on connect, on round open/finish, and after a correction to an earlier round.
  - While a round is open or running, they get only a small `publicRoundUpdate` (the current round's races and results), coalesced to **at most one send per 1000 ms**. It must stay **≤ 8 KB** for 26 entrants.
  - Control, referee and companion views are sent immediately.
  - Each message is serialized once per broadcast and the same string is sent to every socket.
- Participant phones never send messages; they rely on WebSocket protocol pings, which Cloudflare doesn't charge for. Only referee, control and projector clients send the app-level clock-sync `ping`. This keeps billed Durable Object requests to roughly one per connection.
- `wrangler.jsonc`:
  - `compatibility_date` is `"2026-11-01"`, which is after `2026-04-07`, so WebSocket close frames are auto-replied.
  - Custom domain `r2f.weiss-audio.com`.
  - Durable Object class `Hub` under `new_sqlite_classes`.
- One hub instance holds everything: `env.HUB.getByName('hub')`.

## Review Focus

1. **A referee tablet reconnects mid-race and resends taps it queued offline,** with the same `clientTapId`. The resend must be accepted as a no-op, with no duplicate tap and no second time. Covered by tests in Task 5.
2. **START pressed twice,** from Companion and race control at the same moment. The second press is rejected with `already_running`, and `startedAt` doesn't change. Covered by tests in Task 4.
3. **A tablet with a badly wrong clock** (a tap stamped before the start, or more than 2 s in the server's future) is rejected with `bad_timestamp`, and nothing is recorded. Covered by tests in Task 5.
4. **The hub is evicted from memory mid-race.** `startedAt`, taps and each socket's role and station come back from SQLite and the socket attachments, and the next tap is accepted. Covered by tests in Task 10.
5. **A revoked referee device or an expired session sends a command.** It is rejected with 401 over HTTP, and the socket is closed with code 4401. Covered by tests in Task 9 and Task 10.

---

## File Structure

```
vitest.config.ts                         root: test.projects = engine, server-core, server-worker
packages/server/
  package.json                           @race2feed/server; deps: @race2feed/engine; dev: wrangler, @cloudflare/vitest-plugin, @cloudflare/workers-types
  wrangler.jsonc                         see Global Constraints
  tsconfig.json                          types: ["@cloudflare/workers-types", "@cloudflare/vitest-plugin/types"]
  vitest.core.config.ts                  node project: test/core/**
  vitest.worker.config.ts                cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' }, miniflare: { bindings: { ADMIN_PASSWORD: 'test-admin' } } }): test/worker/**
  public/index.html                      placeholder page ("Race to Feed"), replaced in plan 3
  src/core/model.ts                      LiveEvent, Tap, Override, Command union, Actor, AuditEntry, error codes
  src/core/csv.ts                        parseTeamsCsv
  src/core/setup.ts                      setup commands
  src/core/results.ts                    buildProgress, teamsInRound
  src/core/lifecycle.ts                  round lifecycle commands
  src/core/taps.ts                       tap, penalty, result and tie commands
  src/core/apply.ts                      applyCommand: permission check + dispatch
  src/core/views.ts                      publicView, refereeView, controlView, companionView, projectorScreen
  src/auth/crypto.ts                     hashPassword, verifyPassword, randomToken, sha256Hex
  src/auth/ratelimit.ts                  loginAllowed
  src/hub.ts                             Hub Durable Object
  src/worker.ts                          fetch router
  test/core/*.test.ts                    Node tests
  test/worker/*.test.ts                  Workers runtime tests
  README.md                              deploy steps
```

---

### Task 1: Server package and Workers test harness

**Files:**
- Create: `vitest.config.ts` (root), `packages/server/{package.json,wrangler.jsonc,tsconfig.json,vitest.core.config.ts,vitest.worker.config.ts,public/index.html}`, `src/worker.ts`, `src/hub.ts` (empty `Hub extends DurableObject`)
- Modify: root `package.json` scripts, adding `"typecheck": "tsc -p packages/engine --noEmit && tsc -p packages/server --noEmit"` and `"dev": "wrangler dev -c packages/server/wrangler.jsonc"`
- Test: `packages/server/test/worker/health.test.ts`

**Interfaces:**
- Produces:
  - `GET /api/health` returns `200 {"ok":true}`.
  - The `Env` interface in `src/worker.ts`: `{ HUB: DurableObjectNamespace<Hub>; ASSETS: Fetcher; ADMIN_PASSWORD: string }`.
- `wrangler.jsonc` contains:
  - `"main": "src/worker.ts"`
  - `"assets": { "directory": "./public", "binding": "ASSETS", "run_worker_first": ["/api/*"] }`
  - the `HUB` binding
  - migration `v1` with `new_sqlite_classes: ["Hub"]`
  - `"routes": [{ "pattern": "r2f.weiss-audio.com", "custom_domain": true }]`

- [ ] **Step 1:** Install the dependencies: `npm i -D -w packages/server wrangler @cloudflare/vitest-plugin @cloudflare/workers-types`, and add `"@race2feed/engine": "*"` to the server's `dependencies`. In the root `vitest.config.ts`, set `test.projects` to `['packages/engine', 'packages/server/vitest.core.config.ts', 'packages/server/vitest.worker.config.ts']`. Before writing the worker config, read <https://developers.cloudflare.com/workers/testing/vitest-integration/write-your-first-test/index.md> for the current import of the integration-test helper (`exports`/`SELF`).
- [ ] **Step 2: Write the failing test.** `health.test.ts` fetches `https://r2f.test/api/health` through the integration-test helper and expects status 200 and body `{ ok: true }`.
- [ ] **Step 3: Run `npm test`.** Expected: the engine's 71 tests pass and the health test FAILs (404 or a missing handler).
- [ ] **Step 4: Implement** the router in `src/worker.ts`. `/api/health` returns JSON; other `/api/*` paths return 404 JSON `{ error: 'not_found' }`.
- [ ] **Step 5: Run `npm test && npm run typecheck`.** Expected: all pass.
- [ ] **Step 6: Commit:** `feat(server): Workers package, wrangler config and test harness`

---

### Task 2: Event model, CSV import and setup commands

**Files:**
- Create: `src/core/model.ts`, `src/core/csv.ts`, `src/core/setup.ts`
- Test: `test/core/csv.test.ts`, `test/core/setup.test.ts`

**Interfaces:**
- Consumes: `EventInput`, `suggestSeedingGroups`, `suggestBracketPlan`, `validateSeedingGroups`, `validateBracketPlan` from `@race2feed/engine`
- Produces, in `model.ts`:

```ts
export type Role = 'admin' | 'control' | 'referee' | 'companion' | 'public';
export interface Actor { role: Role; label: string; deviceId?: string; station?: number }
export type Phase = 'idle' | 'open' | 'running' | 'finished';
export interface Tap {
  id: string; clientTapId?: string; kind: 'finish' | 'penalty'; round: number; teamId: string;
  elapsedMs?: number;            // finish only
  amountMs?: number;             // penalty only
  source: 'referee' | 'control'; deviceId?: string; createdAt: number; removedAt: number | null;
}
export type OverrideSet = { kind: 'status'; status: 'dnf' | 'dns' } | { kind: 'time'; rawMs: number } | { kind: 'clear' };
export interface Override { round: number; teamId: string; at: number; set: OverrideSet }
export interface LiveEvent {
  id: string; name: string; date: string;
  setup: EventInput; setupLocked: boolean;
  settings: { penaltiesEnabled: boolean; penaltyMs: number; undoWindowMs: number };
  bagTotal: string | null;
  round: { current: number; phase: Phase; startedAt: number | null; finishedAt: number | null };
  finishedRounds: number;
  stations: Record<number, { ready: boolean; excluded: boolean }>;
  taps: Tap[]; overrides: Override[];
  tieDecisions: Record<string, string[]>;
  projectorPin: ProjectorScreen | null;
}
export type ProjectorScreen = 'welcome' | 'tables' | 'clock' | 'seeding-results' | 'brackets' | 'standings' | 'champion';
export type Command = /* one variant per command named in Tasks 2, 4, 5 */;
export interface AuditEntry { action: Command['type']; actor: string; detail: unknown }
export type CommandResult =
  | { ok: true; event: LiveEvent; audit: AuditEntry; reply?: unknown }
  | { ok: false; code: string; message: string; detail?: unknown };
export interface Ctx { now: number; actor: Actor; newId: () => string }
export function newEvent(id: string, name: string, date: string, tableCount: number): LiveEvent;
```

- Produces, in `csv.ts`: `parseTeamsCsv(text: string): { rows: { team: string; category: string }[]; errors: string[] }`
  - The header row `team,category` (case-insensitive) is required.
  - Follows RFC 4180: quoted fields, `""` escapes, CRLF or LF line endings.
  - Blank lines are skipped and fields trimmed.
  - Empty fields and duplicate team names are reported in `errors` with their line numbers.
- Produces, in `setup.ts`: one function per command, each `(e: LiveEvent, cmd, ctx: Ctx) => CommandResult`. Commands:
  - `importTeams {csv}`: replaces the teams and categories. Category order is the order of first appearance; the category id is the lowercased name with non-alphanumerics turned into `-`. Team ids come from `ctx.newId()`.
  - `addTeam {name, category}`, `renameTeam {teamId, name}`, `removeTeam {teamId}`
  - `setTableCount {tableCount}`
  - `suggestSetup`: fills `groups`, `tableOf` and `brackets` from the engine suggestions.
  - `setGroups {groups, tableOf}`, `setBrackets {brackets}`, `setGrandChampionship {enabled}`
  - `lockSetup`
  - `unlockSetup`
  - `setSettings {penaltyMs?, undoWindowMs?}`
  - `setBagTotal {text}`
- While `setupLocked` is true, every setup command except `unlockSetup` and `setBagTotal` returns `setup_locked`.
- `lockSetup` returns `setup_invalid` with `detail: string[]` (the errors from both engine validators) when they find problems. It also rejects `tableCount < 1` and an event with no teams.
- `unlockSetup` returns `rounds_started` once `round.current > 0`.

- [ ] **Step 1: Write the failing tests**
  - `csv.test.ts`:
    - `'team,category\n"Anders, Brooks, & Cole",Corporate\nNCYC,Community\n'` gives 2 rows, the first with team `Anders, Brooks, & Cole`.
    - A missing header gives an error.
    - A row with an empty category gives an error mentioning `line 2`.
    - A duplicate team gives an error.
  - `setup.test.ts`:
    - `importTeams`: categories in order of first appearance, ids `high-school`, `corporate`.
    - `suggestSetup` on 14/16/20 teams with 26 tables gives 2 groups and 12 brackets.
    - `lockSetup` with a team in no group returns `setup_invalid`, and its detail mentions that team's name.
    - A setup command after a successful `lockSetup` returns `setup_locked`.
    - `unlockSetup` after `round.current = 1` returns `rounds_started`.
- [ ] **Step 2: Run `npx vitest run --project server-core`.** Expected: FAIL (modules missing).
- [ ] **Step 3: Implement** `model.ts`, `csv.ts` and `setup.ts`.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit:** `feat(server): event model, CSV import and setup commands`

---

### Task 3: Results from taps and overrides

**Files:**
- Create: `src/core/results.ts`
- Test: `test/core/results.test.ts`

**Interfaces:**
- Consumes: `LiveEvent`, `Tap`, `Override`; `EventProgress`, `EntryResult`, `deriveEvent`, `DerivedEvent` from the engine
- Produces:
  - `buildProgress(e: LiveEvent): EventProgress`
    - `finishedRounds` and `tieDecisions` are copied over.
    - For each `(round, team)`, the team's facts (its active finish tap, then its overrides) are taken in time order (`createdAt` / `at`), and the last fact decides:

      | Last fact | Result |
      |---|---|
      | finish tap | `finished`, rawMs = elapsedMs |
      | `time` override | `finished`, rawMs = the override value |
      | `status` override | `dnf` or `dns` |
      | `clear` | no entry (pending) |

    - `penaltiesMs` is the sum of active penalty taps (`removedAt === null`) for that round and team.
    - A finished entry always has a non-null `rawMs`. This guards against the reviewer's minor finding about finished entries with a null time.
  - `derive(e: LiveEvent): DerivedEvent` returns `deriveEvent(e.setup, buildProgress(e))`.
  - `teamsInRound(e: LiveEvent, d: DerivedEvent, round: number): { teamId: string; table: number }[]`

- [ ] **Step 1: Write the failing tests.**
  - A finish tap at 200000 plus two active penalties of 5000 gives `{status: 'finished', rawMs: 200000, penaltiesMs: 10000}`.
  - A removed penalty is not counted.
  - A `dnf` override after a finish tap gives `dnf`.
  - A `time` override after a `dnf` gives finished with that time.
  - A `clear` gives no entry.
  - A removed finish tap gives no entry.
- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement `results.ts`.**
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit:** `feat(server): derive results from taps and overrides`

---

### Task 4: Round lifecycle: open, ready, start and finish gates, ties

**Files:**
- Create: `src/core/lifecycle.ts`
- Test: `test/core/lifecycle.test.ts`

**Interfaces:**
- Consumes: `derive`, `teamsInRound`; `stationCount`, `stationOfTable` from the engine
- Produces command handlers:
  - `openNextRound`
    - Requires `setupLocked` (else `setup_not_locked`) and phase `idle` or `finished` (else `round_in_progress`).
    - The next round must exist (else `event_complete`) and be `ready` in `derive` (else `blocked`, with the blockers in `detail`).
    - Sets `round = { current + 1, 'open', null, null }`.
    - Resets `stations`: for 1..`stationCount(tableCount)`, `excluded` = no team on its tables this round, `ready` = false.
  - `stationReady` (referee): sets `stations[actor.station].ready = true`. Requires phase `open` (else `round_not_open`).
  - `overrideStation {station, state: 'ready' | 'notReady' | 'excluded'}` (control).
  - `startRace`
    - Phase `running` returns `already_running`. Any other phase except `open` returns `round_not_open`.
    - Every non-excluded station must be ready (else `stations_not_ready`, with the station numbers in `detail`).
    - Sets phase `running` and `startedAt = now`.
  - `finishRace`
    - Requires phase `running`.
    - Every team in the round must have a result of `finished`, `dnf` or `dns` (else `teams_outstanding`, with `detail: { teamId, table }[]`).
    - Sets phase `finished`, `finishedAt = now` and `finishedRounds = current`.
  - `decideTie {raceId, order}`: `order` must be a permutation of one current tie group of that race in `derive` (else `not_a_tie`). Sets `tieDecisions[raceId] = order`.
  - `pinProjector {screen | null}`

- [ ] **Step 1: Write the failing tests.** Use a fixture: 4 teams in one category, 4 tables, setup locked.
  - `openNextRound` before `lockSetup` returns `setup_not_locked`.
  - After opening round 1, stations 1–2 are active and not ready.
  - `startRace` with station 2 not ready returns `stations_not_ready` with `detail [2]`. After `overrideStation {2, 'ready'}` it succeeds with `startedAt = now`.
  - **START twice** (Review Focus 2): the second `startRace` returns `already_running`, and `startedAt` is unchanged.
  - `finishRace` with one team untimed returns `teams_outstanding` listing that team.
  - Once every team has a result, `finishRace` gives phase `finished` and `finishedRounds = 1`.
  - `openNextRound` while `running` returns `round_in_progress`.
  - With a tie in a finished heats round, `openNextRound` returns `blocked`. After `decideTie`, it succeeds.
  - Opening past the last round returns `event_complete`.
- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement `lifecycle.ts`.**
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit:** `feat(server): round lifecycle with start/finish gates and tie decisions`

---

### Task 5: Taps, penalties, corrections and the permission dispatcher

**Files:**
- Create: `src/core/taps.ts`, `src/core/apply.ts`
- Test: `test/core/taps.test.ts`, `test/core/apply.test.ts`

**Interfaces:**
- Produces, in `taps.ts`:
  - `tapFinish {teamId, atServerMs, clientTapId}` (referee)
    - Rejected if:
      - the phase isn't `running` → `round_not_running`
      - the team isn't on the actor's station tables this round → `not_your_team`
      - the timestamp is bad (Global Constraints) → `bad_timestamp`
      - the team already has an active finish tap → `already_finished`
    - A tap whose `clientTapId` already exists from the same device returns `ok` with the event unchanged.
  - `tapPenalty {teamId, clientTapId}` (referee): has the same checks except the timestamp, plus `penalties_disabled`. Records `amountMs = settings.penaltyMs`.
  - `undoTap {tapId}` (referee)
    - The tap must belong to the actor's device (else `not_your_tap`).
    - `now − createdAt` must be ≤ `undoWindowMs` (else `undo_expired`).
    - The phase must be `running` (else `round_not_running`).
    - Sets `removedAt = now`.
  - `setResult {round, teamId, set: OverrideSet, confirmUnlock?}` (control)
  - `addPenalty {round, teamId, confirmUnlock?}` (control)
  - `removePenalty {tapId, confirmUnlock?}` (control)
  - **Late corrections:** when `round < current` and any later round has a tap or override, these three commands return `unlock_required` with `detail: { laterRounds: number[] }` unless `confirmUnlock` is true.
  - `setPenaltiesEnabled {enabled}` (control): never removes existing penalties.
- Produces, in `apply.ts`: `applyCommand(e: LiveEvent, cmd: Command, ctx: Ctx): CommandResult`.
  - Checks `PERMISSIONS[cmd.type]` (the roles allowed; admin is allowed everything control is) and returns `forbidden` otherwise.
  - Dispatches to the handler and fills `audit` with `{action: cmd.type, actor: ctx.actor.label, detail: cmd}`.

  | Role | Allowed commands |
  |---|---|
  | referee | `stationReady`, `tapFinish`, `tapPenalty`, `undoTap` |
  | companion | `startRace`, `finishRace`, `pinProjector` |
  | control | lifecycle, results, penalties, ties, projector |
  | admin | everything control can, plus all setup commands |

- [ ] **Step 1: Write the failing tests** (round 1 running, `startedAt = 1_000_000`, a referee on station 1):
  - `tapFinish` at `atServerMs 1_200_000` gives elapsed 200000. A second tap for the same team returns `already_finished`.
  - **Resend** (Review Focus 1): the same `clientTapId` again returns `ok`, and `taps.length` is unchanged.
  - **Bad clock** (Review Focus 3): `atServerMs 999_000` returns `bad_timestamp`, and so does `now + 2001`. No tap is recorded either way.
  - A team on station 2 returns `not_your_team`.
  - `tapPenalty` while penalties are off returns `penalties_disabled`. When on, it records amount 5000.
  - `undoTap` within 10 s sets `removedAt`. At 10001 ms it returns `undo_expired`. From another device it returns `not_your_tap`.
  - `setResult` on round 1 while in round 3, with round 2 results, returns `unlock_required` with `laterRounds [2]`. With `confirmUnlock` it succeeds.
  - `apply.test.ts`: a referee sending `startRace` returns `forbidden`. Companion `startRace` is allowed. A setup command by control returns `forbidden`.
- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement `taps.ts` and `apply.ts`.**
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit:** `feat(server): referee taps, penalties, corrections and permissions`

---

### Task 6: Role views and projector screen

**Files:**
- Create: `src/core/views.ts`
- Test: `test/core/views.test.ts`

**Interfaces:**
- Produces:
  - `projectorScreen(e, d): ProjectorScreen`: `projectorPin` if set; otherwise:

    | Phase | Screen |
    |---|---|
    | `idle` | `welcome` |
    | `open` | `tables` |
    | `running` | `clock` |
    | `finished`, seeding round | `seeding-results` |
    | `finished`, heats or placement round | `brackets` |
    | `finished`, grand round | `champion` |

  - `publicView(e, d)`:
    - event `{id, name, date}`
    - `categories`, `teams {id, name, categoryId}`
    - `round {current, phase, startedAt, finishedAt}`
    - `rounds`: every derived round `{round, kind, status, races: {id, label, bracketId?, entrants: {teamId, table, status, rawMs, penaltiesMs, officialMs, place}[]}[]}`. `place` is the 1-based index in `ranking.order`, or null if no results are in yet.
    - `seedRank`, `seedTotalsMs` (teamId → total official ms of finished runs), `standings`, `grandChampion`, `bagTotal`, `projector: projectorScreen(...)`
    - It contains no taps, devices, overrides or audit data.
  - `publicRoundUpdate(e, d)`: `{ round: {current, phase, startedAt, finishedAt}, races }`. `races` is the current round's races in the same shape as `publicView.rounds[].races`.
  - `refereeView(e, d, station)`: `round`, `settings {penaltiesEnabled, penaltyMs, undoWindowMs}`, `station {number, tables, ready, excluded}`, and `teams: {teamId, name, table, result, taps: {id, kind, createdAt, removedAt}[]}[]` for the station's tables this round.
  - `controlView(e, d, extras: { devices: unknown[]; audit: unknown[] })`: everything in `publicView`, plus:
    - `stations`, `settings`, `setupLocked`, `setup`
    - `taps` for the current round
    - `outstanding: {teamId, table}[]`, `ties: {raceId, teams}[]`, `blockers`
    - `devices`, `audit`
  - `companionView(e, d)`: `{ state: phase, round: current, startedAt, readyCount, stationCount (non-excluded), outstanding: number, penaltiesEnabled, projector }`.

- [ ] **Step 1: Write the failing tests.**
  - `projectorScreen` returns each value in the table above, and a pin overrides it.
  - `publicView` JSON contains no `"taps"`, `"deviceId"` or `"overrides"` keys at any depth.
  - With the previous event's 26 teams in a running bracket round, `JSON.stringify(publicRoundUpdate(...)).length` is at most 8192.
  - `refereeView` for station 1 lists only the teams on tables 1–2.
  - `companionView` after 1 of 2 stations is ready gives `readyCount 1, stationCount 2`.
  - `controlView.outstanding` lists the untimed teams.
- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement `views.ts`.**
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit:** `feat(server): role views and automatic projector screen`

---

### Task 7: Core acceptance: run the previous event through commands

**Files:**
- Test: `test/core/event-run.test.ts`. It reads `packages/engine/test/fixtures/previous-event.json`.

**Interfaces:**
- Consumes: `applyCommand`, `newEvent`, `derive`

- [ ] **Step 1: Write the test.**
  - Set up through commands only:
    1. `newEvent` with 26 tables.
    2. `importTeams` with a CSV built from the fixture. Use quotes for names containing commas.
    3. `setGroups` from the fixture's group and table.
    4. `suggestSetup`'s brackets via `setBrackets` (or `suggestSetup` followed by `setGroups`).
    5. `setGrandChampionship true`, then `lockSetup`.
  - Then for each round 1..9, with `now` advancing:
    1. `openNextRound`
    2. `overrideStation` ready for every non-excluded station
    3. `startRace`
    4. For every team in the round, a referee actor for its station sends `tapFinish` with `atServerMs = startedAt + time`. Time is the fixture's run time for seeding rounds, and `200_000 + place * 5_000` for rounds 5–9.
    5. `finishRace`
  - Every command must return `ok`.
  - Assert:
    - `derive(e).grandChampion` maps to `Riverbend Middle School`.
    - The standings map to `fixture.expectedStandings`.
    - Running `openNextRound` once more returns `event_complete`.
- [ ] **Step 2: Run `npx vitest run --project server-core test/core/event-run.test.ts`.** Expected: PASS. Any failure is a bug in Tasks 2–5; fix it there.
- [ ] **Step 3: Commit:** `test(server): full previous event driven through commands`

---

### Task 8: Auth primitives

**Files:**
- Create: `src/auth/crypto.ts`, `src/auth/ratelimit.ts`
- Test: `test/core/auth.test.ts` (Node project)

**Interfaces:**
- Produces:
  - `hashPassword(password: string, salt?: Uint8Array): Promise<{ hash: string; salt: string; iterations: number }>` (hex strings, iterations 100000)
  - `verifyPassword(password: string, stored: { hash: string; salt: string; iterations: number }): Promise<boolean>`, using a constant-time comparison
  - `randomToken(): string` (32 bytes, base64url)
  - `sha256Hex(text: string): Promise<string>`
  - `loginAllowed(failureTimes: number[], now: number): boolean`. It returns false when 5 or more failure times fall in `(now − 300000, now]`.

- [ ] **Step 1: Write the failing tests.**
  - Hash then verify a password: the right password gives true and the wrong one false.
  - Two hashes of the same password give different salts.
  - `randomToken()` has length 43 and two calls differ.
  - `sha256Hex('abc')` is `ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad`.
  - `loginAllowed`: 4 recent failures give true, 5 give false, and 5 failures older than 5 min give true.
- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit:** `feat(server): password hashing, tokens and login rate limit`

---

### Task 9: Hub storage, authentication and HTTP API

**Files:**
- Modify: `src/hub.ts`, `src/worker.ts`
- Test: `test/worker/api.test.ts`

**Interfaces:**
- Hub SQLite schema, created in the constructor inside `blockConcurrencyWhile`:
  - `events(id TEXT PRIMARY KEY, name TEXT, created_at INTEGER, active INTEGER, doc TEXT)`
  - `audit(id INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT, at INTEGER, actor TEXT, action TEXT, detail TEXT)`
  - `credentials(role TEXT PRIMARY KEY, hash TEXT, salt TEXT, iterations INTEGER)`
  - `sessions(token_hash TEXT PRIMARY KEY, role TEXT, expires_at INTEGER)`
  - `devices(id TEXT PRIMARY KEY, event_id TEXT, station INTEGER, token_hash TEXT, label TEXT, created_at INTEGER, revoked_at INTEGER, last_seen INTEGER)`
  - `pairing_codes(code TEXT PRIMARY KEY, event_id TEXT, station INTEGER, expires_at INTEGER)`
  - `api_keys(id TEXT PRIMARY KEY, key_hash TEXT, label TEXT, created_at INTEGER, revoked_at INTEGER)`
  - `login_failures(ip TEXT, at INTEGER)`
- Hub RPC methods:
  - `login(role: 'admin' | 'control', password: string, ip: string): Promise<{ ok: true; token: string } | { ok: false; status: 401 | 429 }>`
    - Admin falls back to `env.ADMIN_PASSWORD` until an admin hash is stored.
    - Control fails until race control's password has been set.
  - `logout(token)`
  - `authenticate(cred: { session?: string; device?: string; apiKey?: string }): Promise<Actor | null>`
  - `pair(code: string): Promise<{ ok: true; deviceToken: string; station: number } | { ok: false }>`. Codes are single-use and expire after 10 minutes.
  - `command(actor: Actor, cmd: Command | HubCommand): Promise<CommandResult>`
    - Hub commands (admin only unless marked):
      - `createEvent {name, date, tableCount}`, `activateEvent {eventId}`
      - `setPassword {role, password}`
      - `createApiKey {label}` (`reply.key` is shown once), `revokeApiKey {id}`
      - `createPairingCode {station}` (control or admin; `reply {code, expiresAt}`), `revokeDevice {deviceId}` (control or admin)
    - Event commands go to `applyCommand` on the active event, with `now = Date.now()` and `newId = crypto.randomUUID`.
    - On `ok`, the hub writes `UPDATE events SET doc` and `INSERT INTO audit` inside one `ctx.storage.transactionSync`, **then** updates its in-memory cache and broadcasts (broadcasting is Task 10; a no-op hook for now).
  - `exportEvent(eventId, format: 'json' | 'csv'): Promise<string>`
    - JSON is the doc plus the audit.
    - CSV is one row per team per round: `round,team,category,table,status,raw_ms,penalties_ms,official_ms,place`.
- Worker routes (JSON bodies):

  | Route | Behaviour |
  |---|---|
  | `POST /api/login {role, password}` | Sets `r2f_session` |
  | `POST /api/logout` | Ends the session |
  | `POST /api/pair {code}` | Sets `r2f_device`; returns `{station}` |
  | `POST /api/command {cmd}` | Auth from the `r2f_session` or `r2f_device` cookie, or `Authorization: Bearer <apiKey>`; 401 without valid credentials; 400 with the result when `ok: false`; 200 with the result otherwise |
  | `GET /api/export?event=&format=` | Admin only |

  The client IP comes from `CF-Connecting-IP`, or `'local'` when absent.

- [ ] **Step 1: Write the failing tests** (Workers project). Use separate hub names or reset per test, according to the isolation docs.
  - Login as admin with `test-admin` gives 200 and a `Set-Cookie` containing `r2f_session=` and `HttpOnly`. A wrong password gives 401. Six wrong attempts in a row give 429 on the sixth.
  - Admin `createEvent` then `importTeams` gives 200. The same commands without a cookie give 401.
  - The doc survives a fresh stub (`env.HUB.getByName('hub')` again) and an `audit` row exists for `importTeams`. Inspect it with `runInDurableObject`.
  - Pairing:
    - control `createPairingCode {station: 1}`, then `/api/pair` with that code gives `r2f_device`.
    - Using the same code a second time fails.
    - A referee `stationReady` with the device cookie is accepted (in an open round).
    - **Revoked** (Review Focus 5): after `revokeDevice`, the same cookie gives 401.
  - An API key from `createApiKey` authorizes a companion `startRace` (gate errors are fine; it must not be 401).
- [ ] **Step 2: Run `npx vitest run --project server-worker`.** Expected: FAIL.
- [ ] **Step 3: Implement** the hub and the routes.
- [ ] **Step 4: Run `npm test && npm run typecheck`.** Expected: all pass.
- [ ] **Step 5: Commit:** `feat(server): hub storage, authentication, pairing and command API`

---

### Task 10: WebSockets: live views, clock sync, commands and hibernation

**Files:**
- Modify: `src/hub.ts`, `src/worker.ts`
- Test: `test/worker/ws.test.ts`

**Interfaces:**
- `GET /api/ws` with `Upgrade: websocket` is forwarded by the Worker to `hub.fetch(request)`.
  - The hub authenticates from cookies or a Bearer token. With no credentials the role is `public`.
  - `ctx.acceptWebSocket(server, [tag])` with tag `public`, `control`, `companion` or `referee:<station>`.
  - `server.serializeAttachment({ role, label, deviceId?, station? })`
- Messages (JSON):

  | From client | Reply |
  |---|---|
  | `{type:'ping', t0}` | `{type:'pong', t0, t1: Date.now()}` |
  | `{type:'cmd', id, cmd}` | `{type:'ack', id, ok, code?, message?, reply?}`, using the same `command()` path as HTTP and the actor from the attachment |

  The server pushes views after every successful command:
  - `{type:'view', view}` to control (`controlView`) and companion (`companionView`) sockets immediately.
  - `{type:'view', view}` to referees immediately, with their own station's `refereeView`.
  - Public sockets:
    - `{type:'snapshot', view: publicView}` on connect.
    - The same snapshot to all public sockets after `openNextRound`, `finishRace`, `decideTie`, any setup command, and any correction with `round < current`.
    - Otherwise `{type:'round', update: publicRoundUpdate}`, coalesced to at most one send per 1000 ms, with a DO alarm for the trailing send.
  - Each message is serialized once per broadcast and the same string is sent to every socket with that tag.
- Before handling a message, the hub re-checks the device or session (for revocation and expiry). If the check fails it closes the socket with code `4401`.
- Hibernation: the constructor restores nothing beyond the SQLite cache load. Socket roles come from `deserializeAttachment()`.

- [ ] **Step 1: Write the failing tests.**
  - A public socket receives a `snapshot` on connect, with `round.phase 'idle'`.
  - Five referee taps sent within 200 ms produce at most one `round` message on a public socket within that second, and a trailing one carrying all five results after the alarm fires. Trigger it with the alarm test helper rather than waiting.
  - `ping` returns `pong` with a numeric `t1`.
  - A control socket sends `cmd openNextRound`, gets an `ack ok`, the control socket receives a new `view`, and the public socket receives a new `snapshot`.
  - A referee socket `tapFinish` while not running gets `ack ok:false code round_not_running`.
  - **Eviction** (Review Focus 4):
    1. Open, ready and start a round over the control socket.
    2. Call `evictDurableObject(stub)` (hibernating WebSockets are the default).
    3. The referee socket's `tapFinish` still gets `ack ok`.
    4. The next view shows the same `startedAt`.
  - **Revoked mid-connection** (Review Focus 5): revoke the device, and its next message closes the socket with code 4401.
- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npm test && npm run typecheck`.** Expected: all pass.
- [ ] **Step 5: Commit:** `feat(server): live WebSocket views, clock sync and commands`

---

### Task 11: Deploy configuration and README

**Files:**
- Create: `packages/server/README.md`
- Modify: root `package.json`, adding `"deploy": "wrangler deploy -c packages/server/wrangler.jsonc"`
- Modify: `docs/design.md` §11, only if a step below turns out to differ

- [ ] **Step 1:** Run `npx wrangler deploy --dry-run -c packages/server/wrangler.jsonc --outdir /tmp/r2f-build`. Expected: a successful build listing the `HUB` Durable Object and the `ASSETS` binding. No deploy happens, and no Cloudflare credentials are needed.
- [ ] **Step 2: Write `README.md`** with the exact steps for the user:
  1. `npx wrangler login`
  2. `npx wrangler secret put ADMIN_PASSWORD -c packages/server/wrangler.jsonc`
  3. `npm run deploy`. The custom domain `r2f.weiss-audio.com` is created from `routes`, since weiss-audio.com's DNS is already on Cloudflare.
  4. Sign in at `/api/login`. The real admin page comes in plan 3.
  - Note the Workers Paid recommendation for the event month.
- [ ] **Step 3: Run `npm test && npm run typecheck`.** Expected: all pass.
- [ ] **Step 4: Commit:** `docs(server): deploy steps and dry-run build`
