# Referee rotation and fairness checks — design

Status: **Approved by the owner** · 2026-11-26

## Why

The owner wants the system to design human bias out of the event where it can, and to tell race control when a pattern looks like favouritism. Today a referee stays at one station all night, so the same referee can judge the same teams repeatedly, and nothing looks for patterns.

## Goals

1. Referees rotate between stations each round, so a referee sees each team as few times as possible.
2. In a bracket final or the Grand Championship, the two teams are not judged by the same referee when a spare referee exists.
3. Race control is warned about seven patterns (below). Warnings never block the event.
4. A fairness report can be exported after the event.

## Not in scope

- Conflict-of-interest declarations by referees (offered, not chosen).
- Changing which table a team races at. Table assignments stay exactly as they are.
- Blocking any action because of a warning.
- Showing any warning to participants, the projector, referees or Companion.

## Must not happen

- A round that cannot open, start or finish because of rotation or a warning.
- A table with a team and no referee able to tap for it, when a referee was able to before this change.
- A referee tapping for a table they are not assigned to in that round.
- A warning visible outside the race control console and the fairness report.
- Rotation changing anything in an event where the switch is off, or in rounds already raced.

## Decisions made by the owner

- Referees can physically move between rounds; rotation is wanted.
- "Suspiciously fast" means a time that beats the fastest time recorded so far in the event by 30 seconds or more.
- Wanted checks: same referee/same team, a referee's tables keep winning, suspiciously fast, penalties per referee (repeat and outlier), close finish judged by one person, undo that changes the winner, finals split between referees, fairness report.

## Design

### Rotation

- **Who rotates:** the referee devices paired to the event and not revoked. A device keeps the station it was paired to as its *home station*.
- **When:** when a round is opened, the server assigns each device a station for that round and saves the assignment with the event (round → device → station). Saved assignments for earlier rounds are never rewritten.
- **How the assignment is chosen:** only stations that have a team this round need a referee. Among assignments that give every such station a referee where enough devices exist, pick the one with the lowest cost, where cost counts, for each referee and each team at the assigned station: 1 for every earlier round the referee had that team, plus 3 more if they had that team in the previous round. Ties are broken by the fewest referees moved from their previous station, then by lowest device id, so the result is deterministic. Devices left over get no station that round and see "No tables this round".
- **Fewer devices than stations:** stations are filled in station order as far as the devices go; the rest have no referee, exactly as an unpaired station behaves today (race control uses its own Ready, Finish, DNF and DNS controls).
- **Two devices paired to one home station** (today's allowed case): both rotate as separate referees.
- **Permissions:** for the open or running round a referee's station is the assigned one. Ready, finish taps, penalty taps, undo and penalty notes are checked against it. Penalty notes for an earlier round are checked against that round's assignment.
- **The tablet:** the header shows the round's tables as today. When the assignment differs from the previous round's, the tablet shows a full-width notice, "Round 5: go to Tables 7 & 8", until the referee presses **I'm there**; that press is what a moved referee does before Ready (it is not a new gate on Start: Ready stays the gate).
- **Race control:** the Stations panel shows the referee's name on each station card. A **Swap** control on a card exchanges two referees for the open round, before the start only. A swap that gives a referee a team they have had before is allowed and raises the "same referee, same team" warning.
- **Late pairing or revoking during an open round:** a device paired while a round is open takes the station it was paired to if that station has no referee this round, otherwise it waits for the next round. A revoked device's station has no referee for that round.
- **Switch:** event setting **Rotate referees**, on for new events, off for events created before this change. Off means every device stays at its home station, as today.

### Finals split

- Applies to the deciding race of each bracket and to the Grand Championship race, when the event uses two tables per referee and the race's two teams are at one station.
- If a device has no station that round (a spare), the station is split for that round: the assigned referee keeps the lower table and the spare takes the higher. Each sees and can tap only their own table.
- If no spare exists the round opens as normal and the warning "Final judged by one referee" is raised.

### Warnings

Computed by the server from the saved event (taps, line-ups, assignments, results), so they survive a restart and are the same on every console. Each has a stable id, a kind, the round, the referee and teams involved, and a one-sentence message.

| Kind | Fires when |
|---|---|
| `fast_time` | A team's official time is at least 30 000 ms faster than the fastest official time recorded in the event before that result |
| `referee_wins` | Over at least 6 finished head-to-head or 3-team races, teams at one referee finished better than their seeding predicted in at least 4 more races than they finished worse. Races whose teams were all at that referee are not counted |
| `repeat_team` | A referee is assigned a team for the third time, or in two consecutive rounds |
| `repeat_penalty` | A referee has given penalties to the same team in 2 or more rounds |
| `penalty_outlier` | From round 3 on: a referee has given at least 3 penalties and more than twice the average per referee, or none while the average is at least 2 |
| `close_finish` | Two teams in the same race, both at one referee, finished within 500 ms of each other |
| `undo_changed_winner` | A referee removed a finish tap and the replacement changed which team won that race |
| `final_one_referee` | A final could not be split because no spare referee existed |

- Thresholds are constants in one file, not settings.
- **Where:** a **Fairness** panel on the Race Control page listing open warnings, newest first, with a count badge beside the "Race Control" tab name. Each has a **Dismiss** button that asks for a short note; the dismissal (who, when, note) is saved with the event and logged. Dismissed warnings move to a collapsed "Dismissed" list.
- Warnings are prompts to look. The guide says so in plain words.

### Fairness report

- A third export beside CSV and JSON: **Fairness report (CSV)**.
- Three sections in one file: (1) every warning, with its status and dismissal note; (2) every result or penalty that race control entered, changed or removed by hand, with time and who; (3) one row per referee per round: station, tables and teams.
- Text is escaped as the existing exports are.

## Approaches considered

- **Rotate referees (chosen, owner's decision)** against moving teams between tables. Table assignments reproduce the event's bracket sheet and teams already know where to go.
- **Assignment saved per round (chosen)** against recomputing it from the device list. A device paired or revoked later must not change who judged an earlier round.
- **Warnings computed from the saved event (chosen)** against raising them as events happen and storing them. Computing means a corrected result removes a warning that no longer applies, and nothing can be missed across a restart.
- **Split the station for finals (chosen)** against moving a finalist to another table.

## Left to the builder

- The exact search used to find the lowest-cost assignment (26 tables means at most 13 stations; an exact method is preferred, a deterministic greedy with improvement passes is acceptable if exact is too slow).
- Layout and wording details of the Fairness panel and the tablet notice, following existing tokens and components.
- `docs/design.md`, `README.md`, `docs/user-guide.md`, the guide screenshots and PDF are updated in the same commits as the behaviour, per `CLAUDE.md`.
