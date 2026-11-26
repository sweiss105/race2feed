# Changelog

Notable changes to PRC, newest first. Day-to-day detail is in the git history.

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
