# Tournament format settings — design

Status: **Approved by the owner** · 2026-11-26

## Why

Event organisers may want to run the races differently: fewer or more seeding rounds, a different way of ranking seeding, a shorter bracket stage, or a full knockout. Today every one of these is fixed in the rules engine. The owner wants them selectable in Setup "to cover all our bases".

## Goals

1. A **Tournament format** panel in Setup with presets and individual settings.
2. Seeding rounds: 1, 2 or 3.
3. Seeding rank: total time, best run, or drop the slowest run.
4. Bracket format: heats then placement (today's), finals only, seeding only, or knockout.
5. Every option carries a plain explanation of what it does (owner's explicit request).
6. A live summary of what the chosen format produces ("9 rounds, 31 races").

## Not in scope

- Races of a different size as a setting (three or four teams per head-to-head).
- Automatic re-runs for ties: race control still decides ties.
- Double elimination, round robin, or consolation brackets beyond the third-place race.
- Changing the format after the first round has opened.

## Must not happen

- An event created before this change behaving differently in any way. A missing format means today's format, exactly.
- A format that can be locked but then cannot be raced to the end (a round with no races, a bracket with no winner, a Grand Championship with fewer than two teams).
- A format change after setup is locked.
- Seeding ranks that differ between the server, the phones, the projector and the export.

## Decisions made by the owner

- Build all four: seeding rounds, seeding rank, bracket format (finals only, seeding only), and full knockout.
- Explanations beside every setting.
- Knockout calls below were proposed and approved as written.

## Design

### The setting

Stored with the event's setup as `format`, every field optional, missing = today's value:

| Field | Values | Default |
|---|---|---|
| `seedingRuns` | 1, 2, 3 | 2 |
| `seedingRank` | `total`, `best`, `dropSlowest` | `total` |
| `brackets` | `placement`, `finals`, `none`, `knockout` | `placement` |

Changed with one setup command, refused once setup is locked. Combinations that are refused: `best` with 1 run (pointless: use total), `dropSlowest` with fewer than 3 runs.

### Seeding rounds

Every seeding group runs `seedingRuns` times: all groups' run 1, then all groups' run 2, then run 3. Tables are the same for every run, as today.

### Seeding rank

Within a category, at the displayed hundredth, as today:

- **Total time:** more finished runs ranks higher; then the lower total; then the better single run; then team order. (Today's rule, generalised to 1–3 runs.)
- **Best run:** the lower best single run ranks higher; a team with no finished run ranks last; ties by the lower total of finished runs, then team order.
- **Drop the slowest:** each team's slowest run is ignored, and a run that was not finished (DNF, DNS) counts as that slowest run. So with 3 runs a team is ranked on its best two: more counted runs ranks higher (a team with two unfinished runs has only one to count), then the lower total of the counted runs, then the better single run, then team order.

The value shown beside a team in seeding results is the one it is ranked on (total, best run, or best two), with a heading that says which.

### Bracket format

- **Heats, then placement:** today's format, unchanged.
- **Finals only:** each bracket races once, all its teams in one race; the finishing order is the bracket's result. One round per table-sized chunk of brackets, as today's heats are chunked. No placement round.
- **Seeding only:** no bracket rounds and no brackets in setup. Each category's final order is its seeding order, decided when every seeding round is finished and settled. Setup can be locked without brackets.
- **Knockout:** below.

**Grand Championship** (the existing switch) works with all four: each category's winner races. With seeding only, that is each category's top seed.

### Knockout

- Each bracket is a single-elimination draw from its seeding order. Standard seeded positions: 1 meets the lowest seed, and seeds 1 and 2 can only meet in the final.
- A bracket whose size is not a power of two gives the top seeds a bye in the first round.
- The two semi-final losers race for third place in the same round as the final. A bracket of 3 has no third-place race (the semi-final loser is third); a bracket of 2 is just a final.
- Teams knocked out before the semi-finals are placed, within the round they lost in, by their official time in that round (finishers before DNF/DNS, ties by seed).
- Bracket size: any size from 2 up to the number of tables. "Suggest groups and brackets" proposes brackets of 8 by seed, folding a remainder of fewer than 4 into the last bracket.
- Every bracket's final is in the last knockout round: a smaller bracket starts later.
- Rounds are chunked to fit the tables, in bracket order, as today.
- Ties are decided by race control, as today.
- Race names: "Final", "Third place", "Semi-final 1", "Quarter-final 3", "Round of 16 · 5", and "Round 1 · 5" for anything earlier.
- Phones, the projector and the console show a bracket tree for knockout brackets.

### Setup panel

At the top of Setup, above tables per referee:

- **Presets:** Standard (2 seeding rounds, total time, heats then placement), Short (1 seeding round, total time, finals only), Seeding only (2 rounds, total time, no brackets), Knockout (2 rounds, total time, knockout). Choosing a preset sets the three fields; changing a field afterwards shows the preset as "Custom".
- **Each setting** is a labelled choice with one or two plain sentences under the selected option saying what it does and what it means for the day.
- **Summary line:** rounds and races the current setup would produce, updated as settings change; before teams and brackets exist it says what is still needed.
- Disabled with a short reason once setup is locked.
- Changing the bracket format when brackets no longer fit (for example knockout sizes back to placement) is caught by the existing lock validation, which lists what to fix; "Suggest groups and brackets" rebuilds them for the chosen format.

### Everything else

Referee rotation, the finals split (final, winners race, Grand Championship; in knockout the final), fairness warnings, saved line-ups, late corrections, exports and Companion work with every format without their own settings.

## Approaches considered

- **A format object with defaults (chosen)** against separate top-level settings. One object keeps "missing means today's format" in one place.
- **Finals only as one all-teams race (chosen)** against head-to-head finals between the top two seeds. One race places the whole bracket in one round, which is what "short" needs.
- **Third-place race (chosen)** against ranking semi-final losers by time. Times from different races are not a fair comparison for a podium place.
- **Finals aligned in the last round (chosen)** against every bracket starting in the first knockout round. The finals are the moment the room watches.

## Left to the builder

- Internal names of round kinds and race roles for the new formats, consistent with the existing ones.
- The bracket tree's layout, following existing tokens; it must stay readable for a 16-team bracket on a phone (horizontal scroll is acceptable there) and on the projector.
- Built in two stages, each releasable: (1) seeding rounds, seeding rank, finals only, seeding only, the Setup panel; (2) knockout.
- `docs/design.md`, `README.md`, `docs/user-guide.md`, guide screenshots and PDF updated with the behaviour, per `CLAUDE.md`.
