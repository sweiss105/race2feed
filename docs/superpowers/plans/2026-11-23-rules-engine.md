# Rules Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pure TypeScript package (`@race2feed/engine`) that turns an event's setup and recorded results into every round's matchups and table numbers, the seeding ranks, the race rankings, the final standings and the Grand Champion. It is verified against the previous event's spreadsheet.

**Architecture:** The engine has no I/O, clock, storage or network code. It consists of plain functions. The top-level function, `deriveEvent(input, progress)`, recomputes the whole event from stored facts. Later plans (live server, pages, Companion module) call it after every change. The engine runs unchanged in Node or on Cloudflare Workers.

**Tech Stack:** Node 22, TypeScript (strict, ESM), Vitest, npm workspaces.

**Spec:** `docs/design.md`. The sections that matter are §3 (event model, bracket formats, ranking rules), §5.1 (penalties → official time) and §13 (acceptance).

**Build series:** this is plan 1 of 4.
1. Rules engine (this plan)
2. Live server: round lifecycle, timing, auth, storage, WebSocket hub
3. Pages: admin, race control, referee, participant, projector. Uses the `anthropic-skills:apple-design` skill for all UX.
4. Companion module and deployment

## Global Constraints

- The engine package has **zero runtime dependencies**. It doesn't import `node:*` modules, read the clock, use randomness or do I/O.
- All times are **integer milliseconds** (`Ms`).
  - Official time = `rawMs + penaltiesMs`.
  - Race ties are compared at **hundredths**: `Math.floor(ms / 10)`.
- Ranking within a race: finishers by official time, then DNF, then DNS, then pending. Teams in the same non-finished status, and finishers tied at hundredths without a decision, are ordered by the race's `fallbackOrder`. Unresolved finisher ties are reported, never silently decided.
- Seeding rank keys, in order:
  1. count of finished runs (descending)
  2. total official time of finished runs
  3. best single official run
  4. `team.order`
- Default tier names, in order: `Gold, Silver, Bronze, Copper, Tin`, then `Tier 6`, `Tier 7`, ….
- Tier index 0–1 is the **upper** set; tier index ≥ 2 is the **lower** set.
- Bracket formats follow design §3.4 exactly:
  - Heats pair seeds outside-in.
  - If the bracket size is odd, the middle seed joins the **last** pair. Example: seeds 9–13 give heats `[9,13]` and `[10,12,11]`.
  - Brackets of 1–3 teams race once.
- Round order:
  1. seeding: for each run 1..2, then for each group
  2. lower heats chunks
  3. upper heats chunks
  4. lower placement chunks
  5. upper placement chunks
  6. Grand Championship, only if enabled and there are 2 or more categories
- Commit after every task with a `feat(engine): …` or `test(engine): …` message.

## Review Focus

1. **Both teams in a heat fail to finish** (DNF/DNS). The better seed should win. This is not a tie and doesn't block the round. Covered by the test in Task 2.
2. **Times within the same hundredth** (e.g. 192401 vs 192409 ms), or a penalty that makes two times equal, are a tie needing a decision. Covered by tests in Task 2.
3. **A category with only 1–3 teams** gets one bracket that races once, has no placement race, still gets standings, and its winner still enters the Grand Championship. Covered by the test in Task 9.
4. **Team count at table capacity versus one over it** (26 vs 27 teams on 26 tables): 1 vs 2 groups. No group may ever exceed the table count, including with odd-sized categories. Covered by the test in Task 5.
5. **An unresolved tie in a finished round** blocks every later round until a tie decision is supplied. Covered by the test in Task 9.

---

## File Structure

```
package.json                      workspace root (private), scripts: test, typecheck
tsconfig.base.json                shared strict TS config
packages/engine/
  package.json                    @race2feed/engine, "type": "module", "exports": "./src/index.ts"
  tsconfig.json                   extends base, include src + test
  src/index.ts                    re-exports public API
  src/types.ts                    shared types (no logic)
  src/time.ts                     clock-text parsing/formatting, hundredths
  src/stations.ts                 table ↔ referee-station mapping
  src/race.ts                     officialMs, rankRace
  src/seeding.ts                  rankSeeding
  src/groups.ts                   suggestSeedingGroups, validateSeedingGroups
  src/brackets.ts                 suggestBracketPlan, validateBracketPlan, bracketSet, buildHeats, buildPlacement
  src/schedule.ts                 buildRoundPlan
  src/layout.ts                   layoutTables
  src/event.ts                    deriveEvent
  test/*.test.ts                  one test file per src module
  test/fixtures/previous-event.json   ALREADY COMMITTED: data from the previous event's sheet
```

---

### Task 1: Workspace scaffold, time and stations

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `.gitignore` (`node_modules/`), `packages/engine/package.json`, `packages/engine/tsconfig.json`
- Create: `packages/engine/src/types.ts`, `src/time.ts`, `src/stations.ts`, `src/index.ts`
- Test: `packages/engine/test/time.test.ts`, `test/stations.test.ts`

**Interfaces:**
- Produces, in `types.ts`, which every later task uses:

```ts
export type Ms = number;
export interface Category { id: string; name: string }            // array order = display/layout order
export interface Team { id: string; name: string; categoryId: string; order: number }
export type EntryStatus = 'pending' | 'finished' | 'dnf' | 'dns';
export interface EntryResult { status: EntryStatus; rawMs: Ms | null; penaltiesMs: Ms }
export interface SeedingGroup { id: string; teamIds: string[] }    // ids 'A','B','C',…
export interface BracketSpec { id: string; categoryId: string; tierIndex: number; tierName: string; firstSeed: number; size: number }
export interface EventInput {
  tableCount: number;
  categories: Category[];
  teams: Team[];
  groups: SeedingGroup[];
  tableOf: Record<string, number>;      // teamId → seeding table
  brackets: BracketSpec[];
  grandChampionship: boolean;
}
export interface EventProgress {
  finishedRounds: number;                                   // rounds 1..n are locked
  results: Record<number, Record<string, EntryResult>>;     // round → teamId → result
  tieDecisions: Record<string, string[]>;                   // raceId → team order for its tied teams
}
```

- Produces, in `time.ts`:
  - `parseClockTime(text: string): Ms`. Accepts `m:ss` and `m:ss.hh` (minutes may exceed 59) and throws `Error('Invalid time: <text>')` otherwise.
  - `formatMs(ms: Ms, precision: 'seconds' | 'hundredths'): string`. Truncates; it does not round.
  - `hundredths(ms: Ms): number`
- Produces, in `stations.ts`:
  - `stationOfTable(table: number): number` returns `ceil(table/2)`.
  - `tablesOfStation(station: number, tableCount: number): number[]`
  - `stationCount(tableCount: number): number`

- [ ] **Step 1: Scaffold the workspace**
  - Root `package.json`: `{"private": true, "type": "module", "workspaces": ["packages/*"], "scripts": {"test": "vitest run", "typecheck": "tsc -p packages/engine --noEmit"}}`.
  - Run `npm i -D typescript vitest`.
  - `tsconfig.base.json`: `strict`, `noUncheckedIndexedAccess`, `target ES2022`, `module ESNext`, `moduleResolution Bundler`, `noEmit`.

- [ ] **Step 2: Write the failing tests**

```ts
// time.test.ts
expect(parseClockTime('4:05')).toBe(245_000);
expect(parseClockTime('3:41.20')).toBe(221_200);
expect(parseClockTime('11:08')).toBe(668_000);
expect(() => parseClockTime('4.05')).toThrow('Invalid time: 4.05');
expect(() => parseClockTime('4:5')).toThrow();
expect(formatMs(221_209, 'hundredths')).toBe('3:41.20');
expect(formatMs(345_000, 'seconds')).toBe('5:45');
expect(hundredths(192_409)).toBe(19_240);
// stations.test.ts
expect(stationOfTable(1)).toBe(1); expect(stationOfTable(4)).toBe(2);
expect(tablesOfStation(13, 26)).toEqual([25, 26]);
expect(tablesOfStation(13, 25)).toEqual([25]);
expect(stationCount(25)).toBe(13);
```

- [ ] **Step 3: Run `npx vitest run packages/engine/test/time.test.ts packages/engine/test/stations.test.ts`.** Expected: FAIL (modules not found).
- [ ] **Step 4: Implement `time.ts`, `stations.ts` and `types.ts`,** and re-export everything from `index.ts`.
- [ ] **Step 5: Run `npm test && npm run typecheck`.** Expected: PASS with no type errors.
- [ ] **Step 6: Commit:** `feat(engine): scaffold workspace, time and station helpers`

---

### Task 2: Race ranking

**Files:**
- Create: `packages/engine/src/race.ts`
- Test: `packages/engine/test/race.test.ts`

**Interfaces:**
- Consumes: `EntryResult`, `hundredths`
- Produces:
  - `officialMs(r: EntryResult): Ms | null`. Returns `rawMs + penaltiesMs` when finished, and `null` otherwise.
  - `rankRace(entries: { teamId: string; result: EntryResult | undefined }[], opts: { fallbackOrder: string[]; tieOrder?: string[] }): RaceRanking`
  - `export interface RaceRanking { order: string[]; ties: string[][] }`
    - `order` holds every team, best first.
    - `ties` lists the groups of finishers that share a hundredth and are not fully covered by `tieOrder`.
    - An `undefined` result counts as `pending`.

- [ ] **Step 1: Write the failing tests.** `fin(ms, pen = 0)` builds a finished result.
  - `orders finishers, then dnf, then dns, then pending`: `[b: fin(200000), a: dnf, c: fin(190000), d: dns, e: undefined]` gives order `[c, b, a, d, e]` and `ties: []`.
  - `penalty changes the order`: `a: fin(190000, 5000)` and `b: fin(194000)` give `[b, a]`.
  - `same hundredth is a tie`: `a: fin(192401)` and `b: fin(192409)`, with fallback `[b, a]`, give `ties: [['b', 'a']]` and order `[b, a]`.
  - `penalty creating equality is a tie`: `a: fin(190000, 5000)` and `b: fin(195000)` give `ties.length === 1`.
  - `tieOrder resolves the tie`: the same input with `tieOrder: ['a', 'b']` gives order `[a, b]` and `ties: []`.
  - `two non-finishers break by fallback, no tie` (Review Focus 1): `a: dnf`, `b: dnf`, fallback `[b, a]` give order `[b, a]` and `ties: []`.
- [ ] **Step 2: Run `npx vitest run packages/engine/test/race.test.ts`.** Expected: FAIL.
- [ ] **Step 3: Implement `rankRace`.** Sort with a single comparator:
  1. status rank (finished 0, dnf 1, dns 2, pending 3)
  2. then `hundredths(officialMs)` for finishers
  3. then the `tieOrder` index, if both teams are in it
  4. then the `fallbackOrder` index
  
  Then scan adjacent finishers with an equal hundredth to build the `ties` groups, leaving out any group whose members all appear in `tieOrder`.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit:** `feat(engine): race ranking with penalties, DNF/DNS and tie detection`

---

### Task 3: Seeding rank

**Files:**
- Create: `packages/engine/src/seeding.ts`
- Test: `packages/engine/test/seeding.test.ts`

**Interfaces:**
- Consumes: `Team`, `EntryResult`, `officialMs`
- Produces: `rankSeeding(teams: Team[], run1: Record<string, EntryResult | undefined>, run2: Record<string, EntryResult | undefined>): Record<string, number>`. Maps teamId to its 1-based rank within its category.

- [ ] **Step 1: Write the failing tests** (all teams in one category unless noted):
  - `lower total wins`: totals 477 s and 452 s give the 452 s team rank 1.
  - `equal total → better single run`: 240 + 200 vs 220 + 220 gives the 240/200 team rank 1.
  - `equal total and best → team.order`: two identical teams rank by `order`.
  - `two finished runs beat one`: a team with a DNS in run 2 and a 100 s run 1 ranks below a team with 300 + 300.
  - `ranks are per category`: two categories each get a rank 1.
- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement** with the four sort keys from Global Constraints, grouped by `categoryId`.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit:** `feat(engine): seeding rank within category`

---

### Task 4: Bracket plan and formats

**Files:**
- Create: `packages/engine/src/brackets.ts`
- Test: `packages/engine/test/brackets.test.ts`

**Interfaces:**
- Consumes: `Category`, `Team`, `BracketSpec`, `EventInput`
- Produces:
  - `DEFAULT_TIERS = ['Gold','Silver','Bronze','Copper','Tin']`
  - `suggestBracketPlan(categories: Category[], teams: Team[], tierNames?: string[]): BracketSpec[]`. Each bracket's `id` is `${categoryId}:${tierIndex}`, and the output is in category order, then tier order.
  - `validateBracketPlan(input: EventInput): string[]`. Returns error messages, or an empty array when valid.
  - `bracketSet(b: BracketSpec): 'upper' | 'lower'`
  - `buildHeats<T>(seeded: T[]): T[][]`
  - `buildPlacement<T>(rankedHeats: T[][]): { winners: T[]; others: T[] }`

- [ ] **Step 1: Write the failing tests**
  - `suggestBracketPlan` sizes per category count:

    | Teams | Sizes |
    |---|---|
    | 14 | `[4, 4, 6]` with tiers Gold, Silver, Bronze and firstSeed `1, 5, 9` |
    | 16 | `[4, 4, 4, 4]` |
    | 20 | `[4, 4, 4, 4, 4]`, the last tier named `Tin` |
    | 9 | `[4, 5]` |
    | 7 | `[7]` |
    | 3 | `[3]` |
    | 24 | six brackets, the sixth named `Tier 6` |

  - `buildHeats`:
    - `[1,2,3,4]` gives `[[1,4],[2,3]]`.
    - `[9..14]` gives `[[9,14],[10,13],[11,12]]`.
    - `[9..13]` gives `[[9,13],[10,12,11]]`.
    - `[1..7]` gives `[[1,7],[2,6],[3,5,4]]`.
    - `[1,2,3]` gives `[[1,2,3]]`.
  - `buildPlacement([[4,1],[2,3]])` gives `{ winners: [4,2], others: [1,3] }`.
  - `buildPlacement([[9,13],[11,10,12]])` gives `{ winners: [9,11], others: [13,10,12] }`.
  - `bracketSet`: tierIndex 0 and 1 are `'upper'`; tierIndex 2 is `'lower'`.
  - `validateBracketPlan` returns a non-empty array when:
    - a category's bracket sizes don't sum to its team count, or
    - the seeds aren't contiguous from 1, or
    - a size is outside 4–7 while the category has 4 or more teams, or
    - a bracket is larger than `tableCount`.
- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `suggestBracketPlan` makes `floor(n/4)` brackets of 4 and adds the remainder to the last bracket. If `n < 4`, it makes one bracket of `n`.
  - `buildHeats` is the outside-in rule from Global Constraints.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit:** `feat(engine): bracket plan, heats and placement formats`

---

### Task 5: Seeding groups

**Files:**
- Create: `packages/engine/src/groups.ts`
- Test: `packages/engine/test/groups.test.ts`

**Interfaces:**
- Consumes: `Category`, `Team`, `SeedingGroup`, `EventInput`
- Produces:
  - `suggestSeedingGroups(categories: Category[], teams: Team[], tableCount: number): { groups: SeedingGroup[]; tableOf: Record<string, number> }`
  - `validateSeedingGroups(input: EventInput): string[]`

- [ ] **Step 1: Write the failing tests**
  - Categories of 14, 16 and 20 teams on 26 tables give 2 groups (`A`, `B`) of 25 and 25. Each category splits 7/7, 8/8 and 10/10. Group A's tables are `1..25` in category order, then `team.order`.
  - Capacity edge (Review Focus 4):
    - 26 teams on 26 tables give 1 group.
    - 27 teams on 26 tables give 2 groups.
    - Categories of 15, 17 and 20 teams on 26 tables give two groups, neither larger than 26.
  - `validateSeedingGroups` reports an error for:
    - a team in no group or in two groups
    - two teams on the same table in one group
    - a table number above `tableCount` or below 1
- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `g = max(1, ceil(n / tableCount))`.
  - For each category in order, give every group `floor(c/g)` of its teams (in `team.order`). Hand the remaining teams one at a time to whichever group currently has the fewest teams, choosing the earliest group on a tie.
  - Within each group, order teams by category order, then `team.order`, and assign tables `1..k`.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit:** `feat(engine): seeding group suggestion and validation`

---

### Task 6: Round plan

**Files:**
- Create: `packages/engine/src/schedule.ts`
- Test: `packages/engine/test/schedule.test.ts`

**Interfaces:**
- Consumes: `EventInput`, `bracketSet`
- Produces:

```ts
export type RoundSpec =
  | { round: number; kind: 'seeding'; groupId: string; run: 1 | 2 }
  | { round: number; kind: 'heats' | 'placement'; set: 'upper' | 'lower'; bracketIds: string[] }
  | { round: number; kind: 'grand' };
export function buildRoundPlan(input: EventInput): RoundSpec[];
```

- [ ] **Step 1: Write the failing tests**
  - `previous event shape`: 2 groups, brackets HS 4/4/6, Community 4/4/4/4 and Corporate 4/4/4/4/4 on 26 tables give 9 rounds:
    1. seeding A run 1
    2. seeding B run 1
    3. seeding A run 2
    4. seeding B run 2
    5. heats lower: 6 brackets, 26 teams
    6. heats upper: 6 brackets, 24 teams
    7. placement lower
    8. placement upper
    9. grand
  - `chunks keep brackets whole`: the same brackets on 20 tables split lower heats into two rounds whose bracket sizes each sum to 20 or fewer, and the placement chunks mirror the heats chunks.
  - `small bracket races only in heats`: a category of 3 teams appears in an upper heats round and in no placement round.
  - `grand omitted`: no `grand` round when `grandChampionship` is false or there is only 1 category.
- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Order brackets by category order, then `tierIndex`.
  - Chunk each set greedily so each chunk's team total is no more than `tableCount`.
  - Placement chunks are the heats chunks with brackets of fewer than 4 teams removed; drop any chunk left empty.
  - Number the rounds sequentially from 1.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit:** `feat(engine): round plan with table-capacity chunking`

---

### Task 7: Table layout

**Files:**
- Create: `packages/engine/src/layout.ts`
- Test: `packages/engine/test/layout.test.ts`

**Interfaces:**
- Produces: `layoutTables<T>(races: T[][]): { race: T[]; tables: number[] }[]`. Returns the races in their final placement order, each with consecutive table numbers starting at 1.

- [ ] **Step 1: Write the failing tests**
  - Races of sizes `[2,2,2]` get tables `[1,2]`, `[3,4]` and `[5,6]`.
  - Races of sizes `[3,3,2,2]` get `[1,2,3]`, `[4,5,6]`, `[7,8]` and `[9,10]`. These are the previous event's HS Bronze placement races.
  - Races of sizes `[2,3,2,3]` (races a, b, c, d in that order) come out in the order a, b, d, c with tables `[1,2]`, `[3,4,5]`, `[6,7,8]`, `[9,10]`. Race d is moved forward so that race c doesn't straddle a station.
  - Races of sizes `[3,2]` get `[1,2,3]` and `[4,5]`. Race 2 straddles a station because no odd-sized race is left to move forward.
- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Keep a table pointer starting at 1.
  - Before placing a race of even size when the pointer is even, move the next odd-sized race in the list in front of it, if there is one.
  - Assign consecutive tables to each race as it is placed.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit:** `feat(engine): table layout avoiding split head-to-heads`

---

### Task 8: Derive event: matchups and rankings

**Files:**
- Create: `packages/engine/src/event.ts`
- Test: `packages/engine/test/event.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces:

```ts
export interface RaceView {
  id: string;            // see race id formats below
  round: number;
  label: string;         // e.g. 'High School Bronze · Heat 1', 'Community Gold · Winners race', 'Grand Championship'
  bracketId?: string;
  entrants: { teamId: string; table: number }[];
  ranking: RaceRanking;  // from rankRace over progress.results[round]
}
export interface RoundView { spec: RoundSpec; status: 'locked' | 'ready' | 'blocked'; races: RaceView[] }
export interface DerivedEvent {
  rounds: RoundView[];
  seedRank: Record<string, number> | null;           // null until every seeding round is locked
  standings: Record<string, (string | null)[]>;      // categoryId → teamId per place (index 0 = 1st); null = undecided
  grandChampion: string | null;
  blockers: string[];                                 // human-readable, e.g. 'Round 5: tie in r5:hs:2:heat1'
}
export function deriveEvent(input: EventInput, progress: EventProgress): DerivedEvent;
```

- Race id formats:
  - seeding: `r{round}:seed:{teamId}`
  - heats: `r{round}:{bracketId}:heat{n}` (n starts at 1)
  - single race for a 1–3 team bracket: `r{round}:{bracketId}:final`
  - placement: `r{round}:{bracketId}:winners` and `r{round}:{bracketId}:others`
  - Grand Championship: `r{round}:grand`
- Round status:
  - `locked` if `round <= finishedRounds`.
  - `ready` if every earlier round is locked with no unresolved ties (`ties` not empty and no `tieDecisions[race.id]`).
  - `blocked` otherwise, with `races: []`.
- Matchups and fallback orders by round kind:
  - Seeding rounds give one race per team in the group at its `tableOf` table, with fallback order `[teamId]`.
  - Heats rounds use brackets filled from `seedRank`: the category's teams sorted by rank, sliced by `firstSeed`/`size`. Races come from `buildHeats` (or a single `final` race for fewer than 4 teams), with fallback order = seed order.
  - Placement rounds use `buildPlacement` over the heats rankings from that bracket's heats round, with fallback order = winners then others in seed order.
  - The Grand Championship race holds the tier-0 winner of each category (the winners-race leader, or the `final` leader for a small bracket), in category order. Fallback order = category order.
  - Each round's races pass through `layoutTables`, keeping bracket order then race order.
- Standings: a category's place `firstSeed + i` is the i-th team of its bracket's placement rankings (`winners` order, then `others` order), or of its `final` ranking. A place is filled only when the deciding round is locked and the race has no unresolved tie.
- `grandChampion` is `order[0]` of the grand race once its round is locked and the race has no unresolved ties.

- [ ] **Step 1: Write the failing tests** using a small hand-built event: 1 category of 4 teams, 4 tables, grand off.
  - `progress.finishedRounds = 0` gives round 1 `ready` with seeding races, round 3 `blocked`, and `seedRank === null`.
  - After both seeding rounds are locked with times, the heats round is `ready`: `[seed1 vs seed4]` on tables 1–2 and `[seed2 vs seed3]` on tables 3–4, labels ending `· Heat 1` and `· Heat 2`.
  - With heats locked (seed 4 beats seed 1, seed 2 beats seed 3), the placement round's `winners` race is `[seed4, seed2]` and its `others` race is `[seed1, seed3]`.
  - With placement locked, standings are filled (all 4 places) in the expected order.
- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement `deriveEvent`** to the interface and rules above.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit:** `feat(engine): deriveEvent matchups, rankings and standings`

---

### Task 9: Derive event: edge cases

**Files:**
- Modify: `packages/engine/src/event.ts`
- Test: `packages/engine/test/event-edges.test.ts`

**Interfaces:**
- Consumes and produces the same `deriveEvent` as Task 8, with no API change.

- [ ] **Step 1: Write the failing tests**
  - `unresolved tie blocks later rounds` (Review Focus 5): a locked heats round where both teams in heat 1 finish in 192401 and 192409 ms gives:
    - the placement round as `blocked`
    - `blockers` containing `'r{n}:…:heat1'`
    - after adding `tieDecisions[thatRaceId] = [teamB, teamA]`, the placement round is `ready` with teamB in the winners race.
  - `small category` (Review Focus 3): categories of 4 and 3 teams with grand enabled give:
    - a `final` race of 3 teams in the heats round, with standings for the 3-team category filled from it
    - the grand race containing both categories' winners
  - `DNS team still placed`: a team that is DNS in every bracket race still ends with a standings place, last in its race.
  - `standings stay null until locked`: places for an unlocked placement round are `null`.
- [ ] **Step 2: Run the tests.** Expected: any that Task 8's implementation doesn't already satisfy FAIL.
- [ ] **Step 3: Fix `event.ts`** until every test passes. Change nothing in the public API.
- [ ] **Step 4: Run `npm test`.** Expected: all PASS.
- [ ] **Step 5: Commit:** `test(engine): deriveEvent ties, small categories and DNS`

---

### Task 10: Acceptance: reproduce the previous event

**Files:**
- Test: `packages/engine/test/acceptance.test.ts`
- Read only: `packages/engine/test/fixtures/previous-event.json`

The fixture is already committed. Its fields:
- `tableCount: 26`
- `categories: ['High School','Community','Corporate']`
- `teams[]`: `{ name, category, group, table, run1, run2, expectedSeedRank }`, in sheet order
- `bracketRounds[]`: `{ round: 5..9, rows: [{ table, team, place }] }`. `place` is the team's finishing place within its race, as recorded in the sheet.
- `expectedStandings`: category → team names from 1st to last
- `expectedGrandChampion`

**Interfaces:**
- Consumes: `suggestBracketPlan`, `buildRoundPlan`, `deriveEvent`, `parseClockTime`

- [ ] **Step 1: Write the test**
  - Build `EventInput` from the fixture:
    - team id `t{index}`, `order = index`, category id = category name
    - groups `A` and `B` from `team.group`, members sorted by `table`
    - `tableOf` from `team.table`
    - brackets from `suggestBracketPlan`
    - `grandChampionship: true`
  - Build `EventProgress` with `finishedRounds: 9`:
    - Round 1 = group A `run1`, round 2 = group B `run1`, round 3 = group A `run2`, round 4 = group B `run2`. Each is `finished`, with `rawMs = parseClockTime(...)` and `penaltiesMs = 0`.
    - For rounds 5–9, each row becomes `finished` with `rawMs = 200_000 + place * 5_000`. These are synthetic times, because the sheet recorded only places.
  - Assert:
    1. `buildRoundPlan(input)` has 9 rounds, with kinds `seeding×4, heats, heats, placement, placement, grand`.
    2. `seedRank[t{i}] === teams[i].expectedSeedRank` for all 50 teams.
    3. For rounds 5–8, the derived round's entrants sorted by table map to the same team names as `bracketRounds[round].rows` sorted by table.
    4. Standings for each category map to the team names in `expectedStandings`.
    5. `grandChampion` maps to `'Riverbend Middle School'`, and `blockers` is empty.

  Round 9's table order is deliberately not asserted. The sheet placed the champions HS, Corporate, Community; the engine uses category order.
- [ ] **Step 2: Run `npx vitest run packages/engine/test/acceptance.test.ts`.** Expected: PASS. A pre-check during planning confirmed these rules reproduce every assertion. Any failure is an engine bug: fix it in the owning module, and never change the fixture.
- [ ] **Step 3: Run `npm test && npm run typecheck`.** Expected: all green.
- [ ] **Step 4: Commit:** `test(engine): acceptance against previous event`
