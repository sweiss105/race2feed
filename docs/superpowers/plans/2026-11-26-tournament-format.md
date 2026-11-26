# Tournament Format Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Organisers choose the tournament format in Setup: 1–3 seeding rounds, how seeding is ranked, and the bracket format (heats then placement, finals only, seeding only, knockout).

**Architecture:** One optional `format` object on the engine's `EventInput`, read through a single `formatOf()` that supplies today's values when a field is missing. The round plan, seeding rank, race drafting and standings in `packages/engine` branch on it; the server adds one setup command and validation; the web adds a Setup panel and teaches the seeding and bracket displays the new shapes.

**Tech Stack:** TypeScript, Vitest, Preact, Cloudflare Worker + Durable Object, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-26-tournament-format-design.md` (binding; read it first).

## Global Constraints

- `CLAUDE.md` applies: behaviour changes update `docs/design.md` in the same commit; staff-visible changes update `docs/user-guide.md` in the same commit. Screenshots and the PDF (`docs/PRC-User-Guide.pdf`) are regenerated in Tasks 4 and 7 with `npm run guide`.
- The software is called **PRC**; "Race to Feed" is the event. Add a `CHANGELOG.md` entry dated 2026-11-26 in Task 4 ("Tournament format settings") and extend it in Task 7.
- **An event with no `format` must behave exactly as today.** Every existing test passes unchanged unless it asserts a type or label this plan deliberately changes; list any such test in your report. 771 unit tests and 5 e2e tests pass before this plan.
- Test first. One file: `npx vitest run <path>`. Before each commit: `npm run typecheck` and `npm test`, zero failures.
- Ranking and comparing times is always at the displayed hundredth, using the engine's `hundredths()`.
- Saved line-ups (`progress.lineups`) are never rebuilt; new formats must save and replay through the same mechanism.
- Staff-facing copy is plain: short sentences, no jargon, no internal names.
- Commit trailer on every commit:
  ```
  Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Sk6v3xMXJfb5KtHLVK6ymo
  ```
- Do not push to `main`. Do not create a pull request.

## Review Focus

1. An event stored before this change, mid-event, loaded by the new code: identical rounds, ranks, labels and standings. Pinned in Task 1 (`previousEvent()` derived with and without `format: {}` deep-equals; the acceptance fixture test stays green).
2. A team that misses runs (DNF/DNS, or a cleared result) under each ranking rule with 1, 2 and 3 runs. Pinned in Task 1.
3. Seeding only with a Grand Championship, and with one category (no grand): the event must end with a champion screen that has winners. Pinned in Tasks 1 and 2.
4. Changing format after brackets were set up for another format (knockout's 12-team bracket, then back to placement): lock must refuse with a readable problem, and Suggest must repair it. Pinned in Tasks 2 and 5.
5. Knockout bracket sizes that are not powers of two (3, 5, 6, 7, 9, 12), with a DNF or a tie in an early round. Pinned in Task 5.

---

## Stage 1 — seeding rounds, seeding rank, finals only, seeding only

### Task 1: Engine — format, seeding runs and ranking, finals-only and seeding-only

**Files:**
- Modify: `packages/engine/src/types.ts`, `schedule.ts`, `seeding.ts`, `event.ts`, `brackets.ts`, `index.ts`
- Test: `packages/engine/test/format.test.ts` (new), existing engine tests stay green

**Interfaces — Produces:**
```ts
// types.ts
export type SeedingRankRule = 'total' | 'best' | 'dropSlowest';
export type BracketFormat = 'placement' | 'finals' | 'none' | 'knockout';
export interface TournamentFormat { seedingRuns?: 1 | 2 | 3; seedingRank?: SeedingRankRule; brackets?: BracketFormat }
// EventInput gains: format?: TournamentFormat
export function formatOf(input: Pick<EventInput, 'format'>): Required<TournamentFormat>   // defaults: 2, 'total', 'placement'
/** Problems with the format itself: 'best' needs at least 2 runs; 'dropSlowest' needs 3. [] when fine. Plain sentences. */
export function validateFormat(format: TournamentFormat | undefined): string[]

// schedule.ts — RoundSpec seeding member becomes { round; kind: 'seeding'; groupId: string; run: 1 | 2 | 3 }
//   and a new member { round; kind: 'finals'; set: 'upper' | 'lower'; bracketIds: string[] } for the finals-only format.
// buildRoundPlan: seedingRuns runs; 'placement' as today; 'finals' → one 'finals' round per chunk (same chunking as heats),
//   no placement rounds; 'none' → no bracket rounds; 'knockout' → throws Error('knockout is not built yet') until Task 5.
// Grand round rule unchanged except for 'none': needs ≥ 2 categories that have at least one team.

// seeding.ts
/** runs: one record per seeding run, in order (length 1–3). Returns rank within category, 1-based. */
export function rankSeeding(teams: Team[], runs: Record<string, EntryResult | undefined>[], rule?: SeedingRankRule): Record<string, number>
/** The time a team is ranked on under the rule, at the hundredth: total of finished runs / best run / total of counted runs. null with nothing to count. */
export function seedingScore(times: (number | null)[], rule: SeedingRankRule): number | null
```
- `rankSeeding` rules are exactly the spec's "Seeding rank" section. Update the two existing call shapes (`event.ts`; any test calling the old three-argument form — convert the call, keep the assertions).
- `event.ts`: finals rounds draft one race per bracket with all its members (`role: 'final'`, id `r{n}:{bracketId}:final`, label `{bracket label} · Final`); a bracket of fewer than 4 in the placement format keeps today's label `· Race`. Standings and `bracketWinner` already read `final`.
- `event.ts` with `brackets: 'none'`: `seedRank` is computed once every seeding round is locked and settled (no missing results, no ties — seeding races are one team so only missing matters); `standings[categoryId]` = that category's teams in seed order (all `null` until then); the grand race's entrants are each category's rank-1 team; `bracketMembers` stays null. `DerivedEvent` gains `categoryWinners: Record<string, string | null>` (per category: `standings[c][0]`) used by callers instead of reaching into brackets.
- `brackets.ts`: `validateBracketPlan` returns no bracket errors when the format is `'none'` and flags any bracket present ("Seeding only uses no brackets. Remove them, or suggest groups and brackets again."); `suggestBracketPlan` gains a fourth parameter `format: BracketFormat = 'placement'` and returns `[]` for `'none'` (knockout sizing arrives in Task 5); `grandCategories` for `'none'` = categories with at least one team.

- [ ] **Step 1: Failing tests** in `format.test.ts`:
  - `formatOf({})` → `{ seedingRuns: 2, seedingRank: 'total', brackets: 'placement' }`; `validateFormat` refuses `best`+1 run and `dropSlowest`+2 runs, accepts the rest.
  - Plan: 2 groups × runs 1/2/3 → 2/4/6 seeding rounds in order run-major (all run 1, then run 2…); `finals` → no `placement` rounds, one `finals` round per chunk; `none` → only seeding (+ grand when ≥ 2 categories have teams and the switch is on; no grand with one category).
  - Ranking table-tests (one category, teams A–D, team order A<B<C<D), each rule × runs, including: equal at the hundredth falls to the next tiebreak; `total`: 2 finished beats 1 finished regardless of time; `best`: a team with one fast run and one DNF beats a team with two slower runs; no finished run ranks last; `dropSlowest` with 3 runs: `[60s, 61s, 90s]` scores 121.00 and beats `[60s, 62s, DNF]` (122.00) and both beat `[50s, DNF, DNF]` (one counted run); `seedingScore` values for each.
  - Finals only on a 7+1 event: the round has one race per bracket with every member, labelled `· Final`; finishing order becomes the standings; the grand round takes the two winners.
  - Seeding only, two categories, grand on: standings are null until the last seeding round is finished, then seed order; grand entrants are the two top seeds; champion = grand winner. One category: no grand round; `categoryWinners` has the top seed. A cleared seeding result leaves standings null and blocks (existing `missing`).
  - Review Focus 1: `deriveEvent(input, progress)` for the previous-event fixture deep-equals `deriveEvent({ ...input, format: {} }, progress)` and `{ ...input, format: { seedingRuns: 2, seedingRank: 'total', brackets: 'placement' } }`, apart from the new `categoryWinners` key being present in all three.
- [ ] **Step 2:** run, fail. **Step 3:** implement. **Step 4:** `npm run typecheck && npm test` pass.
- [ ] **Step 5:** `docs/design.md`: a "Tournament format" section (the table of fields, seeding rank rules verbatim from the spec, finals only, seeding only). Commit `feat(engine): tournament format — seeding runs, ranking rules, finals only, seeding only`.

---

### Task 2: Server — setFormat, validation, suggestions, views

**Files:**
- Modify: `packages/server/src/core/model.ts`, `setup.ts`, `apply.ts`, `views.ts`, `results.ts` (`seedTotals`), `lifecycle.ts` (champion gates), `export.ts`, `fairness.ts` (only where it reads seeding totals or bracket roles)
- Test: `packages/server/test/core/format.test.ts` (new); `packages/web/test/support/state.ts` only if a helper signature changes

**Interfaces — Consumes:** Task 1. **Produces:**
```ts
// SetupCommand gains:
| { type: 'setFormat'; format: TournamentFormat }   // admin only; refused with 'setup_locked' when locked; 'invalid' + validateFormat()'s
                                                    // sentences in detail when the format is not valid or has unknown values;
                                                    // 'knockout' refused with 'invalid' ("Knockout is not available yet.") until Task 6.
// Stores the given fields merged over the existing format. Changing `brackets` to 'none' also clears setup.brackets.
// publicView / controlView add:
//   format: Required<TournamentFormat>                    // so every page can label things
//   seedRuns: Record<string, (number | null)[]>           // teamId → official ms per seeding run, in run order (null = no time yet / DNF / DNS)
//   seedScoreMs: Record<string, number | null>            // the value each team is ranked on (seedingScore)
// seedTotalsMs stays (sum of finished runs) for anything that still reads it.
```
- `lockSetup`: includes `validateFormat` problems; skips bracket requirements for `'none'`.
- `suggestSetup`: passes the bracket format to `suggestBracketPlan`.
- Champion: wherever the server decides "is there a champion / category winners" (`championBlock`, `projectorScreen`, `publicView`'s champion data), use `d.categoryWinners` so seeding-only events finish with winners. With `'none'` and no grand round, the champion screen may be shown once the last seeding round is finished and settled.
- `projectorScreen`: after a finished `finals` round show brackets/standings as it does after placement; with `'none'`, after the last seeding round show seeding results until the champion is shown (never the brackets screen).
- `export.ts` and `fairness.ts`: no rule changes; make sure seeding with 1 or 3 runs and the `finals` round kind don't throw and that `referee_wins` predicts from `seedScoreMs`-equivalent ordering (use seed rank order).

- [ ] **Step 1: Failing tests:** `setFormat` happy path, merge behaviour, refused when locked, refused for referee/companion (through `applyCommand`), refused for invalid combinations with the sentences in `detail`, `'knockout'` refused; switching to `'none'` clears brackets; lock with `'none'` and no brackets succeeds, lock with `'none'` and a bracket left by hand fails with the plain sentence; Review Focus 4 first half (a format change that makes existing brackets invalid is caught at lock and fixed by `suggestSetup`); a 1-run and a 3-run event raced to the end through commands (`runRound`) produce standings; a seeding-only two-category event ends with a champion via the grand round and `showChampion` works; a seeding-only one-category event allows `showChampion` after the last seeding round and `publicView` exposes the category winner; views carry `format`, `seedRuns`, `seedScoreMs`; `eventCsv` and `fairnessWarnings` run on each without throwing.
- [ ] **Step 2–4:** fail, implement, `npm run typecheck && npm test`.
- [ ] **Step 5:** `docs/design.md` (command, validation, views). Commit `feat(server): tournament format command, validation and views`.

---

### Task 3: Web — Tournament format panel with explanations

**Files:**
- Modify: `packages/web/src/pages/control/sections/Setup.tsx` (+ `control.css`)
- Create: `packages/web/src/pages/control/sections/TournamentFormat.tsx`, `packages/web/src/lib/formatCopy.ts`
- Test: `packages/web/test/pages/control-format.test.tsx` (new), `packages/web/test/lib/formatCopy.test.ts`
- Docs: `docs/user-guide.md`, `docs/design.md`

**Interfaces — Consumes:** `view.format`, `view.setup`, `setFormat`, engine `buildRoundPlan`/`validateFormat` (the web already imports from `@race2feed/engine`).

`formatCopy.ts` holds ALL wording, so tests pin it and docs can quote it:
```ts
export const PRESETS: { id: 'standard' | 'short' | 'seeding' | 'knockout'; name: string; blurb: string; format: Required<TournamentFormat> }[]
export const presetOf = (f: Required<TournamentFormat>): string   // preset id or 'custom'
export const SEEDING_RUNS_HELP: Record<1 | 2 | 3, string>
export const SEEDING_RANK: Record<SeedingRankRule, { label: string; help: string }>
export const BRACKET_FORMAT: Record<BracketFormat, { label: string; help: string }>
/** "9 rounds, 31 races", or what is still needed ("Add teams to see how many rounds this makes."). */
export function formatSummary(setup: EventInput): string
```
Required copy (exact; the owner asked for explanations on every option):
- Panel intro: "Choose how the event runs. You can change this until setup is locked."
- Presets — Standard: "Two seeding rounds, then heats and a placement race in each bracket. This is how Race to Feed has been run." · Short: "One seeding round, then one final race per bracket. The quickest full event." · Seeding only: "Seeding rounds decide everything. No brackets." · Knockout: "Seeding rounds, then head-to-head knockout brackets down to a final." (shown disabled with "Coming soon" until Task 6).
- Seeding rounds — 1: "Every team races once to set the seeding. Quickest, but one bad run decides a team's seed." · 2: "Every team races twice. A slow run can be made up in the other." · 3: "Every team races three times. The fairest seeding and the longest evening."
- Seeding rank — Total time: "Add up every run. Rewards teams that are consistently fast; a team that misses a run ranks below teams that finished them all." · Best run: "Only each team's fastest run counts. One great run is enough, and a bad run costs nothing." · Drop the slowest: "Each team's slowest run is ignored, so one bad run (or one DNF) is forgiven. Needs three seeding rounds."
- Bracket format — Heats, then placement: "Teams race head-to-head in heats, top seed against bottom seed. Heat winners then race each other for the top places, and the rest race for the remaining places." · Finals only: "Each bracket races once, all its teams together. The finishing order is the result." · Seeding only: "No brackets. Each category's final order is its seeding order." · Knockout: "Head-to-head rounds. Win and you go through; lose and you're out. The last two race the final, and the semi-final losers race for third."
- An unavailable choice says why in place: Best run with 1 round → "Needs at least two seeding rounds."; Drop the slowest with fewer than 3 → "Needs three seeding rounds."; choosing a seeding-round count that makes the current rank rule invalid switches the rule to Total time and says so ("Seeding rank changed to Total time.").
- Locked: every control disabled, with "Setup is locked. Unlock it to change the format."
- After a change that leaves brackets not matching the format (server lock validation would complain), show: "Your brackets were set up for a different format. Press Suggest groups and brackets to rebuild them." (derive this from `validateBracketPlan` on `view.setup`).

Controls: presets as a row of selectable cards (radio group "Preset"); "Seeding rounds", "Seeding rank", "Bracket format" as radio groups, each option showing its label and its help text underneath (all help visible, not hidden in tooltips); the summary line at the bottom with `aria-live="polite"`. Each change sends one `setFormat` with only the changed field (a preset sends all three). Follow existing panel/card classes and tokens; must read well in light and dark.

- [ ] **Step 1: Failing tests:** every string above is rendered for its option; presets send the right `setFormat`; a field change sends only that field; `presetOf` shows Custom after a manual change; invalid combinations are disabled with their reason; the auto-switch message; locked state; the brackets-mismatch notice; `formatSummary` for the previous-event fixture under Standard equals its real round and race counts, and updates under Short and Seeding only; Knockout shows "Coming soon" and cannot be chosen.
- [ ] **Step 2–4:** fail, implement, `npm run typecheck && npm test`.
- [ ] **Step 5:** guide: a new "Tournament format" step in "Setup before the day" (placed before seeding groups and brackets, renumbering the steps and fixing every cross-reference/anchor to them) with a table of each setting, its options and the same explanations, and guidance on choosing; design.md §7 console. Commit `feat(web): tournament format panel in Setup`.

---

### Task 4: Web — seeding and results displays for every format; guide, e2e, changelog

**Files:**
- Modify: participant, projector and console components that show seeding results, brackets and standings (find them via `seedTotalsMs`, `seedRank`, `bracketModel`, `projectorScreen` screens `seeding-results`, `brackets`, `standings`, `champion`), `packages/web/src/lib/selectors.ts`, `bracketModel.ts`
- Test: the matching test files in `packages/web/test`
- Modify: `e2e/guide.spec.ts`, new `e2e/format.spec.ts`, `docs/user-guide.md`, `README.md`, `CHANGELOG.md`

Behaviour:
- Seeding results (phone, projector, console): one column per run actually in the format ("Run 1", "Run 2", "Run 3"), then the ranked-on value headed "Total", "Best run" or "Best two". With one run, show just the time (no separate total column). The dropped run under "Drop the slowest" is shown struck through or dimmed with an accessible label "not counted".
- The phone's "your results" for a team uses the same wording.
- Finals only: the brackets screens show each bracket as one race ("Final") with the finishing order; no empty placement column.
- Seeding only: there is no brackets screen; anything that linked to brackets shows final standings by category once seeding is complete, and says "Standings are decided by seeding" while it is in progress.
- Champion and final standings screens work with all three stage-1 formats.
- Nothing changes for the Standard format (existing tests green).

- [ ] **Step 1: Failing tests** for each bullet (1, 2 and 3 runs; each rank rule's heading and value; dropped run marked; finals-only bracket view; seeding-only standings and the absent brackets screen; champion screen for a seeding-only single-category event).
- [ ] **Step 2–3:** fail, implement; `npm run typecheck && npm test`.
- [ ] **Step 4: e2e** `e2e/format.spec.ts`: (a) Short preset on a 4-team event: one seeding round, one finals round, champion shown; (b) Seeding only with 3 runs and Drop the slowest on a 4-team single-category event raced to the champion screen, checking the "Best two" heading on the projector. Existing specs untouched and passing.
- [ ] **Step 5: guide**: `e2e/guide.spec.ts` takes `console-setup-format.jpg` (the panel, Standard selected) and the guide references it; run `npm run guide`; look at the new picture and any changed seeding/bracket pictures; README testing section lists the new spec; `CHANGELOG.md` entry "Tournament format settings" dated 2026-11-26 describing the stage-1 options and that existing events are unaffected.
- [ ] **Step 6:** `npm run typecheck`, `npm test`, `npm run e2e` (alone) all pass. Commit `feat(web): seeding and bracket displays for every tournament format; guide and e2e`.

---

## Stage 2 — knockout

### Task 5: Engine — knockout brackets

**Files:**
- Modify: `packages/engine/src/schedule.ts`, `event.ts`, `brackets.ts`, `types.ts`, `index.ts`
- Create: `packages/engine/src/knockout.ts`
- Test: `packages/engine/test/knockout.test.ts`

**Interfaces — Produces:**
```ts
// knockout.ts
/** Number of knockout stages for a bracket of n teams: 1 for 2, 2 for 3–4, 3 for 5–8, 4 for 9–16, … */
export function knockoutStages(n: number): number
/** Seed positions of a full draw of `size` (a power of two): [1, 8, 4, 5, 2, 7, 3, 6] for 8. */
export function seedSlots(size: number): number[]
/** Stage name counted from the final: 1 → 'Final', 2 → 'Semi-final', 3 → 'Quarter-final', 4 → 'Round of 16', else `Round ${n}` counted from the start. */
export function stageName(stagesFromFinal: number, stageFromStart: number): string
// types.ts RaceRole gains 'ko' | 'third'
// schedule.ts RoundSpec gains { round; kind: 'knockout'; stage: number /* 1 = final round, 2 = semi-finals… */; bracketIds: string[] }
```
Rules (spec "Knockout", exact):
- Draw: seeds placed by `seedSlots(nextPow2(n))`; a slot whose seed number exceeds n is empty, so its opponent has a bye and appears first in the next stage without a race.
- Each bracket has `knockoutStages(n)` stages. Globally there are `max` stages; a bracket with fewer joins late so its final is in the last knockout round. One plan round per stage per table-sized chunk (chunk by the number of teams racing in that stage, greedy in bracket order, as `chunk()` does today). The final stage's chunk counts the final plus the third-place race.
- Races: `role: 'ko'`, id `r{n}:{bracketId}:ko{stage}-{index}`, label `{bracket label} · {stageName} {index}` (no index when the stage has one race); final `role: 'final'`, id `…:final`, label `· Final`; third place `role: 'third'`, id `…:third`, label `· Third place` (only when the bracket has two semi-final races that were both raced, i.e. n ≥ 4).
- Entrants of a later stage come from settled earlier races (winner = `ranking.order[0]`) and byes; an unsettled feeder (tie, missing result) blocks as today. `fallbackOrder` of every race is the entrants in seed order.
- Final order of a bracket: final's order (1st, 2nd), third-place race's order (3rd, 4th; for n = 3 the semi-final loser is 3rd), then for each earlier stage from latest to earliest, that stage's losers ordered by official time in that stage at the hundredth (finishers first, then DNF, then DNS; equal → seed order).
- `validateBracketPlan` with `'knockout'`: size 2 … `tableCount` (replacing the 4–7 rule); all other checks as today. With `'placement'` or `'finals'` the 4–7 rule stays. `suggestBracketPlan(…, 'knockout')`: brackets of 8 by seed; a remainder under 4 folds into the last bracket; a category of fewer than 8 is one bracket (2+ teams) — a category with 1 team gets a bracket of 1 that needs no race and wins by default (keep consistent with how a 1-team bracket behaves today in placement format; test it).
- Grand Championship takes each top bracket's winner, as today.
- `buildRoundPlan` no longer throws for `'knockout'`.

- [ ] **Step 1: Failing tests:** `seedSlots` for 2, 4, 8, 16; `knockoutStages` for 2–17; full walk-throughs for n = 2, 3, 4, 5, 6, 7, 8, 9, 12 (Review Focus 5): byes go to the top seeds; 1 and 2 can only meet in the final (seed order holding in every race ends with final 1 v 2); third-place race exists for n ≥ 4 only; final standings complete and each team exactly once; early-round losers ordered by time with a DNF last; a tie in a quarter-final blocks the semi-final round until decided; two brackets of sizes 4 and 8 share rounds with finals aligned in the last round; chunking when the tables can't hold a stage; saved line-ups replay unchanged after a late correction to a quarter-final (entrants of the played semi-final stay); validation and suggestion rules; grand round takes knockout winners.
- [ ] **Step 2–4:** fail, implement, `npm run typecheck && npm test`.
- [ ] **Step 5:** `docs/design.md` knockout section. Commit `feat(engine): knockout brackets`.

---

### Task 6: Server and web — knockout enabled, bracket tree

**Files:**
- Modify: `packages/server/src/core/setup.ts` (allow `'knockout'`), `views.ts` (anything listing bracket races by role), `fairness.ts` (`FINALS` already has `final` and `grand`; do not add `third`), `rotation.ts` (finals split: `final` only in knockout; `third` not split)
- Modify web: `lib/bracketModel.ts`, the bracket components on participant, projector and console, `TournamentFormat.tsx` (enable the Knockout preset and option), Setup's bracket editor (size hint: "2 to {tables}" for knockout, "4 to 7" otherwise)
- Test: server `format.test.ts` additions; `packages/web/test/lib/bracketModel.test.ts`, `brackets.test.tsx`, projector and control tests

Behaviour:
- `setFormat` accepts `'knockout'`; `suggestSetup` builds knockout brackets; the "Coming soon" label goes.
- Bracket tree: columns per stage left to right ending with the Final, with the Third place race shown under the final; each match shows both teams (or "Bye"), times once raced, the winner emphasised, "to be decided" placeholders for unknown entrants; a 16-team bracket scrolls horizontally on a phone and fits on the projector at 1080p (reduce type size by stage count; the projector may page brackets as it does today). The viewer's own team is highlighted on the phone as today.
- Projector's automatic screens: after each knockout round show brackets; champion logic unchanged.
- Rotation's finals split applies to the knockout final and the Grand Championship.

- [ ] **Step 1: Failing tests:** the model for n = 4, 5, 8 (byes, placeholders, winners, third place); components render stage headings ("Quarter-final", "Semi-final", "Final", "Third place") and "Bye"; phone highlights the remembered team; console lists knockout races in Results; server accepts knockout and a full knockout event runs to a champion through commands; rotation splits the final and not the third-place race.
- [ ] **Step 2–4:** fail, implement, `npm run typecheck && npm test`. Visual self-check: drive a knockout event locally (see `e2e/playwright.config.ts` for the dev-server command; use another port and a scratch `--persist-to`), screenshot the tree on phone (390 px), projector (1920×1080) and console in light and dark, LOOK at them and fix overlap/truncation.
- [ ] **Step 5:** guide (knockout in the format table; a "Knockout brackets" subsection explaining byes, third place, how placings are decided; bracket size rule), design.md. Commit `feat: knockout tournament format with bracket tree`.

---

### Task 7: Knockout e2e, guide pictures, changelog

- [ ] `e2e/format.spec.ts`: a 6-team single-category knockout event (two byes) raced to the champion screen; asserts the semi-final entrants, the third-place race and final standings on the phone.
- [ ] `e2e/guide.spec.ts`: `projector-knockout.jpg` and `phone-knockout.png` from a separate small knockout event (do not change the main guide event's format); reference them in the guide.
- [ ] `npm run guide`; look at the new pictures; `CHANGELOG.md` entry extended with knockout; README if stale.
- [ ] `npm run typecheck`, `npm test`, `npm run e2e` (alone) all pass. Commit `docs: knockout guide pictures, e2e and changelog`.
