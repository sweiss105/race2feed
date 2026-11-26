# PRC (Packing Race Coordinator) — Design

PRC is the app; Race to Feed is the event it runs.

Status: **Implemented; kept current with the code** · 2026-11-23

This app replaces the `Race_to_Feed_Final_Bracket` Google Sheet that we used to run the event. It handles seeding, brackets, live timing, referee input, race control, participant lookup and projector screens. It runs on Cloudflare (Workers + a Durable Object) at `r2f.weiss-audio.com`.

---

## 1. Background: what the spreadsheet does

These are the behaviors the app must reproduce. Section 3 covers where the app deliberately generalizes them.

- **50 teams in 3 categories:** High School (14), Community (16), Corporate (20). Each team races at a numbered table.
- **Seeding (rounds 1–4):** teams are split into Group A (26 teams, tables 1–26) and Group B (24 teams, tables 1–24).
  - Group A races rounds 1 and 3, and Group B races rounds 2 and 4.
  - Each team has two timed runs (m:ss). Teams are ranked within their category by total time. Ties go to the faster single run, then to sheet order. `DNS` ranks last.
- **Bracket placement by category seed:**

  | Seeds | High School | Community | Corporate |
  |---|---|---|---|
  | 1–4 | Gold | Gold | Gold |
  | 5–8 | Silver | Silver | Silver |
  | 9–12 | Bronze (9–14, 6 teams) | Bronze | Bronze |
  | 13–16 | | Copper | Copper |
  | 17–20 | | | Tin |

- **4-team brackets:** semis 1v4 and 2v3, then a final and a 3rd-place race.
- **6-team bracket (HS Bronze):**
  - First race: 9v14, 10v13, 11v12.
  - The three winners then race for places 1–3, and the three losers race for places 4–6.
- **Round order:**
  - Lower brackets (Bronze, Copper, Tin, HS Bronze) race in rounds 5 and 7.
  - Upper brackets (Gold, Silver) race in rounds 6 and 8.
  - Round 9 is the Grand Championship: a single 3-team race between the three Gold winners.
- **Final standings:** every team gets a place within its category (Gold = 1–4, Silver = 5–8, …).
- **Projector:** about 36 display tabs: per-round table lists, seeding results, per-bracket diagrams, final standings and a champion screen. Someone had to switch tabs by hand.
- **Result entry:** in bracket rounds, winners were entered by hand (type `1`). The bag total ("9,816 bags of food packed!") was typed text.

Weaknesses this design fixes:
- The sheet is hard-wired to 50 teams and fixed category sizes.
- Time entry relies on a trick: "4:05" is parsed as hours:minutes and then rescaled.
- The projector needs manual tab switching.
- There's no concurrency control or audit trail.
- There's no live timing.

---

## 2. Goals and non-goals

**Goals**
- Run a full event end to end without a spreadsheet: setup, seeding, brackets, the Grand Championship and final standings.
- Support any number of teams, categories and venue tables.
- Live timing from one master clock, with finish times captured by referees on their own phones or tablets (bring your own device; nothing is handed out).
- Race start and finish driven from Bitfocus Companion (Stream Deck).
- A read-only participant view on phones, with team search, highlighting and "your next table".
- A projector view that follows the event automatically.
- Host on Cloudflare at `r2f.weiss-audio.com` (the domain's DNS is already on Cloudflare), so event day does not depend on a home server.

**Non-goals (for now)**
- Registration or payment.
- Running more than one event at the same time. Past events are kept for history, but only one event is live.
- Offline operation without the server. See Risks (§12).

---

## 3. Event model

### 3.1 Terms

| Term | Meaning |
|---|---|
| **Event** | One competition day. Every event is kept for history; one is active. |
| **Category** | A division such as High School, Community or Corporate. Teams are ranked within their category. |
| **Team** | Name and category. |
| **Table** | One physical race station, numbered 1..T. One team per table per round. |
| **Station** | A fixed **pair of adjacent tables** (1&2, 3&4, …) covered by one referee device. With an odd table count, the last station is a single table. |
| **Seeding group** | A set of teams that race in the same seeding rounds. |
| **Bracket** | A seeded set of 4–7 teams within a category (Gold, Silver, Bronze, Copper, Tin, …). |
| **Round** | One start-to-finish run of the master clock. All races in a round start together. |
| **Race** | A group of 1–3 teams whose finish times are compared: a seeding run, a head-to-head or a 3-team race. One race can span two stations. |

### 3.2 Setup (admin)

1. **Create the event.** Enter the name, date and **venue table count** (e.g. 26).
2. **Import teams from CSV** (`team,category`), then add, edit or remove teams in the admin page. The paste box starts with the `team,category` header row already in it; a pasted list that brings its own header is accepted too. A team name is at most 35 characters (what fits on one projector line in two columns at 26 tables): the import lists each longer name with its line number and imports nothing, and add and rename refuse one. Names stored before the limit are left as they are. Late entries are allowed until seeding starts.
3. **Seeding groups (auto-suggested, editable):**
   - The app creates the fewest groups that fit the table count (e.g. 50 teams with 26 tables gives A = 26 and B = 24).
   - It keeps categories together within a group where possible, and assigns tables in order.
   - Admin can move teams between groups and tables. Duplicate table assignments are rejected.
4. **Bracket plan (auto-suggested per category, editable until seeding locks):**
   - Split the category's seeds into brackets of 4, in tier order: Gold, Silver, Bronze, Copper, Tin, then generic names.
   - Leftover teams (1–3) are folded into the **last** bracket, which becomes 5, 6 or 7 teams. For example, HS 14 teams gives 4 + 4 + 6.
   - Admin can change bracket sizes (4–7) and rename tiers.
   - A category with fewer than 4 teams gets one bracket of that size. A size of 2–3 skips the heats and races once, ranked by time.
   - **Removing a team** (before lock) also clears what it leaves empty: a category goes with its last team, together with that category's brackets, and a seeding group goes with its last team. Removing a team from a category that keeps others leaves the brackets as they are; locking then reports that they no longer match.
   - **Locking** is refused, with the problems listed, when the groups or brackets don't match the teams. This includes a bracket whose category has no teams ("Gold bracket "b:0": its category has no teams. Remove it, or suggest groups and brackets again.").
5. **Grand Championship:** by default the winner of each category's top bracket. Admin can turn this on or off. Locking setup is refused when there are more category winners than tables.
   - It is scheduled only when at least two categories would send a winner: categories that have teams and a top bracket holding at least one of them. A bracket whose category is gone or empty sends none.
6. **Credentials:** pair referee devices (§9) and create a Companion API key. Who may sign in to the console is managed in Cloudflare Access (§9).

### 3.3 Round structure

This is the **standard format**. The seeding rounds, the seeding rank and the bracket rounds can be set per event: see §3.10.

- **Seeding rounds:** each seeding group races twice, and groups take turns (A, B, A, B; with three groups, A, B, C, A, B, C). This gives `2 × groups` seeding rounds.
- **Bracket rounds:**
  - Brackets are split into a **lower set** (each category's brackets below Silver) and an **upper set** (Gold and Silver).
  - The order is: lower set first race, upper set first race, lower set placement race, upper set placement race. This matches rounds 5–8 in the sheet.
  - If a set needs more teams than there are tables, the app splits it into additional rounds and keeps whole brackets together.
- **Grand Championship:** one final round.
- **Tables in a bracket round:** the brackets in a round are laid out across tables in order (category, then tier). Each race's teams sit on consecutive tables. The app never splits a 2-team race across two stations when it can avoid it; a 3-team race always spans two stations.

### 3.4 Bracket formats ("heats then placement")

One rule covers every bracket size from 4 to 7 teams. Each team races exactly twice.

1. **Heats (first race):**
   - Pair seeds outside-in: best vs worst, second-best vs second-worst, and so on.
   - If the bracket size is odd, the middle seed joins the last (closest-seeded) pair to make a 3-team heat.
   - Heat winners are decided by time.
2. **Placement (second race):**
   - The **winners race:** all heat winners race for places 1..H, where H is the number of heats.
   - The **others race:** everyone else races for places H+1..N.
   - Places within each race are decided by time.

| Size | Heats | Winners race | Others race |
|---|---|---|---|
| 4 | 1v4, 2v3 | 2 teams → places 1–2 (final) | 2 teams → places 3–4 (3rd-place race) |
| 5 | 1v5, 2v4v3 | 2 → 1–2 | 3 → 3–5 |
| 6 | 1v6, 2v5, 3v4 | 3 → 1–3 | 3 → 4–6 |
| 7 | 1v7, 2v6, 3v5v4 | 3 → 1–3 | 4 → 4–7 |

Sizes 4 and 6 reproduce the sheet's formats exactly.

For a 5-team bracket of seeds 9–13, the heats are **9 v 13** and **10 v 12 v 11** (decided). The 7-team "others race" has 4 teams and spans two stations, which the timing rules handle (§5).

### 3.5 Ranking rules

All times in this section are **official times**: the raw time plus any penalties (§5.1).

**Within a race:**
1. Finishers, by time (fastest first).
2. **DNF** (did not finish).
3. **DNS** (did not start).

**Exact tie** (equal to the hundredth of a second):
- The race is flagged **TIE**, and race control must pick the order.
- A round can't be advanced while any tie is unresolved.
- A race can hold more than one tied group (say two pairs). Each group is decided on its own (`decideTie` with exactly that group's teams, in order) and keeps its decision when another is decided; deciding a group again replaces only that group's order.
- Stored as one list per race (`tieDecisions[raceId]`): a decided group's teams are moved to the end of the list in the new order. A group counts as decided when all its teams are in the list, and ranks by their relative order there.

**A finished round with a missing result** (race control cleared a result after the round finished, so a team's status is pending again):
- The round is not settled: none of its races with such a team decides a heat winner, a place, a standing or the champion.
- No later round can be opened, and the champion can't be shown, until every team in it has a time, DNF or DNS. The blocker names the round and the teams, e.g. "Round 3: Alpha and Delta have no result. Enter a time, DNF or DNS."
- This applies to every kind of round, seeding included. Rounds already opened keep their saved line-ups.

**Seeding rank within a category** (the standard rule, "total time"; the other rules are in §3.10):
1. Teams with two finished runs rank above teams with fewer finished runs.
2. Then by lowest total time.
3. Then by fastest single run.
4. Then by import order (the equivalent of the sheet's "higher on the sheet").

**Final standings within a category:**
- A team's place is the bracket's starting place (the sum of the sizes of the brackets above it) plus its place within the bracket.

**Grand Championship:**
- Ranked by time in its single race. The winner is the **Grand Champion**.

---

## 4. Round and race lifecycle

```
            Open next round                 all stations Ready
 [Draft] ─────────────────▶ [Open] ───────────────────────────▶ [Armed]
                              ▲  │                                  │
                              │  │ race control overrides a station │ Companion START
                              │  ▼                                  ▼
                              │  (station: Ready / Excluded)    [Running]  ← master clock
                              │                                     │  referees tap finishes
                              │                                     │  race control: DNF / DNS / edit
                              │                                     ▼
                              │                       Companion FINISH (only when every team
                              │                       has a time, DNF or DNS)
                              │                                     ▼
                              └────── Open next round ◀──────── [Finished] (results locked,
                                       (blocked while ties          clock stopped/reset)
                                        are unresolved)
```

- **Open:**
  - Assignments for the round go out to referees, participants and the projector.
  - Stations with no teams this round are excluded automatically.
  - Every station starts with no table ready.
  - **Ready is per table.** The referee presses **Ready** for each of their tables that has a team this round (`stationReady` with `table`); each locks in. A station is Ready once every one of its tables that has a team is ready. `stationReady` without a table (an older referee page) readies all of the station's occupied tables at once. A table that is not the referee's, or has no team this round, is refused (`not_your_table`).
  - The station record keeps `readyTables` and the `ready` flag together. A station stored before per-table Ready, with `ready: true` and no `readyTables`, counts every one of its tables as ready.
- **Start gate:**
  - Companion **START** is refused until every active station is Ready (every occupied table ready) or overridden.
  - Race control can override any station: force it Ready (all its tables), set it back to not ready (clears all its tables), or exclude it.
- **Running:**
  - The server starts the master clock.
  - Referee devices show one button per team at their tables.
- **Finish gate:**
  - Companion **RACE FINISHED** is refused until every team in the round has a time, DNF or DNS.
  - **Auto-finish:** once every team in the running round has a result, the server sets `round.autoFinishAt` to now plus the event's **Auto-finish delay (seconds)** (default 30; never shorter than the referee undo window; 0 turns it off).
    - Any later tap, undo, penalty or correction, or a change to the event settings (the undo window or the delay), restarts the delay. If a team loses its result, the time is cleared.
    - Activating an event whose round is counting down (after **End event**, or after switching to another event and back) restarts the full delay from that moment, so time spent on another event never finishes the round at once.
    - When the time arrives the server runs the same finish as the button, logged with the actor "auto-finish". If that finish is refused, the time is cleared rather than retried.
    - The time is stored with the event and driven by the hub's single alarm, which also paces phone updates; the alarm is always set to the earlier of the two, so a countdown survives the server going idle.
  - Race control sees the list of teams still outstanding and can mark them DNF or DNS, or press **Finish** to stop that team's clock itself: the time recorded is the race clock at the press (a `setResult` with that time), for a referee who cannot tap.
  - When finish succeeds, the clock stops and resets, and the round's results are locked.
- **Next round:** race control reviews results, resolves any ties, then presses **Open round N** (§7.2).
  - It is refused (`blocked`) while a tie is undecided or a finished round is missing a result.
  - Matchups for the next round are generated from the locked results and published at that moment, not before.
- **Late corrections:**
  - Race control can edit a finished round's results until a later round that depends on them is opened.
  - Each round's line-up is saved when the round is opened, and bracket membership when the first bracket round is opened.
  - Bracket membership becomes final when the first bracket round is opened: bracket rounds not yet opened are built from those saved brackets, not re-seeded from corrected seeding results.
  - After a later round has opened, an edit needs an explicit **unlock**, which names any opened rounds that keep a line-up the corrected results no longer match, and warns when the saved brackets differ from those the corrected seeding would set.
  - Opened rounds are never rebuilt; rounds not yet opened are built from the corrected results.
  - If a correction leaves an undecided tie in an earlier round, opened rounds keep their races; only rounds not yet opened wait for the tie decision.

### 3.6 Tables per referee

- **Number of tables.** Set when the event is created and changeable in Setup (the **Tables** box) until setup is locked, with `setTableCount` (a whole number, at least 1; the console accepts 1–99). A change to a different number clears `groups`, `tableOf` and `brackets`, which were built for the old number; `suggestSetup` rebuilds them. Sending the current number changes nothing.

*Added after the first live test, at the user's request.*

- Admin chooses per event, in Setup, either **One referee per two tables** (the default, as in §3.1) or **One referee per table**. It can be changed until setup is locked.
- **One per table:**
  - Each referee station is one table.
  - The referee screen shows one big team button, with its Penalty button.
  - Head-to-heads are judged by two referees on the same master clock, so times still decide.
  - The layout rule about keeping head-to-heads on one station no longer applies.
- **Everything follows the choice:** station counts, the Ready/Start check, pairing, the referee screen and the console's station labels.
- **One per two tables:** the referee readies each of their two tables separately (§4); the station is Ready when both tables with a team are. With one table per referee a station has one table, so per-table and per-station Ready are the same.

### 3.7 Referee rotation

*Added at the owner's request, so a referee judges each team as few times as possible. Spec: `docs/superpowers/specs/2026-11-26-referee-rotation-fairness-design.md`.*

- **Setting:** `settings.rotateReferees`, changed with `setSettings` (allowed with setup locked; it must be true or false). It is on for new events. An event stored before rotation has no value, which means off.
- **Off:** every referee stays at the station they paired to (their *home station*), and nothing is saved.
- **On:** when a round is opened the server gives each station that has a team that round one referee, and saves the result with the event (`assignments`: round → list of referee device, name, station and tables). Table assignments of teams do not change.
  - The referees are the paired, not revoked referee devices at that moment. The hub passes them to the core as a roster (device, name, home station).
  - A saved round is never rewritten when a later round opens, and a round opened with rotation off has no entry: its referees were at their home stations. Changing the setting takes effect from the next round opened.
  - Opening a round never fails because of rotation, whatever the number of referees (including none).
- **Choosing who goes where.** The cost of a referee at a station is, for each team at that station: 1 for every earlier round that referee had the team, plus 3 more if they had it in the round before. The server picks the choice with the lowest total cost. It is an exact search (Hungarian algorithm), not an approximation.
  - Equal cost: the choice that moves the fewest referees away from the station they had in the round before (their home station if they had none).
  - Still equal: the smallest list of device ids, read in station order. So the same event and the same referees always give the same answer.
- **Fewer referees than stations with a team:** the lowest-numbered stations get the referees (chosen by the same cost rule). The others have no referee that round, as an unpaired station behaves: race control uses its own Ready, Finish, DNF and DNS controls.
- **More referees than stations:** the referees left over have no tables that round.
- **Finals split.** With one referee per two tables only. It applies to a race that decides a bracket (the race of a 2-team bracket, or the Winners race of a larger one) and to the Grand Championship, when the race has two teams and both are at one station. If a referee is left over, the station's referee keeps the lower table and the spare takes the higher one, so each team has its own referee. Such races are taken in station order while spares last; the spare with the lowest cost for that team is used (lowest device id if equal). The Others race is not split.
- **Permissions follow the round's assignment.** In a round with a saved assignment, a referee's tables are the assigned ones, wherever the device was paired:
  - Ready (`stationReady`) marks the referee's own tables at the assigned station. A table that is not theirs is refused (`not_your_table`). Without a table in the command, only their own tables are marked. In a split final each referee readies their own table, and the station is ready once both have.
  - Finish and penalty taps are accepted only for teams at the referee's tables (`not_your_team` otherwise).
  - A referee with no tables that round can do nothing: Ready answers `not_your_station` and taps `not_your_team`.
  - Undo and penalty notes stay tied to the device that made the tap. Its referee was assigned the team when the tap was made, and an assignment cannot change once the race has started.
  - In a round without a saved assignment (rotation off) the referee's tables are the home station's, as before.
- **The referee's view** lists the teams at the referee's tables for the current round. Its `station` says: `number` (the assigned station; the home station with rotation off; 0 with no tables), `tables`, `assigned` (false only when the round has a saved assignment and this referee is not in it) and `moved` (true when the referee is assigned to a different station from the one they had the round before, or from their home station if they had none; keeping one table of the same station, as in a split final, is not a move). A referee sees nothing about other referees.
- **Swap** (`swapReferees { a, b }`, race control only; `a` and `b` are referee device ids): exchanges the stations and tables of two referees in the open round. One of them may have no tables: that referee takes the other's place and the other has none. Any Ready already given at the tables involved is taken back. Refusals, in this order: no round is open (`round_not_open`: a swap is not possible once the race has started); the round has no saved assignment (`rotation_off`); the two are the same (`invalid`); either is not a paired referee (`not_found`); neither has tables (`not_assigned`). Earlier rounds are never changed.
- **The hub** is the only code that knows the paired devices.
  - With every command it passes the core the roster: the active event's paired, not revoked referee devices (device id, the referee's name, home station), in device id order. A device stored without a name is called "Referee {station}".
  - Each referee socket is tagged by device, and after every change each connected referee is sent their own view. A device that reconnects or reloads, or a hub that restarts, gives the same assigned tables, because they are read from the saved event.
  - **Pairing while a round is open or running:** the new referee takes the station they paired to for that round if it has teams and no referee (so a replacement device can take over mid-race); the assignment is saved in the same transaction as the device and its log entry. Otherwise (the station has a referee, or the race is over) they have no tables until the next round is opened.
  - **Revoking** takes the referee out of the open or running round's assignment, saved together with the revocation. Their tables then have no referee, and race control uses its own controls. Rounds that are over keep who judged them.
  - Race control's view also carries the current round's assignments (`assignments`, empty when none is saved) and the roster (`roster`). No other view does.

### 3.8 Fairness warnings

*Added at the owner's request, to tell race control when a pattern looks like favouritism. Spec: `docs/superpowers/specs/2026-11-26-referee-rotation-fairness-design.md`.*

- **A warning is a prompt to look, nothing more.** No warning ever blocks opening, starting or finishing a round, or any other action.
- **Computed, not stored.** The server works the warnings out from the saved event (taps, results, line-ups, assignments) each time race control's view is built. So they are the same on every console and after a restart, and a corrected result removes a warning that no longer applies.
- **Who judged a team in a round:** the referee whose saved assignment (§3.7) has the team's table that round. Without one (rotation off, an event stored before rotation, or a table whose referee was revoked), the device that made the team's finish tap. If neither exists, checks that need the referee skip that result.
- **The referee's name** comes from the saved assignments. A referee who was never in one (rotation off) has no name here: the warning's `referee` is null and its message says "A referee".
- **Which rounds count:** finished rounds, for every kind. The open or running round also counts for `repeat_team` and `final_one_referee` (known as soon as the round opens) and for `fast_time`, `close_finish` and `undo_changed_winner` (as results arrive).
- **The kinds.** The thresholds are constants in `packages/server/src/core/fairness.ts`, not settings.

  | Kind | Fires when | Constants |
  |---|---|---|
  | `fast_time` | A team's official time (penalties included) is at least 30.00 s faster than the fastest official time recorded before it, in any round, both taken at the hundredth as they are shown. "Before" goes by when each current result was recorded: its finish tap, or race control's entry. | `FAST_MS = 30_000` |
  | `referee_wins` | Over the finished bracket and Grand Championship races with two or more teams (seeding rounds are not counted, nor a race whose teams all had the same referee), each team a referee judged counts once per race: *better* if it finished ahead of the place its seeding total predicted within that race, *worse* if behind. Fires for a referee with at least 6 counted and better minus worse at least 4. | `WINS_MIN_RACES = 6`, `WINS_MARGIN = 4` |
  | `repeat_team` | A swap by race control (`swapReferees` marks both assignments `swapped`) gives a referee a team for the third time, or in two rounds running. One warning per referee and team, at the latest such round. A repeat in an assignment the app chose itself raises nothing: the app already picks the fewest repeats, so with too few referees it is nothing anyone can act on. Those repeats are still in the fairness report's assignments section. | `REPEAT_TEAM_TIMES = 3` |
  | `repeat_penalty` | A referee's device has penalty taps for the same team in 2 or more rounds. Undone and rejected penalties do not count; one still waiting for review does. | `REPEAT_PENALTY_ROUNDS = 2` |
  | `penalty_outlier` | Once 3 rounds are finished. The referees are everyone with tables in a finished round's assignment and every device that tapped in one. Counting each referee's penalty taps that stand: fires for a referee with at least 3 and more than twice the average per referee, or with none while the average is at least 2. Race control's own penalties are not counted. | `OUTLIER_FROM_ROUND = 3`, `OUTLIER_MIN = 3`, `OUTLIER_AVG_FOR_NONE = 2` |
  | `close_finish` | Two teams of one race, both judged by the same referee, have official times 0.50 s apart or less, both taken at the hundredth as they are shown (two teams showing the same time are 0.00 s apart). | `CLOSE_MS = 500` |
  | `undo_changed_winner` | A referee undid a finish tap in a race with two or more teams, every team of the race has a result, and the race's winner would be a different team had the undone tap stood (with the team's current penalties). | |
  | `final_one_referee` | Rotation is on, with one referee per two tables: a race that decides a bracket or the Grand Championship has two teams and one referee's assignment holds both tables, because no spare referee was free to split it (§3.7). | |

- **Each warning** has: `id`, `kind`, `round`, `referee` (name or null), `refereeId` (the referee's device id, or null), `teamIds` and `message`, one plain sentence for staff naming the referee, the team(s) and the round. `referee_wins` and `penalty_outlier` cover the whole event: their `round` is the latest finished round and their `teamIds` are empty.
- **Ids are stable.** An id is built only from the kind, the round, the referee's device id (`-` when unknown) and the sorted team ids, for example `close_finish:5:dev3:tA,tB`; `referee_wins:dev3` and `penalty_outlier:dev3` have no round. So an id does not change when unrelated results change.
- **Order:** newest round first, then kind (alphabetical), then id.
- **Dismissing** (`dismissWarning { id, note }`, race control only): the note is trimmed and must be 1–200 characters (`invalid`); the id must be a warning that applies now (`not_found`). The event saves who, when and the note (`dismissed`: id → `{ by, at, note }`), and the command is logged like any other. Dismissing again replaces the note. A dismissed warning that stops applying is no longer listed; if it applies again under the same id it is still dismissed.
- **Where they are visible:** only in race control's view, as `fairness: { open, dismissed }` (each dismissed warning carries its `dismissal`), and in the fairness report (§3.9). Never in the participant, projector, referee or Companion payloads.
- **Who entered what:** a result or penalty entered at the console saves who entered it (`by` on the override or tap), and a penalty removed or rejected at the console saves who did (`removedBy`). Records stored before this have neither.

### 3.9 Fairness report

- A third export of one event, beside CSV and JSON: `GET /api/control/export?event=<id>&format=fairness` (and the same under `/api/emergency/`), for the signed-in console only. It answers `text/csv` as a download named `race-to-feed-fairness.csv`, or 404 for an unknown event.
- **One file, three sections.** Each section is a title line, a header row, its rows, then one blank line. An event with nothing to report has the three titles and headers and no rows.
  1. **Warnings**: `kind,round,referee,teams,message,status,dismissed_by,dismissed_at,note`. Every fairness warning that applies (§3.8), in the same order as on the console. `status` is `open` or `dismissed`; the last three cells are filled for a dismissed warning only.
  2. **Race control edits**: `at,by,round,team,change`. Everything entered, changed or removed by hand at the console, in time order:
     - every result race control set: `time 3:41.20`, `DNF`, `DNS` or `cleared`;
     - every penalty race control added: `penalty added: {reason}`;
     - every penalty race control took away: `penalty removed` (one of its own, or a referee's it had approved) or `penalty rejected` (a referee's, at review).
     - A referee's own taps and undos are not listed. `by` is empty for records stored before the name was saved.
  3. **Referee assignments**: `round,referee,station,tables,teams`. One row per referee per round that has saved assignments (§3.7), by round then station. Rounds opened with rotation off have no rows.
- Team names in a cell are joined with `; `, as are tables. Times are ISO 8601 in UTC.
- Text is escaped as in the event CSV: quoted where needed, and a cell that begins with `=`, `+`, `-` or `@` gets a leading apostrophe so a spreadsheet does not read it as a formula.

### 3.10 Tournament format

*Added 2026-11-26 (`docs/superpowers/specs/2026-11-26-tournament-format-design.md`).*

The event's setup carries an optional `format`. Every field is optional, and a missing field (or a missing `format`, as on every event stored before this) has today's value, so such an event behaves exactly as before. The engine reads it only through `formatOf()`.

| Field | Values | Default |
|---|---|---|
| `seedingRuns` | 1, 2, 3 | 2 |
| `seedingRank` | `total`, `best`, `dropSlowest` | `total` |
| `brackets` | `placement`, `finals`, `none`, `knockout` | `placement` |

Combinations that are refused (`validateFormat()`, plain sentences): `best` with 1 run ("Best run needs at least two seeding rounds."), `dropSlowest` with fewer than 3 runs ("Drop the slowest needs three seeding rounds."), and any value not in the table.

**Seeding rounds.** Every seeding group runs `seedingRuns` times: all groups' run 1, then all groups' run 2, then run 3. That is `seedingRuns × groups` seeding rounds. Tables are the same for every run.

**Seeding rank.** Within a category, at the displayed hundredth, on official times:

- **Total time (`total`):** more finished runs ranks higher; then the lower total; then the better single run; then team order. (The standard rule of §3.5, for 1–3 runs.)
- **Best run (`best`):** the lower best single run ranks higher; a team with no finished run ranks last; ties by the lower total of finished runs, then team order.
- **Drop the slowest (`dropSlowest`):** each team's slowest run is ignored, and a run that was not finished (DNF, DNS) counts as that slowest run. So with 3 runs a team is ranked on its best two: more counted runs ranks higher (a team with two unfinished runs has only one to count), then the lower total of the counted runs, then the better single run, then team order.

The value a team is ranked on is its **seeding score** (`seedingScore()`): the total of its finished runs, its best run, or the total of its counted runs, cut to the hundredth; nothing when it has no run to count. Ranking and the score come from the same calculation, so they cannot disagree.

**Bracket format.**

- **Heats, then placement (`placement`):** §3.3 and §3.4, unchanged.
- **Finals only (`finals`):** each bracket races once, all its teams in one race named "{category} {tier} · Final"; the finishing order is the bracket's result, and a tie is decided by race control as in any race. One `finals` round per table-sized chunk of brackets, chunked and ordered exactly as the heats are (lower set, then upper set). There is no placement round. Bracket sizes follow the same rules as the standard format.
- **Seeding only (`none`):** no bracket rounds and no brackets in setup; a bracket left in the setup is a problem at lock ("Seeding only uses no brackets. Remove them, or suggest groups and brackets again."). Each category's final order is its seeding order. It is decided when every seeding round is finished and none of them is missing a result; until then every place is undecided. A seeding result cleared later makes the places undecided again until it is entered.
- **Knockout (`knockout`):** single-elimination brackets, described under "Knockout" below.

**Knockout.** *Added 2026-11-26. The rules are in `packages/engine/src/knockout.ts`, the round plan and the derived event; the tree that shows them is in §7.4 (phone), §7.5 (projector) and §7.2 (console).*

- **Draw.** Each bracket is a single-elimination draw from its seeding order (the bracket's members in seed order, saved when the first bracket round opens, like every format). Seeds are placed in the standard positions on the next power of two (`seedSlots`: 1, 8, 4, 5, 2, 7, 3, 6 for eight): 1 meets the lowest seed, and seeds 1 and 2 can only meet in the final.
- **Byes.** A position whose seed number is above the bracket's size is empty, so its opponent has a bye. Byes go to the top seeds (a bracket of 6 gives seeds 1 and 2 a bye; of 9, seeds 1–7) and happen only in the bracket's first stage. A team with a bye has no race and no table in that round, is never waited for, and is first in line in the next stage.
- **Stages.** A bracket of n teams has `knockoutStages(n)` stages: 1 for 2 teams, 2 for 3–4, 3 for 5–8, 4 for 9–16. Stages are counted from the final: stage 1 is the final (and the third-place race), 2 the semi-finals, 3 the quarter-finals, 4 the round of 16.
- **Rounds, aligned to the final.** The plan runs the stages from the earliest stage of the largest bracket down to stage 1, so every bracket's final is in the last knockout stage and a smaller bracket starts later. Each stage is one round per table-sized chunk: the brackets that race in the stage, in bracket order (category, then tier; there is no lower and upper set), chunked whole and greedily by the number of teams racing in that stage (two a race; the final stage counts the final plus the third-place race). A bracket with no race in a stage is not in that round, and a stage in which no bracket races has no round. A knockout round's spec is `{ round, kind: 'knockout', stage, bracketIds }`.
- **Races.** Every race has two teams. A race before the final has the role `ko` and the id `r{round}:{bracketId}:ko{stage}-{index}`, where `index` numbers the stage's races in that bracket from 1, top of the draw first (byes are not counted). The final has the role `final` and the id `…:final`; the third-place race has the role `third` and the id `…:third`. Entrants are listed in draw order (top first); the final lists the winner of semi-final 1 first, the third-place race the loser of semi-final 1 first. A race's fallback order is its entrants in seed order.
- **Who goes on.** A later race takes the winners of its two feeding races (or the team with the bye). The winner is the first of the race's ranking (§3.5), so a team that did not finish or did not start loses to one that finished. A tie is decided by race control and, like a missing result, blocks the next round until then.
- **Third place.** The two semi-final losers race for third place in the same round as the final. A bracket of 3 has one semi-final and no third-place race: the semi-final loser is third. A bracket of 2 is just a final.
- **Names.** "{category} {tier} · Final", "· Third place", "· Semi-final 1", "· Quarter-final 3", "· Round of 16 · 5", and "· Round 1 · 5" for anything earlier (rounds counted from the bracket's first stage). A stage with a single race in the bracket has no number ("· Semi-final", "· Quarter-final").
- **Placings.** A bracket's places are decided together, once its final, its third-place race and every earlier race are settled: the final's order (1st, 2nd), the third-place race's order (3rd, 4th), then for each earlier stage, the latest first, the teams knocked out in it, ordered by their official time in that stage at the hundredth (finishers first, then DNF, then DNS; equal times by seed, with no decision needed, since they were in different races). "Knocked out in a stage" is read from the races as they were opened: the teams that raced in it and not in the stage after. So after a late correction to an early race, the team that actually went on keeps its later place and every team is still placed exactly once.
- **Sizes.** Any size from 2 up to the number of tables ("size must be 2 or more", "larger than the N tables"); the 4–7 rule applies only to the standard and finals-only formats. A category with a single team is a bracket of one: it has no race, and its team wins the bracket by default as soon as the brackets are drawn (when the first round after seeding is reached; or, when the event has no such round, once every seeding round is finished with no result missing).
- **Suggestion.** "Suggest groups and brackets" proposes brackets of 8 by seed, folding a remainder of fewer than 4 into the last bracket (so 12 teams are 8 and 4, 19 are 8 and 11); a category of fewer than 8 is one bracket. It never proposes a bracket larger than the number of tables (`suggestBracketPlan` takes the table count as its last argument): with fewer than 8 tables the brackets are as large as the tables, and a remainder of fewer than 4 folds into the last bracket only while that bracket still fits the tables. Otherwise the remainder is a bracket of its own, and a single leftover team takes one team from the bracket before it, so no bracket has fewer than two. On 8 tables: 9 teams are 7 and 2, 10 are 8 and 2, 11 are 8 and 3, 17 are 8, 7 and 2. On 16 tables: 9, 10 and 11 are one bracket, 17 are 8 and 9.
- **Grand Championship.** Each category's top bracket winner races, as in every format.
- **Late corrections.** Opened rounds keep their saved line-ups (§4), so a corrected quarter-final never changes a semi-final that was already opened; rounds not opened yet are built from the corrected results.

**Category winners.** The engine reports each category's winner (`categoryWinners`): the first place of its standings, so the top bracket's winner, or the top seed in seeding only.

**Grand Championship** works with every format: each category's winner races. With seeding only that is each category's top seed, and the round is scheduled when at least two categories have a team; with one such category there is no Grand Championship round and the event ends after the last seeding round.

**Setting it (`setFormat`).** One setup command, `setFormat {format}`, for the console only, refused with `setup_locked` once setup is locked (so never after the first round has opened).

- The given fields are merged over the stored format; fields left out keep their value. Only the three fields are stored.
- The merged format is checked: a refused combination or an unknown value answers `invalid` with the sentences above in `detail`.
- Changing `brackets` to `none` also clears the brackets in the setup.
- It sends every phone a full snapshot, like the other setup commands.

**Suggest and lock.** "Suggest groups and brackets" (`suggestSetup`) builds the brackets for the chosen format: none for seeding only. `lockSetup` lists format problems with the group and bracket problems, and needs no brackets for seeding only. A format change that leaves the brackets wrong for the new format (for example seeding only, then back to finals only, which leaves none) is caught at lock with the usual list, and Suggest rebuilds them.

**Views.** The public and console views carry:

- `format`: the format with every field filled in.
- `seedRuns`: team → official time per seeding run, in run order, one entry per run of the format (nothing where the team has no time: not raced yet, cleared, DNF or DNS).
- `seedScoreMs`: team → its seeding score under the event's rule (nothing when it has no run to count). It is the engine's own value, so it always agrees with `seedRank`.
- `seedTotalsMs` stays the sum of the finished runs.
- `categoryWinners`: category → its winner, in every format.
- A round's `kind` can also be `finals` or `knockout`.
- `bracketMembers`: bracket → its team ids in seed order, as saved when the first bracket round opened (the knockout tree is drawn from it). In the public view it is `null` until a bracket round has been opened, like the matchups themselves; race control's view has it as soon as the brackets are drawn.

The small current-round update that public screens get while a round is open or running is unchanged and carries only `seedTotalsMs`, to stay within its size; `seedRuns` and `seedScoreMs` arrive with the next full snapshot (every round finish and every correction sends one).

**Champion.** Unchanged rules (§4.1) cover every format: the champion can be shown once the last round is finished with no pending penalty, undecided tie or missing result. In seeding only without a Grand Championship round the last round is the last seeding round, and the champion screen shows each category's winner.

**Projector.** After a finished `finals` round the automatic screen is the brackets, as after a placement round, and so it is after every finished `knockout` round, where the brackets screen is the knockout tree (§7.5). In seeding only it is never the brackets: after every seeding round, and after a Grand Championship that is not decided yet, it shows the seeding results, until the champion is decided or shown.

**Everything else.** Saved line-ups and saved bracket members work the same for `finals` and `knockout` rounds; seeding only saves no bracket members. Referee rotation splits a two-team final of a finals-only bracket as it does any final, and the final of a knockout bracket; the knockout third-place race and the earlier knockout races are not split. Exports list every round of any format. The "tables keep winning" fairness warning predicts each race from the value the teams were seeded on (the total under the standard rule, otherwise the seeding score).

### 4.1 Show champion and end the event

*Added after the first live test, at the user's request.*

**Show champion** (race control, once the last round is finished and no penalty is still pending review, so the announced champion is final):
- It is refused (`tie_undecided`, "Decide the tie before showing the champion.") while a tie in any race is undecided, with or without a Grand Championship: the screen names the champion and every final place. The console's button is greyed out in the same state.
- It is refused (`blocked`) while any finished round is missing a result (§3.5).
- Race control enters or confirms the bags-packed number. Leaving it blank keeps the previously saved number.
- The projector and **every participant phone** switch to a champion screen showing the Grand Champion, the bag total and the final standings by category.
- Without a Grand Championship, the screen shows each category's winner instead.
- **Hide champion** returns everyone to the normal screens. It is available whenever the champion is showing. The bag number can be changed at any time.

**End event** (admin, Events page, after a confirmation that warns if rounds remain unraced or penalties are still pending):
- The event is marked **Ended** and is no longer active.
- Its results are locked: no further commands are accepted for it.
- All referee devices are signed out and their pairings revoked.
- **Phones and the projector keep showing the ended event's champion and final results** (read-only) until admin activates another event. Exports keep working.
- Creating a new event while an ended event is on display does not activate it automatically, so the champion stays up until admin chooses **Make active**.
- **Make active** on an ended event reopens it, after a confirmation. Referee devices must be paired again. A round that was counting down to auto-finish (§4) restarts its full delay from the moment of reopening. If it was ended before its last round finished, the champion screen is taken down.

**Delete event** (admin, Settings → Events, *added at the event owner's request so test events do not pile up*):
- Every event except the active one has a **Delete** button in the event list; the active event must be ended (or another made active) first. An event that was created but never used can be deleted too.
- A confirmation sheet, **Delete {name}?**, says the deletion is permanent and cannot be undone, offers that event's CSV, JSON and fairness report exports (§3.9), and asks for the event's name. **Delete event** stays disabled until the typed name (trimmed) matches the event's name exactly.
- The hub command is `deleteEvent { eventId, confirmName }`, admin only. Refusals, checked in this order: unknown event → `not_found` "No such event."; the active event → `event_active` "End this event or make another one active before deleting it."; `confirmName` (trimmed) not exactly the event's name → `name_mismatch` "Type the event's name exactly to delete it." A refusal shows in the sheet, which stays open.
- In one storage transaction the hub deletes the event and every audit, device and pairing-code row for it, then writes one audit row with no event (actor, `deleteEvent`, `{ eventId, name }`) so a trace of the deletion survives. Its exports then answer 404.
- If phones and the projector were showing the deleted event (the last ended one), they fall back to the next most recent ended event, or to the no-event screen when none is left. No sockets are closed: referee devices only ever sign in to the active event, which cannot be deleted.

---

## 5. Timing

- **One master clock per round,** owned by the server and started by Companion START.
- **Times are stamped on the referee's device and synced to the server:**
  - Each referee device continually estimates its clock offset from the server, NTP-style: repeated ping round trips over the live connection, using a median of recent samples.
  - A tap is recorded as `device_time_at_touch + offset`, and elapsed time is that minus the round start.
  - If a tap is made while Wi-Fi is down, the device **queues** it and sends it with its original timestamp when the connection comes back. The result is unaffected.
  - **A tap belongs to the round it was made in.** `tapFinish` and `tapPenalty` carry the device's own tap id (`clientTapId`) and the round (`round`):
    - A tap the server already has from that device for that team and kind (same `clientTapId`), in any round and whether or not it was since undone, removed or rejected, is a resend: it is answered as a success and creates nothing.
    - Otherwise a tap whose `round` is not the current round is refused with `round_over` ("That tap was for round 1, which is over.") and creates nothing. The device drops it from its queue and shows the refusal.
    - A command without `round` (a referee page loaded before this rule) is treated as made in the current round, as before.
- **Precision and display:**
  - Times are stored in milliseconds and displayed to hundredths (`m:ss.hh`).
  - Ties are compared at the displayed precision (hundredths).
- **Validation:** taps before the start or after finish are rejected. Each team gets one active time; the first tap wins unless it's undone or edited.
- **Head-to-head across stations:** every time is on the same master clock, so a race spanning stations (3- or 4-team races) needs no special handling.

### 5.1 Time penalties

- **What it does:** a referee can flag a team for an infraction with one tap. The tap adds **no time**; race control sets the penalty's real length when it reviews it (§5.2).
  - Taps **stack**: three taps are three flags, each reviewed on its own.
  - Each tap needs a single press, with no confirmation dialog.
- **Official time = raw finish time + all penalties.** The official time is what counts everywhere:
  - finish order within a race
  - head-to-head winners
  - exact-tie detection
  - seeding totals and seeding rank
- **When a referee can add one:** from **START** until the round finishes (race control presses **RACE FINISHED**, or auto-finish fires, §4). That includes before or after the team's finish tap, since infractions are often spotted at the end. Each penalty tap restarts the auto-finish delay, so referees have that long after the last finish.
  - After the round is finished, only race control can add or remove penalties. This is subject to the same late-correction rules as times (§4).
- **On/off switch:** one **event-wide** switch on race control.
  - Flipping it shows or hides the penalty buttons on every referee device **immediately**, even mid-race.
  - Turning it off **never removes** penalties already given. Race control can still remove those one at a time, and can still add penalties while the switch is off.
  - The switch is off by default for a new event.
- **Corrections:**
  - Each penalty tap has the same ~10-second referee **undo** as a finish tap (§6).
  - After that, only race control can remove a penalty.
  - Every add, undo and removal is audit-logged with station, device and time.
- **DNF and DNS teams:** penalties are still recorded for them but don't change their ranking. DNF and DNS always rank after finishers.
- **Offline taps:** a penalty tapped during a Wi-Fi dropout is queued like a finish tap. It counts if it is sent before RACE FINISHED; race control can see queued items as outstanding.

### 5.2 Penalty notes and review

*Added after the first live test, at the user's request.*

- **A referee's penalty tap adds no time.** It flags the team as **pending: under review** (shown beside its time on the participant page, console results and referee device, and as "under review" on the projector's finish ticker). Times, places and brackets change only when race control approves a reason. Penalties stored by earlier versions keep the amounts they have.
- **As soon as the penalised team has finished,** a referee who tapped penalties sees a **Penalty notes** card for each one, without waiting for the round to finish:
  - While the race is running, a penalty's card appears as soon as its team has a result (the referee taps the team's finish button, or race control records DNF, DNS or DQ). It does not wait for the **Undo** countdowns, which keep working alongside the card. A penalty tapped after the team finished gets its card straight away. If the finish is undone, the team has no result and the card goes away until the team finishes again (anything typed into it is lost); undoing the penalty removes its card. The cards sit below the team buttons, so the finish buttons don't move.
  - Once the round is finished, every pending penalty the device gave has a card. A card the referee is filling in when the round finishes keeps its reason and note.
  - They pick the closest reason from the penalty list and may add a short note, then **Send**.
  - The referee's pick and note go to race control only. Race control's review panel lists the penalty as soon as it is given and shows the referee's reason when it arrives.
  - The server accepts a note for a penalty in the running round only once its team has a result (otherwise `team_not_finished`, "Add the note once this team has finished."). A note changes the round's taps, so it restarts the auto-finish countdown, which gives the referee time for the next note.
- **Race control reviews each pending penalty** with the referee's pick pre-selected, and chooses the official reason from the list:
  - **Approve with a timed reason:** the penalty becomes that reason's time (for example +15s).
  - **Approve with a DQ reason:** the team is disqualified from that race. It ranks like a DNF and shows as **DQ**.
  - **Reject:** the penalty is removed and results update.
  - A decision can be made without a referee note.
- **The next round can't be opened while any penalty in the finished round is still pending.**
- **Penalties race control adds itself** take their reason when added and count as approved immediately.
- **Changing a decision on an earlier round** after a later round has opened follows the usual unlock confirmation (§4).
- **Approved reasons are shown to everyone:**
  - On phones: `3:46.20 (incl. +15s · Interference)` or `DQ · {reason}`.
  - On the projector: just `+15s` or `DQ`.
  - The CSV and JSON exports include the reasons and the referee notes.
- **The penalty list** (name, plus a time or DQ) is managed by admin in Settings. It can be edited at any time; already-decided penalties keep their recorded reason and time. New events start with:

  | Reason | Penalty |
  |---|---|
  | Fluffing Bags | +5s |
  | False Start | +10s |
  | Interference | +15s |
  | Unsafe Conduct | +30s |

---

## 6. Corrections and audit

- **Referee undo:** a referee can undo their own tap (a finish or a penalty) for about **10 seconds**. The window length is configurable.
- **One undo per tap:** each of the referee's recent taps has its own undo row, including taps that reached the server after a dropout. A failed undo is reported and the row stays until the window ends.
- **After the undo window:** only **race control** can edit a time, clear it, set DNF or DNS, or add or remove a penalty.
- **Audit log:** every state change goes in an append-only log, viewable in race control:
  - taps, penalties, undos, edits, overrides, tie decisions, penalty-switch changes, round transitions and logins
  - each entry records who, which device, when, and the old and new values
  - **Delete event** (§4.1) is the one exception to append-only: it removes the deleted event's log with it, leaving a single `deleteEvent` entry that belongs to no event.

---

## 7. Pages

All page and UX design follows the `anthropic-skills:apple-design` skill (the user's request).

**Decided for the pages (plan 3):**

| Address | Page |
|---|---|
| `/` | Participants |
| `/projector` | Projector. `/projector/?bg=transparent` is the same screen with no page background and a text shadow, for a video mixer (an OBS browser source) to composite over its own background |
| `/ref` | Referees (race control's pairing QR code opens `/ref?code=…`) |
| `/control` | The race control console, **PRC** (Packing Race Coordinator): one role, all six sections (Race Control, Teams, Setup, Referees, Settings, Log). Signed in through Cloudflare Access (§9) |
| `/emergency` | The emergency sign-in: one password box, then the same console. Not linked from any page (§9) |

- **Look:** clean Apple style with automatic light/dark mode and one accent colour, the spreadsheet's display red `#D71920`. The projector uses a dark theme, and the Gold/Silver/Bronze/Copper/Tin tier colours are kept.
- **Names:** the app is **PRC**, short for **Packing Race Coordinator**. The console's sidebar brand reads `PRC` (with the full name as its tooltip) and the console tabs are titled `PRC · Race Control` and `PRC · Emergency sign-in`. The participant, projector, referee and not-found pages' browser tabs are titled `PRC`, `PRC · Projector`, `PRC · Referee` and `Not found · PRC`. Race to Feed is the event: the pages themselves show the active event's name (the participant header falls back to `PRC` before an event has loaded).
- **Referee page:** adapts to phones (team buttons stacked) and tablets (side by side).
- **Brackets on phones:** a card list per bracket, with a toggle to the classic bracket diagram.
- **Finding the site:** a QR code on the projector's welcome and table screens.

### 7.1 Console: setup and event management

Race control and admin are one role. Everyone signed in to the console has every section and every command. The log names each console action by the signed-in email (or `emergency sign-in`); `admin` survives only as the role value in code.

The sidebar lists six sections: **Race Control** (hash `#race`), **Teams**, **Setup**, **Referees** (hash `#devices`; the page is headed "Referees"), **Settings** and **Log**. There is no Events section: an old `#events` link opens Settings. The bottom of **Setup** has a **Screen links** panel: the full address of each screen (participants, projector, transparent projector, referee, race control) in a read-only box with a Copy button.

**Settings** holds, top to bottom: the **Events** panel (create an event, the event list with Active/Ended, Make active, End event with its confirmation, the CSV, JSON and **Fairness report** (§3.9) export links, and Delete on every event but the active one, behind a type-the-name confirmation (§4.1)), then the active event's own settings, the penalty list, Companion keys, and **Appearance**. Settings works with no active event, so events can be created and activated there. The Events panel is a disclosure (`<details>`): its summary reads **Events**, with a secondary line **Active: {event name}** while an event is active. It is open when there is no active event and folded away when there is one; that default is decided when Settings mounts and again only when the console gains or loses its active event, so view updates never fold it under the user. Folded, nothing inside is reachable by keyboard or screen reader.

**Appearance** is a per-browser preference for the console and the emergency console only: Automatic (follow the device), Light or Dark, as a three-way segmented control. It is kept in `localStorage` under `prc.theme` (`auto` | `light` | `dark`; missing or unreadable means `auto`) and applied before the first paint by setting `theme-light` / `theme-dark` on `<html>` (`auto` sets neither). It never reaches the server; phones, referee devices and the projector are unaffected.

- Manage events (Settings → Events), import and edit teams, set the venue table count.
- Edit seeding groups and table assignments.
- **Tournament format** (§3.10): a panel in **Setup**, above the Referees choice. All of its wording lives in `packages/web/src/lib/formatCopy.ts`.
  - Heading "Tournament format" and the line "Choose how the event runs. You can change this until setup is locked."
  - Four groups of choices, each a radio group of cards: **Preset**, **Seeding rounds** (1 round, 2 rounds, 3 rounds), **Seeding rank** (Total time, Best run, Drop the slowest) and **Bracket format** (Heats, then placement; Finals only; No brackets; Knockout). Every card shows its name and, under it, one or two sentences saying what it does. The explanations are always visible, never tooltips. Cards sit side by side while the panel is wide enough to read them, then four become two by two and three stack.
  - **Presets**: Standard (2 rounds, total time, heats then placement), Short (1, total, finals only), Seeding only (2, total, no brackets), Knockout (2, total, knockout). The preset whose three settings match is selected; when none matches, a **Custom** tag shows beside the group's heading and no preset is selected.
  - **Commands**: every change is one `setFormat`. A preset sends all three fields; a setting sends only itself. Choosing what is already chosen sends nothing. The choice shows as soon as it is pressed and goes back if the server refuses, with the refusal under the choices.
  - **A rank rule that the number of seeding rounds does not allow** is disabled, with the reason as a tag on its card: "Needs at least two seeding rounds." (Best run) or "Needs three seeding rounds." (Drop the slowest). Choosing a number of seeding rounds that the current rule does not allow sends the rule with it (`{ seedingRuns, seedingRank: 'total' }`, one command, as the server checks the merged format) and shows "Seeding rank changed to Total time." (`role="status"`) until the next change.
  - **Knockout** (the preset and the bracket format) is chosen like any other. The summary counts a knockout setup's rounds and races.
  - **Locked**: every choice is disabled and the panel says "Setup is locked. Unlock it to change the format."
  - **Brackets from another format**: when the brackets in the setup do not fit the chosen bracket format but would fit another one, and groups exist (Suggest has been pressed), the panel shows "Your brackets were set up for a different format. Press Suggest groups and brackets to rebuild them."
  - **Summary**, at the bottom, headed "This setup makes" (`aria-live="polite"`): the rounds and races of the setup as it stands, for example "9 rounds, 150 races". A race is one start on the clock: each team's seeding run, each heat, each placement race, each final, and the Grand Championship. Before that can be counted it says what is needed: "Add teams to see how many rounds this makes." or "Press Suggest groups and brackets to see how many rounds this makes."
  - In seeding only, with no brackets in the setup, the **Brackets** list shows "Seeding only uses no brackets." in place of the bracket editors.
- The messages raised by **Suggest groups and brackets** and **Lock setup** (the list of problems) show directly under those buttons, above the Tournament format panel.
- Set the referee undo window and the auto-finish delay.
- **Rotate referees each round** (§3.7): a switch in the event's panel, under Time penalties, sending `setSettings { rotateReferees }`. A missing value shows as off. A footnote says it takes effect from the next round opened.
- Edit the bracket plan and set Grand Championship eligibility. Under each category's brackets the editor says which sizes the bracket format takes: "A bracket has 4 to 7 teams.", or in knockout "A knockout bracket has 2 to {tables} teams (as many as there are tables)." The size fields stop at that largest size.
- Manage the Companion API keys. (Who may sign in is managed in Cloudflare, not in the console.)
- Type the **bag total** shown on the champion screen.

### 7.2 Console: running the race
- **Grid of every station:** each shows not ready / Ready / excluded, the teams with their times and status, and any overrides. A two-table station with one table ready reads "1 of 2 tables ready" (still not ready; the Start count counts stations not fully ready).
- **Race Control page header:** round title, state, master clock, a status line (`role="status"`) and **one large action button** that always shows the next step. It is about three times a normal button (min-height 6rem, min-width 16rem, title-sized text). It **pulses** (a 2-second scale-and-glow loop, off under `prefers-reduced-motion: reduce`) only when pressing it will work and is the expected next step; it never pulses while the server would refuse. A refused command's message shows under the header until the round moves on (its number or phase changes); a refusal that arrives after that, such as a Finish now that lands just after auto-finish, is not shown. The first matching row wins:

  | Condition | Button | Enabled | Pulses | Status line |
  |---|---|---|---|---|
  | Champion showing | Hide champion | yes | no | Champion is showing |
  | Running, N teams outstanding | Finish now | no | no | Racing — waiting on N team(s) |
  | Running, none outstanding, auto-finish set | Finish now | yes | no | All teams in — finishing in S s (seconds left, rounded up, never below 0) |
  | Running, none outstanding, no auto-finish | Finish now | yes | yes | All teams in |
  | Open, N stations not ready | Start | no | no | Waiting on N referee(s) to be ready; Waiting on N table(s) to be ready with one table per referee (§3.6) |
  | Open, all ready | Start | yes | yes | All referees ready; All tables ready with one table per referee |
  | N penalties pending review | Open round M (Show champion after the last round) | no | no | Waiting on N penalty/penalties to be reviewed |
  | Undecided tie | as the row above | no | no | Waiting on a tie to be decided |
  | A finished round is missing a result (§3.5; the blocker itself is shown on the page) | as the row above | no | no | Waiting on a missing result to be entered |
  | Last round finished | Show champion | yes | yes | Event complete |
  | Setup not locked (only before round 1) | Open round 1 | no | no | Waiting on setup to be locked |
  | Otherwise | Open round M | yes | yes | Ready to open round M |

  M is the current round plus one. Show champion opens the bag-count sheet first. Finish now does not pulse while the auto-finish countdown runs: the race finishes itself.
- **Referees on the station cards (§3.7).** Only while the current round has saved assignments (`assignments` not empty); otherwise the cards are exactly as above.
  - Under the station's label, the name of its referee. When two referees share the station (a split final) each is shown with their table: "Dana (T1)", "Sam (T2)".
  - A station that has teams and no referee reads **No referee**. A station without teams shows nothing extra.
  - **Swap**, while the round is open only: each name has a **Swap…** button (accessible name "Swap {name}"). It opens, in that card, a list of the other paired referees from `roster` (accessible name "Swap {name} with"; "Lee — Tables 3 & 4", or "Sam — no tables" for one without tables this round) with **Swap** and **Cancel**. Swap is disabled until a referee is chosen and sends `swapReferees { a, b }`. One swap is open at a time; it closes on success, and when the round or its phase changes. A refusal shows in the card.
- **Fairness panel (§3.8)**, after "Penalties to review" and styled like it. It is shown when there is any open or dismissed warning, and always while `settings.rotateReferees` is on.
  - Heading "Fairness" with a count badge of open warnings, then the line "These are prompts to take a look, not proof of anything."
  - Each open warning is a card: a short title for its kind, a secondary line "Round {n} · {referee}" (the referee is left out when unknown; `referee_wins` and `penalty_outlier` read "Whole event" in place of the round, as they cover the whole event), then the server's `message` as it is.

    | Kind | Title |
    |---|---|
    | `fast_time` | Very fast time |
    | `referee_wins` | One referee's teams keep doing well |
    | `repeat_team` | Same referee, same team |
    | `repeat_penalty` | Same referee, same team penalised again |
    | `penalty_outlier` | Unusual number of penalties |
    | `close_finish` | Close finish |
    | `undo_changed_winner` | Undo changed the winner |
    | `final_one_referee` | Final judged by one referee |

  - **Dismiss** reveals a required **Note** (at most 200 characters) with **Cancel** and **Save**; Save is disabled while the note is blank and sends `dismissWarning { id, note }` with the note trimmed. A refusal shows in the card. Dismiss is not offered once the event has ended (`ended`).
  - With no open warning: "Nothing to look at."
  - Dismissed warnings are in a folded list, "Dismissed (n)": the message, the title and round, then the note, who dismissed it and when.
- **Fairness count in the sidebar:** the number of open warnings as a badge beside **Race Control**, on every section (accessible name "{n} fairness warning(s)"); hidden at 0.
- **"Waiting on N teams" list** with one-click Finish (while running: records the race clock at the press), DNF and DNS.
- **Time penalties on/off switch** in Settings, in the event's panel (event-wide, takes effect immediately, §5.1).
- **Penalties per team:** each team shows `raw + penalties = official`, with buttons to add or remove a penalty.
- **Tie resolution**, time edits and clears, and the audit log.
- **Rename a team** at any time during the event (e.g. a misspelling spotted on the projector). Other setup changes stay locked once setup is locked.
- **Open round N** (the action button), with a results review first.
- **Referee pairing:** a QR code per station, a paired-device list, and revoke. With `settings.rotateReferees` on the station column is headed **Starting station**; while the current round has saved assignments each referee's row adds "this round: {tables}" or "no tables this round".
- **Projector override:** pin any screen (e.g. the champion reveal) or return to automatic.
- **Backup controls:** Start and Finish now (the action button) follow the same gates as Companion.
- **Brackets** (knockout only): a panel on Race Control, above Results, with every bracket's knockout tree (§7.4), by category. It appears as soon as the brackets are drawn, before the first knockout round is opened, and the next round's teams are already in their places once the round before is settled. Results keeps listing every race by round.

### 7.3 Referee (paired device, QR)
- **Bring your own device.** Referees use their own phone or tablet; nothing is handed out. "Device" below means that phone or tablet.
- **Pairing asks for a name.** Opening a station's QR link shows one field, **Your name**, and a **Start** button; submitting pairs the device. The name is trimmed and must be 1–40 characters. It is checked before the code is used, so a missing name never spends the code.
- **Auto-lock notice after pairing.** Referees use their own phones, and a phone that locks mid-race delays the tap and adds time to the team's result. After a pairing succeeds in this page load, the page shows "Keep your screen on": why it matters, where to turn off auto-lock (and Low Power Mode / Battery Saver) on iPhone/iPad and Android, and that the page's own screen wake lock does not work on every device. A checkbox "I've turned off auto-lock on this device" enables **Continue**; only then does the live page (and its connection) start. Continue stores `r2f.autoLockAck` (the station number) in `localStorage`; it is cleared when a new pairing is submitted or the device is signed out. A device that loads already paired goes straight to the live page whether or not the key is stored, so the notice shows once per pairing (and, with storage blocked, still only after a pairing).
- The name labels the device in race control's Referees list ("{name} — {station tables}") and the log's actor ("{name} (station {n})"). Devices paired before names existed keep "referee station {n}".
- Shows the referee's table numbers for the current round (`station.tables`, §3.7) and the current round's teams at those tables.
- **Rotation (§3.7).** With rotation off none of this appears.
  - **No tables this round** (`station.assigned` false): the header reads "No tables this round" in place of the table numbers, and the page shows only "You have no tables this round. Stay nearby: race control may still need you." There are no buttons, in any phase.
  - **Go to your tables** (`station.moved` true while the round is open): in place of the Ready buttons the page shows a large heading, "Round {n}: go to {Table 7 | Tables 7 & 8}", and one big button, **I'm there**. Pressing it shows the Ready buttons. It is not a new gate on Start: Ready stays the gate.
  - The press is remembered as `{round}:{station number}:{tables}`, in the page's state and in `sessionStorage` under `r2f.there`, so a reload does not ask again and a swap by race control (a new station or tables in the same round) asks again. With storage blocked it is remembered for the page load only.
  - Once the race is running the notice is never shown: the tap buttons appear whether or not **I'm there** was pressed.
- **Ready, per table.** With one team at the station (one table per referee, or only one of two tables in use) there is one big **Ready** button that readies that table. With two teams there are two Ready buttons, side by side on a tablet and stacked on a phone (the same breakpoint as the team buttons), each reading "Ready" with "Table {n} · {team}" under it (accessible name "Ready: Table {n}, {team}"). A pressed one becomes "Ready ✓" for its table while the other stays pressable; when every table is ready the page shows "Ready ✓ / Waiting for the start". Once pressed a table stays ready; only race control can clear it.
- While running, one large button per team. A tap shows that team's time and an **Undo** countdown.
- **Below the team buttons** is one area holding the **Undo** rows (newest first) and then the **Penalty notes** cards; nothing floats over the page. On a tablet the area has a fixed height and scrolls; on a phone the buttons keep their own height and the page scrolls. Either way the finish buttons never move or change size when an Undo row or a card appears or goes.
- **Penalty button** (only while penalties are switched on): a separate, smaller **Penalty** button under each team.
  - It is placed and coloured so it can't be mistaken for the finish button.
  - It's available from START until RACE FINISHED, before or after the team's finish tap.
  - It shows the number of penalties flagged (e.g. **×2**). Each penalty tap has its own **Undo** countdown.
- **Penalty notes** (§5.2): during the race, a card for each pending penalty this device gave appears below the team buttons as soon as that team has a result (its finish button is tapped, or race control marks it DNF, DNS or DQ). After the round, every pending penalty has a card. A half-written card survives the round finishing.
- Shows connection status and any taps queued offline.
- A saved tap the server refuses for good is always reported ("The saved tap for {team} in round {round} was refused: {reason}"), even if the round or connection changed while the answer was in flight. A tap refused because its round is over (`round_over`, §5) reads "The saved tap for {team} was not counted: That tap was for round {round}, which is over."
- **One live tab per device.** The page holds the Web Lock `r2f-referee`. A second tab shows "The referee page is already open in another tab on this device" and a **Use this tab instead** button, and creates neither the live connection nor the tap queue. The button posts `takeover` on `BroadcastChannel('r2f-referee')`; the holder releases the lock and shows the same message, and the new tab acquires it. Without Web Locks or BroadcastChannel the page behaves as before.

### 7.4 Participant (public, read-only, phone-first)
- **Team search** highlights the team in every bracket and list where it appears.
- The phone **remembers the team** (local storage), so later visits open straight to it.
- **"Your next race":** round, table number and opponent(s). Before the round is opened it says "waiting for Round N to finish".
- **Brackets:** all categories and tiers, live-updating.
  - **Finals only** (§3.10): each bracket is one stage, "Round {n} · Final", holding its one race in seed order with each team's place; there is no "Final places" stage, as the race's finishing order is the result.
  - **Knockout** (§3.10): each bracket is a **tree** (`buildBracketTrees` in `bracketModel.ts`, `KnockoutTree.tsx`), and there is no Cards / Diagram choice.
    - One column per stage, left to right, ending with the final. Headings: "Round 1", "Round of 16", "Quarter-finals", "Semi-finals", "Final" (singular when the bracket has one race in the stage). Lines join each pair of matches to the match they feed. The **Third place** race is under the final, with its own heading.
    - A match is a card of two rows: seed, team name, and the team's official time once it has one (short form: "3:46.20 (+5s)", "DNF", "DNS", "DQ"; "—" while the round is open). When every team in the race has a result the winner's name and time are bold.
    - A **bye** shows the seeded team on one row and "Bye" on the other, and the team is already in the next column.
    - A place whose team is not known yet reads "Winner of Quarter-final 2", or "Loser of Semi-final 1" in the third-place race, in the secondary colour. A team moves into its next match when that match's round is opened (matchups are published when a round opens, §4), not when its race finishes.
    - A bracket of one team shows the team and "No race: the only team in this bracket".
    - The tree is wider than a phone and scrolls sideways inside its card. The viewer's team is highlighted in every match it is in, and its current match (the latest it has reached) is scrolled into view when the tab opens. Long names wrap to at most three lines.
    - Before the first knockout round opens the tab reads "Brackets appear once seeding is done and the first bracket round opens.", as in the other formats.
  - **Seeding only**: the tab is named **Standings**. Until every place is decided it reads "Standings are decided by seeding" and that the final standings appear when every seeding round is finished; then it lists the final standings by category, the viewer's team highlighted. The search line reads "See your table, your times and where you stand."
- **Seeding** (My team): a list (`aria-label="Seeding"`) of **Rank in category**, one row per seeding run of the format ("Run 1", …) and the value the team is ranked on, labelled as on the projector (§7.5): "Total", "Best run" or "Best two"; with one seeding run, a single "Time" row and no run rows. A run with no time is "—". A run "drop the slowest" leaves out is struck through, followed by "not counted" for screen readers.
- **Race times:** the team's and its opponents' official finish times, plus seeding totals and rank within category. Approved penalties are marked (e.g. `3:46.20 (incl. +5s · Fluffing Bags)`), and a time with a penalty awaiting review reads `3:41.20 · pending: under review`.
- **Full schedule:** every team's table for the current round.

### 7.5 Projector (public URL, full-screen)
- **Changes screen automatically by round state:**

  | State | Screen |
  |---|---|
  | Open | Table assignments for the round, with a ready dot per team |
  | Running | Large master clock alone until the first team has a result; then a smaller clock at the top and the team list under it, headed "Preliminary times" |
  | Finished | Updated seeding results, brackets or standings |
  | Grand Championship finished | The champion, once it is decided: no penalty pending review, no undecided tie and no missing result (§4.1); brackets until then |
  | Event complete | Final standings, then the champion |

- **Team rows and status dots.** The tables screen and the running screen share one row: table number, a status marker in a fixed 1em slot just left of the team name (so names line up; plain dots are about 0.6em, centred on the name), and the race label or result at the right. The dot is one component taking a status, each with `role="img"` and a label:

  | Status | Look | Label | When |
  |---|---|---|---|
  | not ready | solid red (danger) | Not ready | round open, the team's table not ready yet |
  | ready | solid green (success) | Ready | round open, the referee pressed Ready for that table (or race control readied the station) |
  | racing | solid green | Racing | race running, the team has no result yet |
  | finished | a checkered-flag tile: about 1em square with slightly rounded corners, a bold 3×3 white and near-black checkerboard, 1px light border | Finished | race running, the team has a time, DNF, DNS or DQ |

- **Tables screen (open):** rows in table order. Each table's dot follows its own table, so the room can see which tables the start is waiting on. An excluded station's teams show not ready. Readiness travels in the small current-round update public screens get (at most one a second), so a dot turns green within about a second of the Ready.
- **Running screen:** while no team has a result, the big master clock alone, as large as before. When the first team has a result (time, DNF, DNS or DQ), the clock shrinks and moves to the top (a 600 ms transition on a class change, so it keeps ticking; none under reduced motion) and the list fades in below it under a small "Preliminary times" heading (`aria-label="Teams"` on the list). The list then stays for the rest of the round, even if every result is undone; a projector that loads mid-race with results in starts in this layout. Every team of the round is listed, two columns filling down the first column first: teams with a time, fastest first (official time at the hundredth, the precision the engine ranks at, via the engine's `hundredths`; ties by table), then DNF (DQ counts as DNF), then DNS, each by table, then teams still racing by table. A finished team shows its short result at the right (`3:41.20`, `3:46.20 (+5s)`, `3:41.20 · under review`, `DNF`, `DNS`, `DQ`); a team still racing shows its race label. Rows are keyed by team, so they move rather than being re-created. Two columns of 13 rows (26 tables) fit at 1920×1080. On this list the row's red number is the **finishing position** among teams with a time (times equal at the hundredth, i.e. showing the same time, share one: 1, 1, 3; blank for DNF, DNS, DQ and teams still racing), and the table follows the name as a grey "(T1)" tag that is never truncated. The tables screen keeps the table as its red number.
- **The team list scales with the round.** On both screens the rows' text (table number, marker, name and the right-hand text together) grows to share out the height left under the header over the rows per column (`ceil(teams / 2)`, passed to CSS as `--rows`), but never past what fits the round's longest name and right-hand text on one line in a column (passed as `--name-ch` and `--right-ch`), and never past 3× the base size. It is never smaller than the base size, so a full 26-table round looks as before; a name too long even at the base size ends in an ellipsis. One or two teams keep the same two-column layout, at the largest size that fits.
- The participant phone page shows no dots.
- **Brackets screen in knockout** (§3.10): the knockout tree (§7.4), one bracket a page, titled "{category} {tier}"; with several brackets the pages turn every 12 seconds, in category then tier order, and the line above the title reads "Brackets · 2 of 3". The tree fills the screen without scrolling: its type is the largest at which the first stage's matches fit the height and the bracket's longest name fits a column on one line (between 0.8rem and 2rem), so a 16-team bracket fits 1080p. In the other formats the screen is unchanged: a category a page.
- Race control can **pin** any screen, which overrides automatic mode. In seeding only (§3.10) the console's menu does not offer **brackets**; a brackets pin made another way shows the standings screen.
- **Seeding results screen.** Per category, the teams that have something to rank on, in the server's seed order (`seedRank`) once it exists and by seeding score before that (the rank shown is then the position in the list). Each row: rank, name, one column per seeding run of the format, then the seeding score, all to the hundredth. A heading row names the columns: "Run 1", "Run 2", "Run 3", then "Total" (`total`), "Best run" (`best`) or "Best two" (`dropSlowest`). With one seeding run there are no run columns and the one column is headed "Time". A run with no time is "—"; a run "drop the slowest" leaves out (the slowest finished run once every run has a time; nothing while a run is missing, as the missing run is the slowest) is struck through with "not counted" for screen readers.
  - Categories share the screen's width, three at most per row. The run columns are shown only where a category's column is wide enough for them beside the name (about 30em for two runs, 36em for three: one or two categories at 1080p); narrower columns show the seeding score alone.
  - **Live values.** Runs and scores are worked out in the page from the rounds' own races (`seedRunsOf`, `seedingLine`, `seedingTable` in `lib/selectors.ts`) with the engine's `seedingScore`, never from the snapshot's `seedRuns`/`seedScoreMs`: the small live update replaces the current round's races, so the phone and the projector stay current and agree with the server's rule. The i-th seeding round is run `floor(i / groups)`.
- **Standings screen in seeding only:** until every place is decided the heading is "Standings" with the line "Standings are decided by seeding"; then "Final standings".
- **Champion screen:** the Grand Champion's second line is "{category} {top tier's name} Bracket winner", or "{category} top seed" in seeding only. Without a Grand Championship, each category's winner (`categoryWinners`).
- Screens match the sheet's displays: per-round table lists, seeding results by category, bracket diagrams, final standings and the champion with the bag total. The colours of the Gold, Silver, Bronze, Copper and Tin tiers are kept.

---

## 8. Bitfocus Companion module

A custom Companion module (`companion-module-race2feed`) connects to the server with the API key over a live (WebSocket) connection.

- **Actions:** Start race, Race finished, and optionally Pin projector screen and Return projector to automatic.
- **Feedbacks** (button colours):
  - START is green when all stations are Ready and red or grey otherwise.
  - FINISH is amber while teams are outstanding and green when it can be pressed.
  - The round state shows as a colour.
- **Variables:**
  - `clock` (m:ss while running)
  - `round` (e.g. "Round 5")
  - `ready_count`, `station_count`
  - `outstanding` (teams without a result)
  - `state`
  - `penalties_enabled` (on/off)
  - `auto_finish` (seconds until the round finishes by itself, from the view's `autoFinishAt`; blank when none)
- **Rejected commands:** if START or FINISH is refused because of a gate, the module shows the reason (e.g. "3 stations not ready") as a variable and briefly flashes the button.

---

## 9. Access and security

The server is reachable from the internet, so:

| Role | How they authenticate |
|---|---|
| Race control (the console; role `admin` in code) | Cloudflare Access: an emailed one-time code for an address on the allow list kept in Cloudflare's Zero Trust dashboard. The emergency password (below) when Access or email is down. |
| Referee | Device token, paired by scanning a station's QR code in race control and entering their name (`POST /api/pair {code, name}`). Bound to one station and revocable; the name appears in the log. |
| Companion | API key created in the console. Can be rotated. |
| Participant, projector | Public, read-only |

- HTTPS and certificates are handled by Cloudflare on the custom domain `r2f.weiss-audio.com`.
- **Console sign-in through Cloudflare Access.** The Access application "PRC console" covers `r2f.weiss-audio.com/control*` and `r2f.weiss-audio.com/api/control/*` (session length 14 days, set on the application). The console page and all its requests (commands, lists, export, its live connection) are under `/api/control/`. The Worker accepts one only if its `Cf-Access-Jwt-Assertion` token verifies: RS256, signed by a key from `https://{team domain}/cdn-cgi/access/certs` (cached for an hour, fetched again for an unknown key id; when a fetch fails, the keys cached earlier stay in use), issuer `https://{team domain}`, the application's audience tag, not expired, with an email. The team domain and audience tag are the Worker variables `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`; if either is missing every console request is refused (`503 access_not_configured`). A request that fails the check gets `401`. The email is the actor name in the log. Sign out goes to Access's `/cdn-cgi/access/logout`. A console socket closes (code 4401) on its first message, or the first update sent to it, after the token's expiry. When an expired Access sign-in is redirected to Access's login page, the console shows "You are not signed in. Reload this page to sign in." instead of retrying.
- **No cross-site console requests.** The console's credentials are cookies: Access's `CF_Authorization` (set to SameSite Lax on the Access application) and the emergency `r2f_session`. Every `/api/control/*` and `/api/emergency/*` request, socket upgrades and the emergency login included, is refused with `403 cross_site` when its `Origin` header is not the site's own or `Sec-Fetch-Site` is `cross-site`. Requests with no `Origin` (a same-origin navigation such as an export link, or a script) pass.
- **Console sockets.** The Worker signs the console in, then passes the socket to the hub with an internal `x-r2f-console` header naming who it is (URI-encoded, so names outside Latin-1 work; a value that does not decode counts as no header). The Worker deletes that header from every incoming request, and the hub reads it only on the console socket paths, so a caller cannot claim to be the console.
- **Emergency sign-in.** `/emergency` is outside the Access application and shows one password box. The password is the Worker secret `EMERGENCY_PASSWORD`; if it is not set, every `/api/emergency/*` route answers `404` and the page says emergency sign-in is not enabled. A correct password sets a 12-hour `r2f_session` cookie that works only on `/api/emergency/*`, the same console routes as `/api/control/*`; each socket message checks the session again. Wrong passwords are rate-limited: 5 failures per address in 5 minutes. Log entries are named `emergency sign-in`.
- **No passwords in the app's screens.** Console passwords stored by older versions are deleted when the hub starts and never checked. A session cookie no longer signs anyone in on `/api/command` or `/api/ws`, which serve referee devices (device cookie), Companion (API key) and public screens only.
- **Local development and tests.** `wrangler dev` has no Access in front of it. The Worker variable `DEV_CONSOLE_USER`, set only in `.dev.vars` and the test configuration, signs console requests in as that name. It is refused on the production hostname.
- Every write endpoint requires an authenticated role, and session and device cookies are `HttpOnly`, `Secure` and `SameSite=Strict`.
- Public endpoints expose only what the participant and projector pages show, including whether a team's table is ready, while a round is open (each entrant's `ready` flag, per table; false in every other round and phase, and at an excluded station). They expose no station list, ready-table list, device, audit or credential data.

---

## 10. Architecture

- **One Cloudflare Worker** serves the web pages (static assets), a JSON API and WebSocket connections. The WebSockets terminate in a single **Durable Object** (the "hub"), which owns the live state and pushes changes to every page and to Companion.
- **Stack (decided):**
  - TypeScript throughout: Cloudflare Workers runtime for the server, Node.js for the Companion module, sharing types.
  - SQLite storage built into the Durable Object (decided as "Node/SQLite"; on Cloudflare the SQLite is the Durable Object's own).
  - WebSockets use the Durable Object **hibernation API**, so idle connections cost nothing.
  - One hub Durable Object holds every event. Only one event is live at a time and the load is a few hundred connections, well within one object's limits. This keeps authentication and history in one consistent place.
- **The server is the single source of truth.** Pages subscribe to the live state, and everything is recomputed from stored races and results, nothing from client-side state. This keeps the rules testable and the pages simple.
- **Core data:**
  - Event, Category, Team, Table/Station, SeedingGroup, Bracket, Round, Race
  - RaceEntry (team, table, raw time in ms, status: pending / finished / DNF / DNS)
  - Penalty (race entry, amount in ms, source: referee or race control, device, created and removed timestamps)
  - Event settings, including the penalty switch and undo window
  - TieDecision, Device, ApiKey, AuditLog
  - RoundLineup, BracketMembers (the races each round was opened with, and each bracket's teams as they stood when the first bracket round opened)
- **The rules engine is a pure module with no I/O:** group and table assignment, seeding rank, bracket plan, heat and placement generation, and final standings. This makes it straightforward to unit-test.

---

## 11. Deployment

- **Cloudflare Workers:** deployed to the custom domain `r2f.weiss-audio.com`.
- **Deploys go through GitHub Actions when work is merged into `main`.** Tests run first, then `wrangler deploy` uploads the Worker and the page files.
  - Pages are served as Cloudflare static assets, which are free and unlimited.
  - Nothing goes live without the user's merge.
  - Pull requests run the tests only.
- **Configuration:** `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` are Worker variables in `wrangler.jsonc` (not secrets). `EMERGENCY_PASSWORD` is a Worker secret (`wrangler secret put EMERGENCY_PASSWORD`). The allow list of console emails is kept in Cloudflare's Zero Trust dashboard. Everything else is set in the console.
- **Access application settings:** session length 14 days; the `CF_Authorization` cookie's SameSite attribute is Lax. The Worker also refuses cross-site console requests itself (§9).
- **Deploy order for console sign-in through Access:** (1) the Access application and policy exist, so `/control` asks for the emailed code (then the old password until this version is deployed); (2) set `EMERGENCY_PASSWORD` (the Access values ship in `wrangler.jsonc`); (3) deploy; (4) after the first successful deploy, delete the old secret with `wrangler secret delete ADMIN_PASSWORD`.
- **Plan:** the Workers Free plan likely covers an event. Over a free daily limit, requests fail instead of slowing down, so the Workers Paid plan ($5/month) is recommended for the event month.
- **Backups:** the Durable Object's SQLite keeps 30 days of point-in-time recovery, and admin has an "export event" option (JSON and CSV), and the fairness report (§3.9).

---

## 12. Risks

| Risk | Mitigation |
|---|---|
| **Venue internet outage.** Timing, start and finish all depend on reaching Cloudflare. | Queued taps cover short dropouts (§5). Bring a phone hotspot as a backup uplink for race control and the Companion machine. A local fallback (a venue box) can be designed later if needed. |
| A referee device is lost or misused | Pairing is per device and revocable, and taps are audit-logged. |
| A referee taps penalty instead of finish, or the other way round | The two buttons look different and sit apart, each has its own undo, and race control can remove either. |
| A wrong time decides a head-to-head | The referee can undo, race control can edit, results are reviewed before the next round opens, and every change is logged. |
| The app is reachable from the internet | Role authentication, rate limiting and a read-only public surface (§9). |

---

## 13. Acceptance: reproduce the last event

The previous event's data, taken from the sheet, is the regression fixture:

- **Seeding:** importing the 50 teams with their groups, tables and two seeding times must reproduce the sheet's **rank within category** for every team. That includes the tie rules and the m:ss to seconds conversion.
- **Brackets:**
  - The bracket plan must reproduce the sheet's assignments (HS 4/4/6, Community 4/4/4/4, Corporate 4/4/4/4/4).
  - Round 5–8 matchups must reproduce the sheet's table assignments.
- **Results:** feeding in the recorded race outcomes must reproduce:
  - the sheet's **final standings** for every category
  - the Grand Champion (Riverbend Middle School)
- **Note on bracket-round timing:** the sheet recorded only winners in bracket rounds, not times. The fixture uses synthetic times that agree with those winners.

---

## 14. Future features

The user has more features in mind; add them here as they are defined.

- _TBD_
