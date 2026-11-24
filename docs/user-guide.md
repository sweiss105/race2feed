# Race to Feed: Event Staff Guide

> **Note:** this guide is kept up to date as features change. If a button or screen looks different from what's described here, the app has probably moved ahead of the guide. Ask the person who looks after the app.

This guide explains how to run a Race to Feed event with the app. It's organised by job, so you can skip to your part:

- [The big picture](#the-big-picture)
- [Setup before the day](#setup-before-the-day): create the event, teams and settings
- [Race control](#race-control): run the rounds on the day
- [Referees](#referees): time the teams at the tables
- [Participants](#participants): follow along on a phone
- [Projector](#projector): the big screen
- [Bitfocus Companion](#bitfocus-companion-start-and-finish-buttons): physical Start and Finish buttons
- [Ending and reopening an event](#ending-and-reopening-an-event)
- [Troubleshooting and FAQ](#troubleshooting-and-faq)

---

## The big picture

Everything happens at **https://r2f.weiss-audio.com**:

| Address | Who uses it |
|---|---|
| `r2f.weiss-audio.com` | Participants and the public, on their phones |
| `r2f.weiss-audio.com/projector` | The computer connected to the projector |
| `r2f.weiss-audio.com/ref` | Referee tablets (opened by scanning a QR code) |
| `r2f.weiss-audio.com/control` | Race control (setup, settings and events too) |

**A few words we use:**

- **Table:** one numbered race spot. Each team races at one table per round.
- **Station:** the table or tables one referee looks after. By default a referee covers **two tables** (1 & 2, 3 & 4, …). Race control can switch the event to **one referee per table** (see [Tables per referee](#tables-per-referee)).
- **Round:** all the races that start together on one master clock.
- **Seeding rounds:** each team races twice against the clock. Their total time ranks them within their category.
- **Brackets:** after seeding, teams are placed in brackets (Gold, Silver, Bronze, Copper, Tin, …) and race head-to-head.
- **Grand Championship:** an optional final race between the top-bracket winners of each category.

**How a round flows:**

1. Race control presses **Open round N** (the big button on the Race page). Everyone's phone, the projector and the referee tablets show who races at which table.
2. Each referee checks their teams are in place and presses **Ready**.
3. When every station is Ready, race control (or the Companion **Start** button) starts the race. The master clock runs.
4. Referees tap each team's button the moment the team finishes.
5. When every team has a time (or is marked DNF or DNS), the race finishes by itself after the auto-finish delay (30 seconds by default). Race control can press **Finish now** sooner.
6. Race control checks the results, settles any ties or penalties, and opens the next round.

> **DNF** means "did not finish" and **DNS** means "did not start". Both always rank after teams that finished.

---

## Setup before the day

Race control sets up the event before the day, then runs it. Sign in at `/control` with your email address:

1. Open `/control`. Cloudflare asks for your email address.
2. Type it and wait for the email with a one-time code.
3. Type the code. The console opens.

Only addresses on the console's allow list get a code. Signing in lasts 14 days on that browser, so **sign in before event day** on every laptop that will run the console. Your email is shown in the **Log** next to everything you do.

The console's menu on the left has these sections: **Race, Teams, Setup, Devices, Settings, Events, Log**. Everyone who signs in sees all of them. **Sign out** (bottom of the menu) signs that browser out of Cloudflare.

If the console says **"You are not signed in. Reload this page to sign in."**, press **Reload** and sign in again. If Cloudflare or email is down on the day, use the [emergency sign-in](#troubleshooting-and-faq).

### 1. Create the event

1. Go to **Events**.
2. Type the **Event name**, pick the **Date** and enter the number of **Tables** at the venue.
3. Press **Create event**.
4. If no event is active and none has just ended, the new event becomes **Active** straight away. Otherwise, press **Make active** on its row when you're ready. (Creating next year's event right after ending this one doesn't take the champion off everyone's phones.)

Only one event is active at a time. Older events are kept for history, and you can download any of them with the **CSV** or **JSON** links on its row. In the CSV, text that starts with `=`, `+`, `-` or `@` is exported with a leading apostrophe so spreadsheets show it as text instead of running it as a formula.

### 2. Add teams

Go to **Teams**.

**Import from a spreadsheet (CSV):**

1. Prepare a file with the header row `team,category`, then one team per line. For example:
   ```
   team,category
   Green Valley Students,High School
   Main Street Volunteers,Community
   ```
2. Paste it into **Paste CSV**, or press **Choose file…** to pick the file.
3. Press **Import**.

Things to know about importing:
- **Importing replaces the whole team list.** It also clears seeding groups, tables and brackets, so import first and then do the rest of setup.
- Categories appear in the order they first show up in the file.
- The order of teams in the file matters: it's the last tie-breaker in seeding.
- Category names are matched ignoring capital letters and spaces at the ends, so "High School" and "high school" are one category, while "A" and "A+" stay separate. Names in any script work.
- If something's wrong (a missing name, a duplicate team, a wrong header), the app lists each problem with its line number and imports nothing.

**Add, rename or remove a team:** use **Add team** (name and category) at the top, or **Rename** and **Remove** on a team's row. Adding and removing are possible only until setup is locked. Renaming works at any time.

### 3. Seeding groups, tables and brackets

Go to **Setup** and press **Suggest groups and brackets**. The app:
- **Splits teams into seeding groups** that fit your tables (for example, 50 teams with 26 tables gives Group A with 26 and Group B with 24). It fills each group in category order, so categories stay together and only the last group is short. That last group can be much smaller (27 teams on 26 tables gives 26 and 1), so move teams between groups to even them out if you want. Each team gets a table.
- **Suggests a bracket plan** for each category, in fours (Gold, Silver, Bronze, Copper, Tin). Leftover teams join the last bracket, making it 5, 6 or 7 teams.

You can then adjust:
- **Seeding groups and tables:** change any team's **Group** or **Table** in the list. Two teams can't share a table in the same group.
- **Brackets:** for each category, rename a tier, change its number of teams, **Add tier** or **Remove last tier**, then press **Save [category] brackets**. The line "*X of Y teams placed*" must match before you can lock. Brackets hold 4 to 7 teams (a category with fewer than 4 teams gets one small bracket).
- **Grand Championship:** the switch turns the final race between the top-bracket winners on or off. It needs a table for every category winner, so with more categories than tables you can't lock until you add tables or turn it off.

### Tables per referee

In **Setup**, choose how many tables each referee covers:
- **One referee per two tables** (the default). Each referee looks after a pair of tables.
- **One referee per table.** Each referee looks after a single table and gets one big team button. Head-to-heads are judged by two referees, both on the same master clock, so times still decide the winner.

You can change this until setup is locked. Station counts, pairing, the Ready check, the referee screen and the station labels in the console all follow the choice.

### 4. Lock the setup

When teams, groups and brackets look right, press **Lock setup** in **Setup**.

- **Locking checks everything first.** If something is wrong, you'll see a list of problems (for example, a team without a table, or brackets that don't add up, or **Grand Championship: 5 category winners but only 4 tables** when the Grand Championship is on and there are more categories than tables). Fix them and try again.
- **Racing needs a locked setup:** race control can't open a round until it's locked.
- **Unlock setup** is available only before the first round is opened.
- **Some changes still work while locked:** renaming teams, settings, the penalty list and the bag total.

### 5. Who can sign in

The console has no password. The list of email addresses allowed to sign in is kept in Cloudflare, not in the console: whoever manages the Cloudflare account adds or removes addresses in Cloudflare's Zero Trust dashboard, on the policy of the Access application **Race to Feed console**. Ask them to add every member of race control well before the day, and have each person sign in once to check.

### 6. Companion keys

Bitfocus Companion (the Stream Deck buttons) needs a key. Under **Settings → Companion keys**:

1. Type a name, for example "Stream Deck".
2. Press **Create key**.
3. **Copy the key straight away.** It's shown only once. Press **Copy**, then **Done**.

To stop a key working, press **Revoke** next to it. See [Bitfocus Companion](#bitfocus-companion-start-and-finish-buttons) for setting up the buttons.

### 7. Pair the referee tablets

Go to **Devices**. There's one row per station.

1. Press **Pair tablet** on a station's row. A QR code and a short code appear.
2. On the referee's tablet or phone, scan the QR code with the camera. It opens the referee page, which asks for the referee's name; once they press **Start** the tablet is paired to that station.
3. Press **Done** to close the code.

About pairing:
- **Codes are single-use and expire after 10 minutes.** Make a new one if needed.
- **One station can have more than one device**, for example a spare tablet.
- **Paired devices are listed per station** by the referee's name, with when they were last seen. **Revoke** disconnects a device immediately (for a lost tablet, say).
- **Pairing belongs to one event.** If a different event is made active, or the event is ended, tablets must be paired again.

### 8. Settings

Under **Settings**, for the active event:

- **Time penalties:** the switch that turns referee penalties on or off for the whole event (off for a new event). See [Time penalties](#time-penalties).
- **Referee undo window (seconds):** how long a referee can undo their own tap (default 10 seconds). Press **Save undo window**.
- **Auto-finish delay (seconds):** how long after the last team gets a result the race finishes by itself (default 30 seconds). It is never shorter than the undo window. Set it to 0 to turn auto-finish off, so only **Finish now** (or Companion's Finish) ends a race. Press **Save auto-finish delay**. See [Start and finish](#start-and-finish).
- **Bags of food packed:** the number shown on the champion screen. Type just the number (for example `9,816`) and press **Save bag total**. The screen adds "bags of food packed!". Race control can also enter it when showing the champion.
- **The penalty list:** the reasons race control chooses from when reviewing penalties. Each reason has a name and either a time (for example +10s) or **DQ** (disqualified from that race). New events start with:

  | Reason | Penalty |
  |---|---|
  | Bag not sealed | +5s |
  | Wrong item count | +5s |
  | Started early | +10s |
  | Unsafe conduct | DQ |

  To change it, go to **Settings → Penalty list**. Each row has a name, **Time** or **DQ**, and the seconds for a time penalty. Use **Add penalty** and **Remove**, then press **Save penalty list**. You can change the list at any time. Each name must be different, and the list can't be empty. Penalties that were already decided keep the reason and time they were given.

---

## Race control

Sign in at `/control` with your email address and the one-time code (see [Setup before the day](#setup-before-the-day)). Most of your work happens in the **Race** section.

At the top of **Race** you'll see:
- the round number and its state: **idle**, **open**, **running** or **finished**
- the race clock, while running
- a **status line** that says what the room is waiting for
- **one large button** that always shows the next step. It **pulses** when pressing it will work and is what you should do next. When it's greyed out, the status line says why.

| What's happening | Button | Pulses | Status line |
|---|---|---|---|
| Setup not locked yet | **Open round 1** (greyed out) | no | "Waiting on setup to be locked" |
| Between rounds, nothing blocking | **Open round N** | yes | "Ready to open round N" |
| Round open, some stations not ready | **Start** (greyed out) | no | "Waiting on N referees to be ready" |
| Round open, every station ready | **Start** | yes | "All referees ready" |
| Racing, teams still out | **Finish now** (greyed out) | no | "Racing — waiting on N teams" |
| Racing, every team has a result | **Finish now** | no | "All teams in — finishing in 23 s" (the auto-finish countdown) |
| Racing, every team in, auto-finish off | **Finish now** | yes | "All teams in" |
| Penalties still to review | **Open round N** or **Show champion** (greyed out) | no | "Waiting on N penalties to be reviewed" |
| A tie to decide | **Open round N** or **Show champion** (greyed out) | no | "Waiting on a tie to be decided" |
| Last round finished | **Show champion** | yes | "Event complete" |
| Champion showing | **Hide champion** | no | "Champion is showing" |

"N referees" counts referee stations that are not Ready yet. With **one referee per table** (see [Tables per referee](#tables-per-referee)) each station is a single table, so these read "Waiting on N tables to be ready" and "All tables ready" instead. If both penalties and a tie are waiting, the status line names the penalties first.

On a device set to reduce motion, the button doesn't pulse.

### Open a round

1. Press **Open round N**.
2. The round's tables go out to phones, the projector and the referee tablets.
3. Stations with no teams this round are marked **No teams** automatically.

**Before you open the first bracket round, check the seeding results.** Brackets become final the moment that round opens: later bracket rounds are built from those brackets, and a correction to seeding won't move a team to another bracket.

The button is greyed out while penalties or a tie are waiting (the status line says which). If the server still refuses, the message appears under the button:

| Message | What to do |
|---|---|
| "Lock the setup before opening a round." | Lock the setup under **Setup**. |
| "Finish the current round first." | Finish the round that's open or running. |
| "*N* penalties need a decision first." | Decide the pending penalties (see [Penalty review](#penalty-review)). |
| "The next round is waiting on a decision." | Usually a tie that needs deciding (see [Ties](#ties)). |

When every round has been raced, the button reads **Show champion** and the status line says "Event complete". That's your cue to [show the champion](#show-the-champion).

### Station readiness

The **Stations** panel shows every station as **Ready**, **Not ready** or **No teams**. Referees press Ready on their tablets. You can override any station:
- **Ready:** mark it ready for the referee (for example, their tablet is having trouble).
- **Unready:** clear a Ready. A referee can't undo their own Ready, so this is the only way.
- **Exclude:** leave the station out of the Ready check. **Include** puts it back.

While the round is open, the status line tells you how many stations are not ready yet ("Waiting on N referees to be ready", or "N tables" with one referee per table).

### Start and finish

- **Start** works only when every station that has teams is Ready (or overridden). Until then it's greyed out and the status line reads, for example, "Waiting on 2 referees to be ready".
- **Finish now** works only when every team in the round has a time, DNF or DNS. Until then it's greyed out and the status line reads "Racing — waiting on *N* teams".

While a round runs, the **Waiting on *N* teams** panel lists every team without a result yet, with **DNF** and **DNS** buttons for each one.

When the round finishes, the clock stops and the round's results are locked in. Referees can no longer tap or undo.

**Auto-finish:** once every team in the running round has a result, the race finishes by itself after the auto-finish delay (the **Auto-finish delay** in Settings).
- **The auto-finish delay starts again** after any later tap, penalty, undo or correction, so referees have time to add penalties after the last finish. Changing the undo window or the auto-finish delay in Settings also starts it again, with the new length.
- **It is cancelled** if a team loses its result (a referee's undo, or you press **Clear**). It starts again when every team has a result.
- **The status line counts down**: "All teams in — finishing in 23 s".
- **It finishes exactly as Finish now does**, and the **Log** shows it as "auto-finish". You can still press **Finish now** (or the Companion button) sooner.
- It keeps counting even if nobody has the console open.

Companion's Start and Finish buttons follow exactly the same rules.

### Enter or correct results

The **Results** panel lists every team in the round, with its table, race and time. Use the **Round** menu to look at an earlier round. For each team you can:

- **Enter a time:** type it as `m:ss` or `m:ss.hh` (for example `3:41.20`) and press **Set**.
- **DNF** or **DNS:** mark the team.
- **Clear:** remove the result.
- **Add a penalty:** pick a reason from the penalty list and press **Add**. Penalties you add count straight away, with no review needed.
- **Remove a penalty:** take away the team's most recent penalty.

The newest change always wins, so you can correct a referee's tap by entering the right time.

**Correcting an earlier round:** once a later round has been opened, the app asks **"Change an earlier round?"**
- **A round keeps its line-up once it's opened.** The app saves who races where when you open each round, and which teams are in each bracket when you open the first bracket round. A correction never changes those.
- **The dialog names any opened round that keeps a line-up the corrected results no longer match**, for example "Round 3 was opened with its original line-up and keeps it. The corrected results will not match who raced there." If no round is named and the brackets aren't affected, it says "No line-ups are affected."
- Press **Change anyway** to go ahead. Seeding ranks, places and standings are worked out again from the corrected results, and rounds you haven't opened yet are built from them.
- **Bracket membership is final once the first bracket round is opened.** Every bracket round after that, including ones not opened yet, is built from those brackets, not re-seeded. A team stays in its bracket even if its corrected seed would now put it in a different one.
- **If a correction changes the seeding the brackets were set from**, the dialog also says, in bold, "Brackets were set when the first bracket round opened. Teams stay in those brackets, even if this changes their seeding."
- You can correct an earlier round even while the current round is open or running: the current round's line-up doesn't change.
- If a correction creates a tie in an earlier round, the round that's open or running carries on as it is. Decide the tie before you open the next round.

### Time penalties

Penalties are switched **off** for a new event. The **Time penalties** switch in **Settings**, in the event's panel, turns them on or off for the whole event.
- **It takes effect at once**, even mid-race: the penalty buttons appear or disappear on every referee tablet.
- **Turning it off doesn't remove** penalties already given.
- **You can still add or remove penalties** in Results while it's off.

How penalties count:
- A referee's penalty tap adds **no time** by itself; you set the length when you review it (see below). Taps **stack**: three taps are three penalties to review.
- A team's **official time** is its finish time plus its penalties. The official time decides places, head-to-heads, ties and seeding.

### Penalty review

A referee's penalty **adds no time**; it flags the team as **pending: under review** (that label appears beside the team's time for everyone, and as "under review" on the projector) until you decide it. After the round finishes, the referee can send a note for each penalty: the closest reason from the list, plus a short comment.

Pending penalties appear in the **Penalties to review** panel on the Race page ("Round N · flagged by the referee"). For each one:

1. Read the referee's pick and note. A note isn't required, so you can decide without one.
2. Choose the official reason from the penalty list. The referee's pick is pre-selected.
3. Then decide:
   - **Approve with a time reason:** the penalty becomes that reason's time (for example, +10s for "Started early").
   - **Approve with a DQ reason:** the team is disqualified from that race. It ranks like a DNF and shows as **DQ**.
   - **Reject:** the penalty is removed and the results update.

**You can't open the next round while any penalty is still pending.** The big button stays greyed out and the status line reads "Waiting on *N* penalties to be reviewed".

Approved reasons are shown to everyone:
- **On phones**, for example `3:46.20 (incl. +10s · Started early)` or `DQ · Unsafe conduct`.
- **On the projector**, just `+10s` or `DQ`.
- **In the CSV and JSON exports**, together with the referees' notes.

To change a decision on an earlier round after a later round has opened, you'll get the same **"Change an earlier round?"** confirmation as for times.

### Ties

If two or more teams in a race have exactly the same official time (to the hundredth of a second), a **Ties to decide** panel appears:

1. Use the **↑** and **↓** arrows to put the teams in finishing order.
2. Press **Decide**.

The next round can't be opened until every tie is decided.

### Rename a team

Spotted a misspelling on the projector? Go to **Teams**, press **Rename** on the team's row, type the new name and press **Save**. Race control can do this at any time during the event.

### Projector control

The projector changes screens by itself. To show a particular screen, use the **Projector** menu on the Race page and choose **welcome**, **tables**, **clock**, **seeding results**, **brackets**, **standings** or **champion**. The projector stays on that screen until you choose **Projector: automatic** again. The automatic option shows which screen it would pick.

### Show the champion

When the last round is finished and every penalty has been decided (until then the button is greyed out and the status line says what it's waiting for):

1. Press **Show champion** (the big button on the Race page).
2. Enter or confirm the number of bags packed, then press **Show**.
3. The projector **and every participant's phone** switch to the champion screen: the Grand Champion, the bag total and the final standings by category. If there's no Grand Championship, it shows each category's winner instead.

While the champion is showing, the big button reads **Hide champion**. Pressing it returns everyone to the normal screens. You can change the bag number at any time.

### Devices and Log

- **Devices:** pair or revoke referee tablets (see [Pair the referee tablets](#7-pair-the-referee-tablets)).
- **Log:** the latest 50 changes, newest first, with who made each one. Every tap, penalty, undo, correction, override, tie decision and round change is recorded.

---

## Referees

You'll use a tablet or phone paired to your station. The top of the screen shows your **table numbers**, the **round**, and a dot showing your connection.

### Pairing

1. Race control shows a QR code for your station (in **Devices**).
2. Scan it with your device's camera. The referee page asks for **Your name**.
3. Type your name (up to 40 characters) and press **Start**. If the connection drops, the form stays: check the connection and press **Start** again. Your tables appear. Your name shows in race control's Devices list and in the log next to what you do.

If you see **"Scan the station QR code"**, your device isn't paired (or was disconnected). Ask race control for a new code.

### Before the race: Ready

1. When race control opens a round, your teams and their tables appear.
2. Check each team is at the right table and set up.
3. Press **Ready**. You'll see **Ready ✓** and "Waiting for the start".

Once pressed, Ready stays on. If you pressed it by mistake, ask race control to clear it.

If none of your tables has a team this round, you'll see "No teams at your tables this round". Stand by for the next one.

### During the race: tap finishes

When the race starts, the clock runs and there's one large button per team.
- **Tap a team's button the moment it finishes.** The button then shows the team's time.
- **Each team gets one time.** Once tapped, its button stops responding.
- **The screen stays on** while a round is open or running, on devices that support it.

If the buttons are greyed out with **"Syncing clock…"**, wait a moment: the tablet is lining its clock up with the server.

### Undo

Every tap gets its own bar at the bottom, newest on top, for example "**Alpha finished**" or "**Penalty for Alpha**", each with an **Undo** button and a shrinking countdown (about 10 seconds by default). Tapping two teams in a row gives two bars.
- **Press Undo before its bar runs out** to take that tap back.
- **Taps sent after a dropout** get their bar too, once they reach the server. The countdown runs from the moment the tap was recorded.
- **If Undo can't be sent,** you'll see "Could not undo — not connected. Try again." and the bar stays until its time runs out.
- **After that, or once the round is finished,** only race control can change it. If you press Undo too late, a red message says "Too late to undo; ask race control." (or "The race is over; ask race control." once the round has finished).
- **If the server refuses a tap that was waiting to send** (for example the team already has a result), a red message says "The saved tap for Alpha in round 3 was refused", with the reason. You see it even if the round changed while the tap was being sent. Tell race control if the time looks wrong.
- **If a red message says "The server could not process that. Try again."**, the tap is not lost: it stays saved on the tablet and is sent again automatically within a few seconds. Tell race control if the message keeps coming back.

### Only one referee tab

The referee page runs in one browser tab per tablet, so two tabs never keep separate lists of saved taps. If you open it a second time, the new tab says **"The referee page is already open in another tab on this tablet"** with a **Use this tab instead** button. Press it to make this tab the live one; the other tab then shows the same message, with its own button to take it back. Browsers without this feature behave as before and allow several tabs.

### Penalty button

When race control has switched penalties on, each team has a smaller **Penalty** button under its finish button. It adds no time; race control sets the length afterwards.

- **When:** any time from the start until the race finishes, before or after the team's finish tap. Once every team has a result, the race finishes by itself once the auto-finish delay has passed since the last tap, and each penalty tap starts the auto-finish delay again.
- **Stacking:** each tap adds one penalty. The button shows how many, for example **×2**.
- **Undo:** each penalty tap has its own **Undo**, just like a finish tap, unless race control has already decided that penalty.
- **Don't mix them up:** the penalty button is deliberately smaller, and it's an outlined button rather than a solid one like the finish button.

### After the race: penalty notes

Once the round finishes, you'll see a **Penalty notes** card for each penalty you gave that still needs review:

1. Pick the closest reason from the list.
2. Add a short note if it helps (optional).
3. Press **Send to race control**. The card then shows **Sent ✓**.

Your note goes only to race control, who makes the final decision.

### If the Wi-Fi drops

Keep tapping. The tablet saves your taps with their exact times and sends them automatically when the connection is back, so the results aren't affected. A notice shows how many taps are waiting to send. Leave the page open until it disappears.

---

## Participants

Anyone can follow the event on a phone at **r2f.weiss-audio.com**. You don't need to sign in. Scan the QR code on the projector to get there.

**Find your team:**
1. Type part of your team name into **Find your team**.
2. Tap your team in the list.

Your phone remembers your team, so next time it opens straight to it. Tap **Not you?** to choose a different team.

**Your next race** is at the top:
- **Before a round opens:** it says "Round *N* — your table appears here when it opens."
- **When the round opens:** it shows your **table number** in large type, the round, the race, and who you're racing against.
- **Status:** **Get ready**, **Racing now** or **Finished**.
- **After the last round:** "All rounds are done. Thanks for racing!"

**The tabs below:**
- **My team:** your seeding rank in your category, your total seeding time, and your time and place in each race.
- **Schedule:** every team's table for the current round, with yours highlighted.
- **Brackets:** every category's brackets, updating live. Switch between **Cards** and **Diagram**.
- **Results:** the latest round's results.

Times include penalties. For example, `3:46.20 (incl. +10s · Started early)` means the time already includes a 10-second penalty. **pending: under review** after a time means a referee has flagged the team and race control hasn't decided yet; the time may still change. **DQ** means the team was disqualified from that race.

When race control shows the champion, a champion card appears at the top of every phone. It shows the Grand Champion (or each category's winner if there's no Grand Championship), the bags packed and the final standings, with your team highlighted. The tabs stay available below. After the event ends, phones also show **Event complete**.

---

## Projector

Open **r2f.weiss-audio.com/projector** on the computer connected to the projector and make the browser full screen. The mouse pointer hides itself after 3 seconds.

The projector follows the event by itself:

| When | It shows |
|---|---|
| Before the first round | **Welcome**: the event name and a QR code to the participant site |
| A round is open | **Tables**: "Go to your table", every team's table number, and the QR code |
| A race is running | **Clock**: a big master clock, with finishing teams appearing below as they finish (approved penalties shown as `+5s`, `under review` while one is pending, or `DQ`) |
| After a seeding round | **Seeding results** by category, coloured by bracket tier |
| After a bracket round | **Brackets**, cycling through the categories |
| After the Grand Championship, or when race control shows the champion | **Champion**: the Grand Champion and the bags packed. While a penalty is still pending review it stays on **Brackets**, and switches to the champion once every penalty is decided |

Race control can pin any screen, including **standings**, from the console (see [Projector control](#projector-control)). If the projector seems stuck on one screen, check whether it's been pinned.

---

## Bitfocus Companion (Start and Finish buttons)

Race control can start and finish races from Stream Deck buttons through Bitfocus Companion. The buttons follow exactly the same rules as the console's **Start** and **Finish now**: a refused press changes nothing.

**What you need:**
- A Companion key, made in **Settings → Companion keys** (see [Companion keys](#6-companion-keys)).
- The computer running Companion must have internet access.

### For whoever sets up the buttons

Each button sends a web request:

- **Address:** `https://r2f.weiss-audio.com/api/command`
- **Method:** `POST`
- **Headers:**
  - `Authorization: Bearer YOUR-KEY` (paste the key in place of `YOUR-KEY`)
  - `Content-Type: application/json`
- **Body:** depends on the button:

| Button | Body |
|---|---|
| Start race | `{"cmd": {"type": "startRace"}}` |
| Race finished | `{"cmd": {"type": "finishRace"}}` |
| Pin a projector screen (optional) | `{"cmd": {"type": "pinProjector", "screen": "champion"}}` |
| Projector back to automatic (optional) | `{"cmd": {"type": "pinProjector", "screen": null}}` |

The projector screens you can pin are `welcome`, `tables`, `clock`, `seeding-results`, `brackets`, `standings` and `champion`.

**What comes back:**
- **It worked:** status `200` with `"ok": true`.
- **It was refused:** status `400` with a readable `message`, for example "2 station(s) not ready." or "3 team(s) have no result."
- **The key is wrong or revoked:** status `401`.

A Companion key can do only these things. It can't change results or setup.

---

## Ending and reopening an event

### End the event

When the event is over:

1. Go to **Events**.
2. Press **End event** on the active event.
3. Confirm. The confirmation warns you if some rounds haven't been raced, or if any penalty is still waiting for a decision (decide those first, or they stay "under review" in the final results).

When an event ends:
- It's marked **Ended** and is no longer active.
- Its results are locked: no further changes are accepted.
- All referee tablets are signed out and their pairings cancelled.
- **Phones and the projector keep showing the champion and final results** until someone activates another event.
- The **CSV** and **JSON** downloads keep working.

### Reopen an event

On the ended event's row in **Events**, press **Make active** and confirm. Then:
- Referee tablets must be **paired again**.
- If a race was counting down to auto-finish when the event ended, the auto-finish delay starts again from the moment you reopen it.
- If the event was ended before its last round, the champion screen is taken down automatically. If it was ended after the last round, the champion stays up; race control can press **Hide champion** at any time.

---

## Troubleshooting and FAQ

**The referee tablet says "Scan the station QR code".**
The tablet isn't paired, or its pairing ended. That happens when it's revoked, when another event is made active, or when the event is ended. Ask race control for a new code in **Devices**.

**"This pairing code is invalid or already used."**
Codes work once and last 10 minutes. Make a new one with **Pair tablet**.

**The referee's buttons are grey and say "Syncing clock…".**
Wait a few seconds; the tablet is lining up its clock with the server. If it stays like that, check the tablet's Wi-Fi.

**A referee says "*N* taps waiting to send".**
The connection dropped. The taps are saved with their real times and will send by themselves. Keep the page open. Race control sees those teams under **Waiting on *N* teams** until the taps arrive.

**The referee page says "The referee page is already open in another tab on this tablet".**
Only one tab can run the referee page. Close the other tab, or press **Use this tab instead** here.

**Start is greyed out: "Waiting on *N* referees to be ready" (or "*N* tables").**
Look at the **Stations** panel. Ask those referees to press Ready, or use **Ready** or **Exclude** on their station yourself.

**Finish now is greyed out: "Racing — waiting on *N* teams".**
Use the **Waiting on *N* teams** panel: wait for the referee's tap, enter a time in **Results**, or mark the team **DNF** or **DNS**.

**Open round N is greyed out or refused.**
Read the status line or the message under the button: lock the setup, finish the current round, decide pending penalties, or decide a tie. See [Open a round](#open-a-round).

**A referee tapped the wrong team or too early.**
Within the undo window, the referee presses **Undo**. After that, race control fixes it in **Results**: enter the right time, or press **Clear**.

**A team's name is misspelled on the projector.**
**Teams → Rename**.

**The projector is stuck on one screen.**
It's probably pinned. On the **Race** page, set the projector menu back to **Projector: automatic**.

**The console says "You are not signed in. Reload this page to sign in."**
Your sign-in ended (it lasts 14 days) or you pressed **Sign out**. Press **Reload**, then sign in with your email and the code.

**I don't get the email with the code, or Cloudflare says I'm not allowed.**
Check the spam folder and that you typed the address on the allow list. Ask whoever manages the Cloudflare account to check the list (see [Who can sign in](#5-who-can-sign-in)).

**The console says "Console sign-in is not set up."**
The app's Cloudflare Access settings are missing. Tell whoever deployed the app. Meanwhile, use the emergency sign-in below.

**Cloudflare or email is down and nobody can sign in (emergency sign-in).**
Open `/emergency` (for example `r2f.weiss-audio.com/emergency`). It is not linked from any page. Type the emergency password and press **Sign in**. You get the same console for 12 hours; the Log shows your actions as "emergency sign-in". Whoever deployed the app holds the emergency password. If the page says **"Emergency sign-in is not enabled."**, no emergency password has been set.

**"Too many attempts. Wait five minutes and try again."**
After 5 wrong emergency passwords in 5 minutes, emergency sign-in pauses for that network. Wait, then try again with the right password.

**"Setup is locked; unlock it before changing teams, groups or brackets."**
**Unlock setup** works only before the first round is opened. After that, only renaming teams, settings, the penalty list and the bag total can change.

**A tablet was lost.**
Go to **Devices** and press **Revoke** next to it. It's disconnected immediately. Pair a replacement.

**A phone shows the wrong team.**
Tap **Not you?** and search again.

**The venue internet goes down.**
Referee taps are saved and sent when it's back, but starting and finishing need the internet. Keep a phone hotspot ready as a backup for race control and the Companion computer.
