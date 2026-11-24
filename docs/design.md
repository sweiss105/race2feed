# Race to Feed — Event App Design

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
- Live timing from one master clock, with finish times captured by referees on tablets.
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
| **Station** | A fixed **pair of adjacent tables** (1&2, 3&4, …) covered by one referee tablet. With an odd table count, the last station is a single table. |
| **Seeding group** | A set of teams that race in the same seeding rounds. |
| **Bracket** | A seeded set of 4–7 teams within a category (Gold, Silver, Bronze, Copper, Tin, …). |
| **Round** | One start-to-finish run of the master clock. All races in a round start together. |
| **Race** | A group of 1–3 teams whose finish times are compared: a seeding run, a head-to-head or a 3-team race. One race can span two stations. |

### 3.2 Setup (admin)

1. **Create the event.** Enter the name, date and **venue table count** (e.g. 26).
2. **Import teams from CSV** (`team,category`), then add, edit or remove teams in the admin page. Late entries are allowed until seeding starts.
3. **Seeding groups (auto-suggested, editable):**
   - The app creates the fewest groups that fit the table count (e.g. 50 teams with 26 tables gives A = 26 and B = 24).
   - It keeps categories together within a group where possible, and assigns tables in order.
   - Admin can move teams between groups and tables. Duplicate table assignments are rejected.
4. **Bracket plan (auto-suggested per category, editable until seeding locks):**
   - Split the category's seeds into brackets of 4, in tier order: Gold, Silver, Bronze, Copper, Tin, then generic names.
   - Leftover teams (1–3) are folded into the **last** bracket, which becomes 5, 6 or 7 teams. For example, HS 14 teams gives 4 + 4 + 6.
   - Admin can change bracket sizes (4–7) and rename tiers.
   - A category with fewer than 4 teams gets one bracket of that size. A size of 2–3 skips the heats and races once, ranked by time.
5. **Grand Championship:** by default the winner of each category's top bracket. Admin can turn this on or off. Locking setup is refused when there are more category winners than tables.
6. **Credentials:** set the console password, pair referee tablets (§9) and create a Companion API key.

### 3.3 Round structure

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

**Seeding rank within a category:**
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
  - Each referee presses **Ready**, which locks in.
- **Start gate:**
  - Companion **START** is refused until every active station is Ready (or overridden).
  - Race control can override any station: force it Ready, set it back to not ready, or exclude it.
- **Running:**
  - The server starts the master clock.
  - Referee tablets show one button per team at their tables.
- **Finish gate:**
  - Companion **RACE FINISHED** is refused until every team in the round has a time, DNF or DNS.
  - **Auto-finish:** once every team in the running round has a result, the server sets `round.autoFinishAt` to now plus the event's **Auto-finish delay (seconds)** (default 30; never shorter than the referee undo window; 0 turns it off).
    - Any later tap, undo, penalty or correction, or a change to the event settings (the undo window or the delay), restarts the delay. If a team loses its result, the time is cleared.
    - When the time arrives the server runs the same finish as the button, logged with the actor "auto-finish". If that finish is refused, the time is cleared rather than retried.
    - The time is stored with the event and driven by the hub's single alarm, which also paces phone updates; the alarm is always set to the earlier of the two, so a countdown survives the server going idle.
  - Race control sees the list of teams still outstanding and can mark them DNF or DNS.
  - When finish succeeds, the clock stops and resets, and the round's results are locked.
- **Next round:** race control reviews results, resolves any ties, then presses **Open round N** (§7.2).
  - Matchups for the next round are generated from the locked results and published at that moment, not before.
- **Late corrections:**
  - Race control can edit a finished round's results until a later round that depends on them is opened.
  - Each round's line-up is saved when the round is opened, and bracket membership when the first bracket round is opened.
  - Bracket membership becomes final when the first bracket round is opened: bracket rounds not yet opened are built from those saved brackets, not re-seeded from corrected seeding results.
  - After a later round has opened, an edit needs an explicit **unlock**, which names any opened rounds that keep a line-up the corrected results no longer match, and warns when the saved brackets differ from those the corrected seeding would set.
  - Opened rounds are never rebuilt; rounds not yet opened are built from the corrected results.
  - If a correction leaves an undecided tie in an earlier round, opened rounds keep their races; only rounds not yet opened wait for the tie decision.

### 3.6 Tables per referee

*Added after the first live test, at the user's request.*

- Admin chooses per event, in Setup, either **One referee per two tables** (the default, as in §3.1) or **One referee per table**. It can be changed until setup is locked.
- **One per table:**
  - Each referee station is one table.
  - The referee screen shows one big team button, with its Penalty button.
  - Head-to-heads are judged by two referees on the same master clock, so times still decide.
  - The layout rule about keeping head-to-heads on one station no longer applies.
- **Everything follows the choice:** station counts, the Ready/Start check, pairing, the referee screen and the console's station labels.

### 4.1 Show champion and end the event

*Added after the first live test, at the user's request.*

**Show champion** (race control, once the last round is finished and no penalty is still pending review, so the announced champion is final):
- Race control enters or confirms the bags-packed number. Leaving it blank keeps the previously saved number.
- The projector and **every participant phone** switch to a champion screen showing the Grand Champion, the bag total and the final standings by category.
- Without a Grand Championship, the screen shows each category's winner instead.
- **Hide champion** returns everyone to the normal screens. It is available whenever the champion is showing. The bag number can be changed at any time.

**End event** (admin, Events page, after a confirmation that warns if rounds remain unraced or penalties are still pending):
- The event is marked **Ended** and is no longer active.
- Its results are locked: no further commands are accepted for it.
- All referee tablets are signed out and their pairings revoked.
- **Phones and the projector keep showing the ended event's champion and final results** (read-only) until admin activates another event. Exports keep working.
- Creating a new event while an ended event is on display does not activate it automatically, so the champion stays up until admin chooses **Make active**.
- **Make active** on an ended event reopens it, after a confirmation. Tablets must be paired again. A round that was counting down to auto-finish (§4) restarts its full delay from the moment of reopening. If it was ended before its last round finished, the champion screen is taken down.

---

## 5. Timing

- **One master clock per round,** owned by the server and started by Companion START.
- **Times are stamped on the tablet and synced to the server:**
  - Each referee tablet continually estimates its clock offset from the server, NTP-style: repeated ping round trips over the live connection, using a median of recent samples.
  - A tap is recorded as `tablet_time_at_touch + offset`, and elapsed time is that minus the round start.
  - If a tap is made while Wi-Fi is down, the tablet **queues** it and sends it with its original timestamp when the connection comes back. The result is unaffected.
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
  - Flipping it shows or hides the penalty buttons on every referee tablet **immediately**, even mid-race.
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

- **A referee's penalty tap adds no time.** It flags the team as **pending: under review** (shown beside its time on the participant page, console results and referee tablet, and as "under review" on the projector's finish ticker). Times, places and brackets change only when race control approves a reason. Penalties stored by earlier versions keep the amounts they have.
- **After the race (once race control presses Finish),** a referee who tapped penalties sees a **Penalty notes** card for each one:
  - They pick the closest reason from the penalty list and may add a short note, then **Send**.
  - The referee's pick and note go to race control only.
- **Race control reviews each pending penalty** with the referee's pick pre-selected, and chooses the official reason from the list:
  - **Approve with a timed reason:** the penalty becomes that reason's time (for example +15s).
  - **Approve with a DQ reason:** the team is disqualified from that race. It ranks like a DNF and shows as **DQ**.
  - **Reject:** the penalty is removed and results update.
  - A decision can be made without a referee note.
- **The next round can't be opened while any penalty in the finished round is still pending.**
- **Penalties race control adds itself** take their reason when added and count as approved immediately.
- **Changing a decision on an earlier round** after a later round has opened follows the usual unlock confirmation (§4).
- **Approved reasons are shown to everyone:**
  - On phones: `3:46.20 (incl. +15s · Unsafe start)` or `DQ · Unsafe conduct`.
  - On the projector: just `+15s` or `DQ`.
  - The CSV and JSON exports include the reasons and the referee notes.
- **The penalty list** (name, plus a time or DQ) is managed by admin in Settings. It can be edited at any time; already-decided penalties keep their recorded reason and time. New events start with:

  | Reason | Penalty |
  |---|---|
  | Bag not sealed | +5s |
  | Wrong item count | +5s |
  | Started early | +10s |
  | Unsafe conduct | DQ |

---

## 6. Corrections and audit

- **Referee undo:** a referee can undo their own tap (a finish or a penalty) for about **10 seconds**. The window length is configurable.
- **One undo per tap:** each of the referee's recent taps has its own undo row, including taps that reached the server after a dropout. A failed undo is reported and the row stays until the window ends.
- **After the undo window:** only **race control** can edit a time, clear it, set DNF or DNS, or add or remove a penalty.
- **Audit log:** every state change goes in an append-only log, viewable in race control:
  - taps, penalties, undos, edits, overrides, tie decisions, penalty-switch changes, round transitions and logins
  - each entry records who, which device, when, and the old and new values

---

## 7. Pages

All page and UX design follows the `anthropic-skills:apple-design` skill (the user's request).

**Decided for the pages (plan 3):**

| Address | Page |
|---|---|
| `/` | Participants |
| `/projector` | Projector |
| `/ref` | Referees (race control's pairing QR code opens `/ref?code=…`) |
| `/control` | The race control console: one role, all seven sections (Race, Teams, Setup, Devices, Settings, Events, Log) |

- **Look:** clean Apple style with automatic light/dark mode and one accent colour, the spreadsheet's display red `#D71920`. The projector uses a dark theme, and the Gold/Silver/Bronze/Copper/Tin tier colours are kept.
- **Referee page:** adapts to phones (team buttons stacked) and tablets (side by side).
- **Brackets on phones:** a card list per bracket, with a toggle to the classic bracket diagram.
- **Finding the site:** a QR code on the projector's welcome and table screens.

### 7.1 Console: setup and event management (password)

Race control and admin are one role. Everyone signed in to the console has every section and every command. The console's session label in the log is `race control`; `admin` survives only as the role value in code.

- Manage events, import and edit teams, set the venue table count.
- Edit seeding groups and table assignments.
- Set the referee undo window and the auto-finish delay.
- Edit the bracket plan and set Grand Championship eligibility.
- Manage the console password and the Companion API key.
- Type the **bag total** shown on the champion screen.

### 7.2 Console: running the race
- **Grid of every station:** each shows not ready / Ready / excluded, the teams with their times and status, and any overrides.
- **Race page header:** round title, state, master clock, a status line (`role="status"`) and **one large action button** that always shows the next step. It is about three times a normal button (min-height 6rem, min-width 16rem, title-sized text). It **pulses** (a 2-second scale-and-glow loop, off under `prefers-reduced-motion: reduce`) only when pressing it will work and is the expected next step; it never pulses while the server would refuse. A refused command's message shows under the header. The first matching row wins:

  | Condition | Button | Enabled | Pulses | Status line |
  |---|---|---|---|---|
  | Champion showing | Hide champion | yes | no | Champion is showing |
  | Running, N teams outstanding | Finish now | no | no | Racing — waiting on N team(s) |
  | Running, none outstanding, auto-finish set | Finish now | yes | no | All teams in — finishing in S s (seconds left, rounded up, never below 0) |
  | Running, none outstanding, no auto-finish | Finish now | yes | yes | All teams in |
  | Open, N stations not ready | Start | no | no | Waiting on N table(s) to be ready |
  | Open, all ready | Start | yes | yes | All tables ready |
  | N penalties pending review | Open round M (Show champion after the last round) | no | no | Waiting on N penalty/penalties to be reviewed |
  | Undecided tie or other blocker | as the row above | no | no | Waiting on a tie to be decided |
  | Last round finished | Show champion | yes | yes | Event complete |
  | Otherwise | Open round M | yes (no before setup is locked) | yes | Ready to open round M ("Not started" before round 1) |

  M is the current round plus one. Show champion opens the bag-count sheet first. Finish now does not pulse while the auto-finish countdown runs: the race finishes itself.
- **"Waiting on N teams" list** with one-click DNF and DNS.
- **Time penalties on/off switch** in Settings, in the event's panel (event-wide, takes effect immediately, §5.1).
- **Penalties per team:** each team shows `raw + penalties = official`, with buttons to add or remove a penalty.
- **Tie resolution**, time edits and clears, and the audit log.
- **Rename a team** at any time during the event (e.g. a misspelling spotted on the projector). Other setup changes stay locked once setup is locked.
- **Open round N** (the action button), with a results review first.
- **Referee pairing:** a QR code per station, a paired-device list, and revoke.
- **Projector override:** pin any screen (e.g. the champion reveal) or return to automatic.
- **Backup controls:** Start and Finish now (the action button) follow the same gates as Companion.

### 7.3 Referee (paired tablet, QR)
- **Pairing asks for a name.** Opening a station's QR link shows one field, **Your name**, and a **Start** button; submitting pairs the tablet. The name is trimmed and must be 1–40 characters. It is checked before the code is used, so a missing name never spends the code.
- The name labels the device in race control's Devices list ("{name} — {station tables}") and the log's actor ("{name} (station {n})"). Devices paired before names existed keep "referee station {n}".
- Shows the station's table numbers and the current round's teams.
- **Ready** button. Once pressed it stays locked; only race control can clear it.
- While running, one large button per team. A tap shows that team's time and an **Undo** countdown.
- **Penalty button** (only while penalties are switched on): a separate, smaller **Penalty** button under each team.
  - It is placed and coloured so it can't be mistaken for the finish button.
  - It's available from START until RACE FINISHED, before or after the team's finish tap.
  - It shows the number of penalties flagged (e.g. **×2**). Each penalty tap has its own **Undo** countdown.
- Shows connection status and any taps queued offline.
- A saved tap the server refuses for good is always reported ("The saved tap for {team} in round {round} was refused: {reason}"), even if the round or connection changed while the answer was in flight.
- **One live tab per tablet.** The page holds the Web Lock `r2f-referee`. A second tab shows "The referee page is already open in another tab on this tablet" and a **Use this tab instead** button, and creates neither the live connection nor the tap queue. The button posts `takeover` on `BroadcastChannel('r2f-referee')`; the holder releases the lock and shows the same message, and the new tab acquires it. Without Web Locks or BroadcastChannel the page behaves as before.

### 7.4 Participant (public, read-only, phone-first)
- **Team search** highlights the team in every bracket and list where it appears.
- The phone **remembers the team** (local storage), so later visits open straight to it.
- **"Your next race":** round, table number and opponent(s). Before the round is opened it says "waiting for Round N to finish".
- **Brackets:** all categories and tiers, live-updating.
- **Race times:** the team's and its opponents' official finish times, plus seeding totals and rank within category. Approved penalties are marked (e.g. `3:46.20 (incl. +5s · Bag not sealed)`), and a time with a penalty awaiting review reads `3:41.20 · pending: under review`.
- **Full schedule:** every team's table for the current round.

### 7.5 Projector (public URL, full-screen)
- **Changes screen automatically by round state:**

  | State | Screen |
  |---|---|
  | Open | Table assignments for the round |
  | Running | Large master clock and a finish ticker (approved penalties shown as `+5s`, and `under review` while one is pending) |
  | Finished | Updated seeding results, brackets or standings |
  | Event complete | Final standings, then the champion |

- Race control can **pin** any screen, which overrides automatic mode.
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
| Race control (the console; role `admin` in code) | One password. Stored hashes for the old separate race-control password, and its sessions, are deleted when the hub starts. |
| Referee | Device token, paired by scanning a station's QR code in race control and entering their name (`POST /api/pair {code, name}`). Bound to one station and revocable; the name appears in the log. |
| Companion | API key created in the console. Can be rotated. |
| Participant, projector | Public, read-only |

- HTTPS and certificates are handled by Cloudflare on the custom domain `r2f.weiss-audio.com`.
- Login attempts are rate-limited, session cookies are `HttpOnly` and `Secure`, and every write endpoint requires an authenticated role.
- Public endpoints expose only what the participant and projector pages show. They expose no device, audit or credential data.

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
- **Configuration:** the initial admin password is a Worker secret (`wrangler secret put ADMIN_PASSWORD`). Everything else is set in the admin page.
- **Plan:** the Workers Free plan likely covers an event. Over a free daily limit, requests fail instead of slowing down, so the Workers Paid plan ($5/month) is recommended for the event month.
- **Backups:** the Durable Object's SQLite keeps 30 days of point-in-time recovery, and admin has an "export event" option (JSON and CSV).

---

## 12. Risks

| Risk | Mitigation |
|---|---|
| **Venue internet outage.** Timing, start and finish all depend on reaching Cloudflare. | Queued taps cover short dropouts (§5). Bring a phone hotspot as a backup uplink for race control and the Companion machine. A local fallback (a venue box) can be designed later if needed. |
| A referee tablet is lost or misused | Pairing is per device and revocable, and taps are audit-logged. |
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
