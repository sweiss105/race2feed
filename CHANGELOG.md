# Changelog

Notable changes to PRC, newest first. Day-to-day detail is in the git history.

## 2026-11-26 — The Appearance switch moved to the corner of the console

The **Automatic / Light / Dark** switch is no longer a section of the Settings page. It is a small control pinned to the bottom right corner of the console, on every page. It still changes only that browser.

## 2026-11-26 — The number of tables can be changed in Setup

- **Setup** has a **Tables** box: type the number of packing tables (1 to 99) and press **Save tables**. It works until setup is locked. Until now the number could only be chosen when the event was created.
- Changing the number clears the seeding groups, table assignments and brackets, which were built for the old number. Press **Suggest groups and brackets** afterwards.
- The form that creates an event (Settings → Events) now has labelled boxes: **Event name**, **Date** and **Tables**. The Tables box starts empty and **Create event** stays greyed out until a number is typed. It used to start at 26, so an event could be created with a table count nobody chose.

## 2026-11-26 — License and contributor documents

PRC is released under the **GPL-3.0** license (`LICENSE`). The repository also gained `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md` (report security problems privately, through the repository's Security tab) and a bug report form for issues.

## 2026-11-26 — Referee devices, not tablets

Referees use their own phone or tablet; nothing is handed out. The screens and the staff guide said "tablet" for what a referee uses, which read as if tablets were supplied. They now say **device**.

- On the console's Referees tab the button is **Pair device** (it was "Pair tablet").
- A second referee tab says "The referee page is already open in another tab on this device".
- Refusal messages say "device" too, for example "Only the device that made a tap can undo it."
- The staff guide, design document, README, security policy and bug report form use the same word. The guide's step 8 is now **Pair the referee devices**, and its troubleshooting entry is **A referee's device was lost.**
- "Phone or tablet" is still used where the text says what kind of device a referee can bring.

Nothing about how pairing works has changed: a referee still scans a station's QR code, types their name and presses Start.

## 2026-11-26 — Tournament format settings

Setup has a new **Tournament format** panel, at the top. Organisers can now choose how an event runs; until now the format was fixed.

- **Seeding rounds:** 1, 2 or 3.
- **Seeding rank:** Total time, Best run (needs at least two seeding rounds) or Drop the slowest (needs three).
- **Bracket format:** Heats, then placement (the format until now), Finals only (each bracket races once, all its teams together) No brackets (each category's final order is its seeding order) or Knockout.
- **Presets** set all three at once: Standard, Short, Seeding only and Knockout.
- **Knockout:** each bracket is a head-to-head draw from the seeding, down to a final. The top seeds get a bye when a bracket is not 2, 4, 8 or 16 teams, the semi-final losers race for third place, and every bracket's final is in the last knockout round. A knockout bracket holds 2 teams up to the number of tables; **Suggest groups and brackets** proposes brackets of 8 and never one larger than the tables. Phones, the projector and Race Control show each knockout bracket as a tree. The staff guide explains it under **Knockout brackets**.
- Every choice has its explanation written under it, and the panel counts the rounds and races the setup makes.
- The format can be changed until setup is locked. The Grand Championship switch works with every format.
- Seeding results on the projector and on phones now show each seeding run and the time teams are ranked on ("Total", "Best run" or "Best two"), to the hundredth of a second. In a Seeding only event phones have a **Standings** tab in place of **Brackets**.
- In Setup, each category's brackets now say which sizes the format takes ("A bracket has 4 to 7 teams.", or for knockout "2 to" the number of tables).
- The staff guide has a new step, **3. Tournament format**, in "Setup before the day". The steps after it moved up by one (Lock the setup is now step 5, Settings step 9).

**Existing events are not affected.** An event created before this change has no format stored and runs as Standard, exactly as before.

## 2026-11-26 — The software is named PRC

The software is now called **PRC (Packing Race Coordinator)** everywhere. **Race to Feed** is the name of the event it runs, not of the software.

- The README, staff guide, design document and the PDF's cover and footer call the software PRC.
- The staff guide PDF was renamed from `docs/Race-to-Feed-User-Guide.pdf` to `docs/PRC-User-Guide.pdf`.
- Browser tab titles changed from "Race to Feed" to "PRC" on the participant, projector, referee and not-found pages. The pages themselves still show the active event's name.
- The Cloudflare Access application that protects the console was renamed from "Race to Feed console" to "PRC console". Its settings and allow list are unchanged.

Not changed: the event's name wherever it appears (for example "Race to Feed 2026"), the site address `r2f.weiss-audio.com`, the repository name, and the older planning documents under `docs/superpowers/`, which are kept as a record.

## 2026-11-26 — Referee rotation, fairness warnings and the fairness report

- **Rotate referees each round** (Settings, on for new events): when a round opens, PRC sends each referee to the tables where they have judged those teams least. A referee who has to move sees "Round 5: go to Tables 7 & 8" and presses **I'm there**. Each station's card on Race Control shows its referee, and **Swap…** exchanges two referees before the start. Events created before this have it off.
- In a bracket's deciding race and in the Grand Championship, a spare referee takes one of the two tables, so each team has its own referee.
- **Fairness** panel on Race Control: prompts to take a look, never a block. The warnings are Very fast time (30 seconds faster than anything before it), One referee's teams keep doing well, Same referee, same team, Same referee, same team penalised again, Unusual number of penalties, Close finish (half a second or less), Undo changed the winner, and Final judged by one referee. A red number beside **Race Control** counts the open ones; each is dismissed with a note.
- **Same referee, same team** is raised only when a swap by race control caused the repeat. Repeats PRC could not avoid (too few referees) are not flagged; the fairness report lists who judged whom.
- **Fairness report**: a third download beside CSV and JSON on every event's row (Settings → Events). One CSV file with the warnings, everything race control entered or changed by hand, and the referee assignments of every round.

## 2026-11-26 — New default penalty list

New events start with **Fluffing Bags +5s, False Start +10s, Interference +15s, Unsafe Conduct +30s**. The old list was Bag not sealed +5s, Wrong item count +5s, Started early +10s and Unsafe conduct (DQ). The new list has no DQ reason; add one under Settings → Penalty list if you want one. Events that already exist keep the list they have.

## 2026-11-26 — Team names are limited to 35 characters

A team name can be at most 35 characters, so every name fits on one line on the projector. The import lists each longer name with its line number and imports nothing; Add team and Rename refuse one. Teams already stored with a longer name keep it until they are renamed.

## 2026-11-26 — Transparent projector for OBS, and Screen links

- `r2f.weiss-audio.com/projector/?bg=transparent` is the projector with no background of its own, for an OBS browser source over your own image or video.
- **Setup** ends with a **Screen links** panel: the address of every screen (participants, projector, transparent projector, referee, race control), each with a **Copy** button.

## 2026-11-26 — Race control and projector changes for race day

- **Finish** beside each team in **Waiting on N teams** stops that team's clock at the press, for when a referee cannot tap.
- On the projector's running list the red number is now the **finishing position** (teams showing the same time share one); the table follows the team's name as "(T1)". On the Tables screen the red number is still the table.
- Referees press **Ready** for each table, and the projector's Tables screen shows a red or green dot per team.
