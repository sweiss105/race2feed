# PRC – Packing Race Coordinator

PRC (Packing Race Coordinator) is the live web app that runs Race to Feed, a charity food-packing race. It is intended to replace the Google Sheet that is currently used to run the event.

On event day:
- **Teams** race at numbered tables.
- **Referees** time them on paired tablets.
- **Race control** runs the rounds from a console.
- **Participants** follow along on their phones.
- **A projector** shows the big screen, and it changes screens by itself as the event moves on.

It covers the whole day: setup, seeding rounds, brackets, the Grand Championship, final standings and the champion screen. It runs on Cloudflare at **https://r2f.weiss-audio.com**.

- **Spec:** [`docs/design.md`](docs/design.md). It is the source of truth for the rules.
- **Guide for event staff:** [`docs/PRC-User-Guide.pdf`](docs/PRC-User-Guide.pdf) (printable, with screenshots), built from [`docs/user-guide.md`](docs/user-guide.md).
- **History of notable changes:** [`CHANGELOG.md`](CHANGELOG.md).
- **Explainer video for event planners:** [`docs/PRC-Race2Feed-Event-Planner-Guide.mp4`](docs/PRC-Race2Feed-Event-Planner-Guide.mp4) (about 4½ minutes; a walk-through of running an event with PRC).

## How it works

### Architecture

```
 phones, projector        referee tablets        race control               Bitfocus Companion
   (public, read-only)      (device cookie)      (Cloudflare Access)          (API key)
          │                        │                       │                        │
          └──────────── HTTPS + WebSocket (/api/*) ────────┴────────────────────────┘
                                         │
                        Cloudflare Worker  (packages/server/src/worker.ts)
                        ├─ static pages from packages/web/dist (Workers static assets)
                        └─ /api/* → one Durable Object, "Hub"  (packages/server/src/hub.ts)
                                     ├─ SQLite: events, audit, emergency sessions,
                                     │          devices, pairing codes, API keys, login failures
                                     ├─ hibernating WebSockets, tagged by role
                                     └─ pure command core (packages/server/src/core)
                                            └─ rules engine (packages/engine)
```

- **One Worker** serves the built pages as static assets and the JSON API. Only `/api/*` runs Worker code first (`run_worker_first`). The Worker signs the console in (see [Console sign-in](#console-sign-in)) and passes the signed-in actor to the hub.
- **One Durable Object, the hub**, holds every event, and only one event is active at a time. The Worker always calls the same instance (`HUB.getByName('hub')`). The hub owns the live state and the master clock, checks credentials and pushes updates to every connected page.
- **The server is the single source of truth.** Each event is stored as one JSON document (`LiveEvent`) holding setup, settings, round state, taps, overrides and tie decisions. Seeding ranks, race places and standings are never stored. They are recomputed each time by the engine's `deriveEvent(setup, progress)`. The one exception is line-ups: when a round opens, the hub saves its races (`lineups`) and, at the first bracket round, each bracket's teams (`bracketMembers`), so a late correction re-tabulates but never rewrites a round that has been opened (`packages/server/src/core/lineups.ts`).
- **Commands go through a pure core.** `applyCommand(event, cmd, ctx)` in `core/apply.ts` checks permissions, applies the rules and returns a new event plus an audit entry, or a refusal with a `code` and a readable `message`. The hub saves the event and the audit entry in one transaction, then broadcasts.
  - The `PERMISSIONS` table in `core/apply.ts` says which role can send each command.
  - Rules and error messages live in `core/setup.ts`, `core/lifecycle.ts`, `core/taps.ts` and `core/corrections.ts`.
  - Commands that aren't about one event's rules (create, activate or end an event, API keys, pairing codes, revoking a device) are handled in `hub.ts`.

### The pages

| Address | Page | Who | How they sign in |
|---|---|---|---|
| `/` | Participants: team search, next table, schedule, brackets, results | Public | None (read-only) |
| `/projector` | Full-screen projector that follows the round state (`?bg=transparent` removes the background, for OBS) | Public | None (read-only) |
| `/ref` | Referee tablet: Ready, finish taps, penalties, undo | Referees | Device cookie from a pairing QR code (`/ref?code=…`) |
| `/control` | Race control console, PRC (Packing Race Coordinator; all sections) | Race control | Cloudflare Access: emailed one-time code |
| `/emergency` | The same console, for when Access or email is down (not linked anywhere) | Race control | The `EMERGENCY_PASSWORD` secret |

Bitfocus Companion has no page. It sends commands with an API key (see [Companion API](#companion-api)).

### Real-time model

Every page opens a WebSocket: `/api/ws` for phones, the projector, referee tablets and Companion; `/api/control/ws` (or `/api/emergency/ws`) for the console. The hub accepts it with the Durable Object **hibernation API**, so idle connections cost nothing. Each socket is tagged by role (`public`, `control`, `referee:<device id>`, `companion`). A referee socket is tagged by device because each referee gets their own view: their tables can change every round (design §3.7).

- **Public pages** connect with `?role=public`. They receive:
  - a full `snapshot` when something structural changes (`core/broadcast.ts` decides which commands need one)
  - otherwise a small `round` update for the current round, at most once a second; a Durable Object alarm sends the last one
- **Signed-in pages** (control, referee, Companion) receive a role-specific `view` after every change: `controlView`, `refereeView` or `companionView` in `core/views.ts`.
- **Commands** are sent over the socket as `{type: 'cmd', id, cmd}` and answered with an `ack`. The same commands are also accepted over HTTP at `POST /api/command`.
- **Clock sync:** pages send `ping` and get `pong` with the server time, NTP-style, to estimate their offset from the server clock.
  - Referee taps are stamped on the tablet in server time.
  - Taps made while offline are queued in local storage and sent later with their original timestamp.
- **Credentials are checked on every message**, so revoking a device or ending an emergency session takes effect immediately (close code `4401`). A console socket signed in through Access closes on the first message after the Access token expires.

### HTTP routes (`packages/server/src/worker.ts`)

| Route | Purpose |
|---|---|
| `GET /api/health` | Liveness check |
| `GET /api/ws` | WebSocket upgrade for phones, the projector, referee tablets and Companion (public, or authenticated by the device cookie or `Authorization: Bearer <key>`; `?role=public` forces public, `?role=referee` authenticates with the device cookie only). A session cookie signs no one in here. |
| `POST /api/pair` | `{code, name}`. Pairs a referee device, stores the name (1–40 chars, else `400 name_required` with the code unspent) and sets the `r2f_device` cookie |
| `POST /api/command` | `{cmd}`. Runs one command as the referee tablet (device cookie) or Companion (Bearer key) |
| `GET /api/me` | Who the tablet or Companion is (role, label, station); `?as=referee` answers from the device cookie only |
| `GET /api/control/me` | The console: who is signed in (`{role: 'admin', label: <email>}`) |
| `POST /api/control/command` | The console: `{cmd}`, run as the signed-in email |
| `GET /api/control/events`, `GET /api/control/apikeys` | The console's lists |
| `GET /api/control/export?event=<id>&format=csv\|json\|fairness` | Export of one event: results (`csv`), the whole event with its log (`json`), or the fairness report (`fairness`, a CSV named `race-to-feed-fairness.csv`: warnings, race control's hand edits, referee assignments) |
| `GET /api/control/ws` | The console's WebSocket |
| `POST /api/emergency/login` | `{password}`, checked against `EMERGENCY_PASSWORD`. Sets the `r2f_session` cookie (12 hours). Rate-limited: 5 failures per IP in 5 minutes. |
| `POST /api/emergency/logout` | Ends the emergency session and closes its sockets |
| `/api/emergency/me`, `/command`, `/events`, `/apikeys`, `/export`, `/ws` | The same as under `/api/control/`, signed in by the `r2f_session` cookie, as `emergency sign-in` |

Every `/api/control/*` and `/api/emergency/*` route answers `403 {error: 'cross_site'}` when the request's `Origin` is another site's or `Sec-Fetch-Site` is `cross-site` (no `Origin` passes). Every `/api/control/*` route answers `401 {error: 'unauthorized'}` without a valid Access token and `503 {error: 'access_not_configured'}` when `ACCESS_TEAM_DOMAIN` or `ACCESS_AUD` is missing. Every `/api/emergency/*` route answers `404` while `EMERGENCY_PASSWORD` is unset, and `401` without a valid session.

Session, device and API-key tokens are stored only as SHA-256 hashes. There is one console role (`admin` in code); a hub start deletes any console password and `control` sessions stored by older versions.

### Console sign-in

- **Cloudflare Access** (application "PRC console") covers `r2f.weiss-audio.com/control*` and `r2f.weiss-audio.com/api/control/*`, with an emailed one-time code and an allow list kept in Cloudflare's Zero Trust dashboard. Sessions last 14 days.
- **The Worker checks Access's token** (`src/auth/access.ts`, `src/auth/console.ts`) on every `/api/control/*` request: the `Cf-Access-Jwt-Assertion` header must be an RS256 token signed by one of the team's keys (`https://{ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`, cached for an hour; if a later fetch fails the cached keys stay in use), from issuer `https://{ACCESS_TEAM_DOMAIN}`, for audience `ACCESS_AUD`, unexpired and with an email. The email is the actor in the log.
- **Cross-site requests are refused** on the console routes, since Access's `CF_Authorization` cookie (SameSite Lax, set on the Access application) and the emergency session are cookies. A console socket that stays silent is still closed (4401) at the first update after its token expires.
- **Console sockets:** the Worker passes the signed-in name and token expiry to the hub in the internal `x-r2f-console` header (URI-encoded JSON, so any email fits in a header; a value that does not decode counts as absent). It deletes that header from every incoming request first, and the hub reads it only on `/api/control/ws` and `/api/emergency/ws`.
- **Emergency sign-in** at `/emergency` is outside Access: one password, the Worker secret `EMERGENCY_PASSWORD`. Nothing links to it; the staff guide's troubleshooting section describes it.
- **Local development and tests:** `DEV_CONSOLE_USER` signs every console request in as that name, except on the production hostname.

### Companion API

The Companion role may send only `startRace`, `finishRace` and `pinProjector`. Every gate still applies.

```http
POST /api/command
Authorization: Bearer <companion key>
Content-Type: application/json

{"cmd": {"type": "startRace"}}
```

- **Accepted:** `200` with `{"ok": true, ...}`.
- **Refused by a gate:** `400` with `{"ok": false, "code": "...", "message": "..."}`, for example `stations_not_ready` or `teams_outstanding`.
- **Bad or revoked key:** `401`.

A WebSocket to `/api/ws` with the same header receives `companionView` updates: `state`, `round`, `startedAt`, `autoFinishAt` (when the round will finish by itself, or `null`), `readyCount`, `stationCount`, `outstanding`, `penaltiesEnabled` and `projector`.

The dedicated Companion module described in design §8 is not in this repository.

## Repository layout

npm workspaces (`packages/*`), TypeScript throughout.

| Path | What it is |
|---|---|
| `packages/engine` | **Pure race rules, no I/O.** Time parsing and formatting, stations, race ranking and ties, seeding rank, bracket plans and formats, seeding groups, round schedule, table layout, and `deriveEvent`. |
| `packages/server` | **Cloudflare Worker + the `Hub` Durable Object.** `src/worker.ts` (routes), `src/hub.ts` (storage, auth, sockets, broadcasts), `src/core/` (pure command handlers and views), `src/auth/` (Cloudflare Access token check, console sign-in, token hashing, rate limiting). Config is in `wrangler.jsonc`. |
| `packages/web` | **Vite multi-page Preact app.** Entry points are `index.html` (participants), `projector/`, `ref/`, `control/`, `emergency/` and `404.html`. Pages are in `src/pages/`, and the console sections are in `src/pages/control/sections/`. Shared code is in `src/lib/` (live connection, clock sync, tap queue, selectors, the console's light/dark preference in `theme.ts`) and `src/ui/`. Builds to `packages/web/dist`. |
| `e2e/` | **Playwright tests.** `event.spec.ts` runs a seeding round across every page. `finale.spec.ts` covers penalty review, the champion and ending the event. `rotation.spec.ts` covers referee rotation, swapping referees, a fairness warning and the fairness report. `format.spec.ts` runs two events in other tournament formats to the champion screen: Short, and Seeding only with three runs and Drop the slowest. `screens.spec.ts` captures screens for visual review. `guide.spec.ts` (run only by `guide.config.ts`) takes the user guide's screenshots. |
| `scripts/` | `build-guide.mjs` turns the user guide into the PDF. |
| `docs/` | The design spec, the staff user guide (Markdown, its screenshots in `docs/guide/images/`, and the PDF), and implementation plans (`docs/superpowers/plans/`). |
| `.github/workflows/` | CI (`ci.yml`) and deploy (`deploy.yml`). |

## Local development

Requirements: Node.js 22 (the version CI uses) and npm.

```bash
npm install              # installs all workspaces
npm run build            # builds the pages into packages/web/dist
npm run dev              # wrangler dev: Worker + Hub + built pages at http://localhost:8787
```

- **Sign the local console in.** `wrangler dev` has no Cloudflare Access in front of it. Put `DEV_CONSOLE_USER=you@example.com` in `packages/server/.dev.vars` (git-ignored) and open `http://localhost:8787/control`: every console request is signed in as that name. It never works on the production hostname. `npm run dev` passes `--local-upstream localhost:8787` because without it wrangler dev reports requests as arriving on the production hostname (the route in `wrangler.jsonc`), where `DEV_CONSOLE_USER` is refused.
- **Try the emergency sign-in locally:** also put `EMERGENCY_PASSWORD=...` in `.dev.vars` and open `http://localhost:8787/emergency`.
- **Rebuild after page changes.** `npm run dev` serves the *built* pages, so run `npm run build` again after changing anything in `packages/web`.
- **The Vite dev server is for the pages alone.** `npm run dev -w @race2feed/web` starts it, but `vite.config.ts` has no proxy to the API, so use the build plus `npm run dev` to run the whole app.
- **Local data** is kept by wrangler under `.wrangler/` (git-ignored).

Other scripts in the root `package.json`:

```bash
npm run typecheck        # tsc --noEmit for engine, server and web
npm test                 # builds the pages (pretest), then runs every Vitest project
npm run e2e              # Playwright against a fresh local wrangler dev server
npm run guide            # retakes the user guide's screenshots and rebuilds its PDF (see Documentation)
npm run measure:hub      # hub load profile: message sizes and CPU per phone, per tap (see Testing)
npm run deploy           # wrangler deploy (normally done by GitHub Actions; see below)
```

## Testing

`npm test` runs Vitest with four projects (root `vitest.config.ts`):

| Project | Where | What it covers |
|---|---|---|
| `@race2feed/engine` | `packages/engine/test` | The rules, including `acceptance.test.ts`, which replays the previous event from `test/fixtures/previous-event.json` and must reproduce the sheet's seeding, brackets, standings and Grand Champion. |
| `server-core` | `packages/server/test/core` | Command handlers, permissions, penalties and reviews, the champion, views, CSV. Runs in Node. |
| `server-worker` | `packages/server/test/worker` | The Worker and Hub in the Workers runtime (`@cloudflare/vitest-plugin`): API, WebSockets, pairing, ending an event. |
| `web` | `packages/web/test` | Pages and libraries in happy-dom, plus build and colour-contrast checks. |

- **Run one project:** for example `npx vitest run --project server-core`.
- **The web tests read the built pages.** Use `npm test` (which builds first), or run `npm run build` before running the `web` project on its own.

**End-to-end:** `npm run e2e` builds the pages and starts `wrangler dev` on port 8787. It uses a throwaway store in `.wrangler/e2e` and signs the console in with `--var DEV_CONSOLE_USER:e2e@example.com`. Then it drives real browser windows: console, referee tablets, phone and projector. Five specs run: `event`, `finale`, `format`, `rotation` and `screens`.
- The first time, install the browser with `npx playwright install --with-deps chromium` (as CI does).
- Screenshots of every screen are saved to `test-results/screens/`.

**Hub load profile:** `npm run measure:hub` estimates what the hub would spend with a crowd of phones connected. It is not part of `npm test`.
- It runs whole events of 50, 100 and 200 teams through the command core in Node. For each stage of the event, it measures the public snapshot's size (plain and gzipped), the round update's size, the time to build one phone's snapshot (what a reconnect costs) and the time to handle one referee tap.
- It then multiplies those figures for 1,750 phones: how long the hub is busy during a reconnect storm, and how much data a snapshot broadcast and the round updates send.
- Change the crowd and the event sizes with `R2F_PEOPLE` and `R2F_TEAMS`, for example `R2F_PEOPLE=2500 R2F_TEAMS=60,120 npm run measure:hub`.
- The report is saved to `test-results/hub-load.md`. The code is in `packages/server/test/load/hub-load.measure.ts`, with its own config in `packages/server/vitest.load.config.ts`.
- Timings come from Node, not the Workers runtime, and leave out Cloudflare's own per-socket costs. Use them to compare sizes and to find hot spots. Only a load test against a deployed Worker shows how it really holds up.

## Deployment

The app is deployed to Cloudflare Workers on the custom domain **r2f.weiss-audio.com** by GitHub Actions.

| Workflow | Trigger | Steps |
|---|---|---|
| `.github/workflows/ci.yml` | Every pull request | `npm ci`, typecheck, `npm test`, install Chromium, `npm run e2e` |
| `.github/workflows/deploy.yml` | Push to `main`, or run by hand (**Actions → Deploy → Run workflow**) | The same checks, then `npm run build` and `npx wrangler deploy -c packages/server/wrangler.jsonc` |

- **Nothing deploys unless every check passes.** Deploys never overlap: a newer push waits for the current deploy.
- **The deploy job uses the GitHub environment `production`.** You can add required reviewers there so each deploy waits for approval.

**Cloudflare config** (`packages/server/wrangler.jsonc`):
- Worker `race2feed`, entry `src/worker.ts`.
- `workers_dev` and preview URLs are off. The route is the custom domain `r2f.weiss-audio.com`.
- Static assets come from `../web/dist`, bound as `ASSETS`. HTML handling is `auto-trailing-slash`, and unknown pages get `404.html`.
- The Durable Object binding `HUB` uses class `Hub`. Migration `v1` declares it as a SQLite-backed class (`new_sqlite_classes`).
- `vars`: `ACCESS_TEAM_DOMAIN` (`silent-butterfly-7498.cloudflareaccess.com`) and `ACCESS_AUD` (the Access application's audience tag). Not secrets.

**Secrets** (names only):

| Name | Where | Used for |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | GitHub Actions secret | `wrangler deploy` |
| `CLOUDFLARE_ACCOUNT_ID` | GitHub Actions secret | `wrangler deploy` |
| `EMERGENCY_PASSWORD` | Cloudflare Worker secret (`npx wrangler secret put EMERGENCY_PASSWORD -c packages/server/wrangler.jsonc`) | The emergency sign-in at `/emergency`. Unset: emergency sign-in is off |
| `ADMIN_PASSWORD` | Cloudflare Worker secret, **no longer used** | Delete it after the first deploy of the Access sign-in: `npx wrangler secret delete ADMIN_PASSWORD -c packages/server/wrangler.jsonc` |

**Deploy order for the Access sign-in:** (1) the Access application and its policy exist, so `/control` asks for the emailed code (then the old password until this version is deployed); (2) set `EMERGENCY_PASSWORD` (`ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` ship in `wrangler.jsonc`); (3) deploy; (4) after the first successful deploy, delete the `ADMIN_PASSWORD` secret.

After this deploy, reload every open console tab and referee tablet: pages loaded before it cannot sign in or pair.

**After the deploy, check:**

- Sign in at `/control` (Cloudflare asks for the email and code; the console opens).
- Press **Sign out** (the next visit to `/control` asks for the email again).
- Open `/emergency` from a private window (the emergency password page appears).

Step-by-step setup for the token and the secrets is in [`packages/server/README.md`](packages/server/README.md), along with notes on the Workers plan and limits.

**Backups:** the hub's SQLite storage has Cloudflare's point-in-time recovery. Admin can also export any event as CSV or JSON, and its fairness report, from the **Events** panel on the console's **Settings** page.

## Documentation

- [`docs/PRC-User-Guide.pdf`](docs/PRC-User-Guide.pdf): the printable staff guide, with screenshots. Hand this to event staff.
- [`docs/PRC-Race2Feed-Event-Planner-Guide.mp4`](docs/PRC-Race2Feed-Event-Planner-Guide.mp4): the explainer video for event planners (about 4½ minutes). It is a recording, not generated from the app: re-record it when the screens change.
- [`docs/user-guide.md`](docs/user-guide.md): the source of that guide: how to run an event, by role (race control, referees, participants, projector, Companion). Its screenshots are in `docs/guide/images/`.
  - **Regenerate the screenshots and the PDF with `npm run guide`.** It builds the pages and starts its own `wrangler dev` on port 8788 (throwaway store in `.wrangler/guide`), runs a fake event ("Race to Feed 2026", made-up teams) through `e2e/guide.spec.ts`, saves the screenshots, then runs `scripts/build-guide.mjs`. Like `npm run e2e`, it signs the console in with `--var DEV_CONSOLE_USER:...` (and `--local-upstream`), and it sets a throwaway `EMERGENCY_PASSWORD` so it can capture the `/emergency` page. Cloudflare's own sign-in page can't be captured locally, so the guide describes it in words.
  - `npm run guide:shots` retakes only the screenshots; `npm run guide:pdf` rebuilds only the PDF (after a text-only change to the guide).
  - It needs Playwright's Chromium (`npx playwright install chromium`, once). `npm run e2e` never runs the guide spec.
- [`docs/design.md`](docs/design.md): the agreed design and rules (event model, round lifecycle, timing, penalties, pages, security, architecture).
