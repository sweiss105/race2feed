# Race page workflow, penalty labels and referee hardening — design

Status: **Draft for approval** · 2026-11-23

## Why

After the first live tests the event owner wants race control to be harder to get wrong on the day: one obvious next step, a plain statement of what the room is waiting for, and no "+5s" wording now that race control sets each penalty's real length. Three loose ends from the last review are closed at the same time.

## Goals

1. One large action button on the Race page that always shows the next step.
2. A status line that says what is happening and what is being waited for.
3. A race finishes itself 30 seconds after the last team has a result.
4. A referee's penalty tap adds no time; it only flags the team for review.
5. "+5s" is gone from every label. The penalty on/off switch lives in Settings.
6. Only one referee tab is live per tablet.
7. A refused saved tap always tells the referee.
8. The test gaps listed in the last review are closed.
9. Race control and admin become one role with one password.

## Not in scope

- Changing who can start or finish from Companion; START and FINISH keep their gates.
- Changing how penalties are reviewed, approved or rejected.
- Redesigning any page other than the Race page header.

## Must not happen

- A race finishing by itself while any team still has no result.
- A race finishing by itself while a referee could still undo the last finish.
- A pulsing button that invites an action the server will refuse.

## Decisions made by the owner

- **Penalty tap adds nothing.** The team's time is unchanged until race control approves a reason. On the participant page the team's time carries the label **"pending: under review"** until then.
- **Auto-finish waits 30 seconds**, not 10, so referees have time to enter penalties after the last finish.
- **One live referee tab**, with a "Use this tab instead" takeover.
- **Refused saved taps always show a message.**
- **Close the listed test gaps.**
- **Penalty switch moves to Settings.**
- **Race control and admin are merged.** They are the same people.

## Design

### Race page header

```
Round 5                                              3:12
Waiting on 3 tables to be ready                 ┌──────────────────┐
                                                │                  │
                                                │      START       │   (large; pulses when it can be pressed)
                                                │                  │
                                                └──────────────────┘
Projector: automatic (tables) ▾
```

One button replaces Open next round, Start and Finish. It is roughly three times the current height and width. It pulses (a slow scale-and-glow, about 2 seconds per cycle, switched off for people who ask their device for reduced motion) only when pressing it will work and is the expected next step.

| Situation | Button | Pulses | Status line |
|---|---|---|---|
| No round open, rounds remain, nothing blocking | **Open round N** | yes | "Ready to open round N" (or "Not started" before round 1) |
| Round open, some tables not ready | **Start** (disabled) | no | "Waiting on N tables to be ready" |
| Round open, all tables ready | **Start** | yes | "All tables ready" |
| Racing, teams still out | **Finish now** (disabled) | no | "Racing — waiting on N teams" |
| Racing, every team has a result | **Finish now** | no | "All teams in — finishing in 23 s" |
| Finished, penalties pending | **Open round N** (disabled) | no | "Waiting on N penalties to be reviewed" |
| Finished, tie undecided | **Open round N** (disabled) | no | "Waiting on a tie to be decided" |
| Last round finished, nothing blocking | **Show champion** | yes | "Event complete" |
| Champion showing | **Hide champion** | no | "Champion is showing" |

Calls made here, not by the owner:
- "Finish now" does not pulse: the race finishes itself, and the button is only there to skip the wait.
- When penalties and a tie are both outstanding, the status shows penalties first.
- The existing per-table Ready/Excluded controls, the waiting-on-teams list with DNF/DNS, ties, penalty reviews and results stay below the header as they are.

### Auto-finish

- When every team in the running round has a result (a time, DNF, DNS or DQ), the server sets a finish time 30 seconds ahead.
- Any tap, undo, penalty or correction in that round restarts the 30 seconds. If a team loses its result (undo, or race control clears it), the countdown is cancelled.
- When the time arrives the server finishes the round exactly as the Finish button does, recorded in the log as "auto-finish".
- Finish now and Companion FINISH still work at any point once every team has a result.
- The delay is an event setting, "Auto-finish delay (seconds)", default 30. Setting it to 0 turns auto-finish off (call made here).
- It survives the server going idle: the finish time is stored with the event and driven by the hub's alarm. The hub has a single alarm, already used to pace updates to phones, so the two uses share it by always scheduling the earlier of the two times.
- Consequence already agreed: referees can add penalties from START until the race finishes, so the window after the last finish is now these 30 seconds. After that, penalties go through race control.

### Penalties

- A referee's tap records a pending penalty with no time attached. The tablet button reads **Penalty** (with ×2, ×3 for repeats).
- Race control's approval gives it the chosen reason's time or DQ, as today. Rejecting removes it.
- The "Penalty (seconds)" setting is removed. Penalties stored by earlier versions keep the amounts they have.
- Wherever a team has a pending penalty its time is followed by **"pending: under review"**: participant page, console results and referee tablet. On the projector's finish ticker it is shortened to "under review" (call made here).
- Unchanged: the next round cannot open and the champion cannot be shown while a penalty is pending.
- The switch reads **Time penalties** and sits in Settings under the event's settings. With the roles merged (below), everyone who signs in to the console can reach it. Companion's `penalties_enabled` variable is unchanged.

### One console role

- The console has one sign-in and one password. The sign-in page loses its "Sign in as" choice.
- Everyone who signs in sees every section: Race, Teams, Setup, Devices, Settings, Events and Log.
- Settings has one password to change, labelled **Console password**. The race-control password is removed.
- On the server the `control` role is removed and `admin` remains; every command either role could send is allowed for `admin`. The first-time password still comes from the `ADMIN_PASSWORD` secret.
- **At deploy:** any stored race-control password and any race-control sign-in are deleted, so anyone signed in with the race-control password is signed out and signs in again with the console password. Log entries already written keep the name they were written with.
- Referee tablets (pairing), Companion (API key), phones and the projector are unchanged.
- **Consequence:** everyone running races can now also change setup before it is locked, change the password, end the event and download exports. The owner has said these are the same people.
- Wording: the console and its documents say "race control" for the people and "console password" for the credential; the word "admin" stays only inside the code (call made here).

### Referee tablet

- **One live tab.** The first referee tab on a tablet holds a browser lock. A second tab shows "The referee page is already open in another tab on this tablet" and a **Use this tab instead** button; pressing it makes the first tab go idle with the same message. On a browser without the lock feature the page behaves as it does today.
- **Refused saved taps.** A refusal for a saved tap is shown whichever sending loop received it, and names the round: "The saved tap for Alpha in round 3 was refused: …".

### Tests to add

- a hub test that an event stored before line-ups existed gets them saved on load
- "Open next round" is refused after a correction creates a tie
- the referee socket refuses a browser with no pairing
- the export escapes all four characters and leaves numbers alone
- phones get the small update, not a full refresh, when a tablet pairs
- the two-category boundary for the Grand Championship check
- the plural wording in the correction dialog

## Approaches considered

- **Auto-finish on the server (chosen)** against on the console page. A console timer stops if the laptop sleeps or the tab closes, and two open consoles would both fire. The server already owns the clock and the finish rules.
- **Pending penalty with no time (chosen, owner's decision)** against keeping a hidden 5 seconds. Hidden time shows numbers nobody chose.
- **Remove the race-control role outright (chosen)** against keeping two sign-ins with the same access. Two passwords for one job is one more thing to lose on the day.
- **Browser lock for one live tab (chosen)** against sharing one queue between tabs. Sharing fixes the queue and leaves two screens that can both tap.

## Left to the builder

- Exact button size, the animation curve and colours, following the existing tokens in `packages/web/src/styles/tokens.css`.
- Where the countdown state lives in the event document and how the alarm picks the earlier time.
- `docs/design.md` (§4, §5.1, §5.2, §7.1, §7.2, §7.3, §9), `README.md` and `docs/user-guide.md` are updated in the same commits as the behaviour, per `CLAUDE.md`.
