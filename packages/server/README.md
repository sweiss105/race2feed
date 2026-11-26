# PRC — live server

The event app runs as one Cloudflare Worker plus one Durable Object (the "hub"):
- The **hub** keeps the event's live state, the master clock and every live connection.
- The **Worker** serves the pages (built from `packages/web`) as static files.

It's served at **https://r2f.weiss-audio.com**.

| Address | Page |
|---|---|
| `/` | Participants: find your team, next table, brackets, results |
| `/projector` | Projector screens |
| `/ref` | Referees (open it by scanning a station QR code from the console) |
| `/control` | Race control console (signed in through Cloudflare Access) |
| `/emergency` | Emergency sign-in to the same console, for when Access or email is down |

## How deploys work

Merging into `main` deploys automatically. The GitHub Actions workflow `.github/workflows/deploy.yml`:
1. installs dependencies
2. runs the type check, the unit tests and the browser tests
3. deploys to Cloudflare

Nothing goes live unless every test passes. Pull requests run the same tests without deploying (`.github/workflows/ci.yml`). You can also deploy by hand: GitHub → **Actions** → **Deploy** → **Run workflow**.

### One-time setup: give GitHub access to Cloudflare

1. **Create a token for GitHub to deploy with.** In Cloudflare, go to **My Profile → API Tokens → Create Token** and use the **Edit Cloudflare Workers** template.
   - Add **Zone → DNS → Edit**.
   - Under **Zone Resources**, choose **Include → Specific zone → weiss-audio.com**.
   - Under **Account Resources**, choose your account.
   - Create the token and copy it.
2. **Add two secrets** in GitHub, under the repository's **Settings → Secrets and variables → Actions → New repository secret**:
   - `CLOUDFLARE_API_TOKEN`: the token from step 1.
   - `CLOUDFLARE_ACCOUNT_ID`: your account ID, shown in the Cloudflare dashboard on the right of any domain's **Overview** page.
3. **Console sign-in is Cloudflare Access.** The Access application "PRC console" protects `r2f.weiss-audio.com/control*` and `r2f.weiss-audio.com/api/control/*` with an emailed one-time code. Who may sign in is the allow list on its policy, in Cloudflare's Zero Trust dashboard. The team domain and audience tag the Worker checks are in `wrangler.jsonc` (`ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`); without them the console refuses everyone.
4. **Set the emergency password** before deploying. In Cloudflare, go to **Workers & Pages → race2feed → Settings → Variables and Secrets → Add**, choose type **Secret**, name it `EMERGENCY_PASSWORD` and enter a long password (or run `npx wrangler secret put EMERGENCY_PASSWORD -c packages/server/wrangler.jsonc`). It opens the console at `/emergency` when Access or email is down. Keep it somewhere safe off-site. Without it, `/emergency` is off.
5. **After the first deploy with Access sign-in,** delete the old `ADMIN_PASSWORD` secret there (or `npx wrangler secret delete ADMIN_PASSWORD -c packages/server/wrangler.jsonc`). Nothing reads it any more.

The workflow uses a GitHub environment named `production`. Optionally, under **Settings → Environments → production**, add yourself as a required reviewer so each deploy waits for your click.

## Plan and limits

- The Workers **Free** plan probably covers an event of about 1,750 people. But if a free daily limit is reached, the live parts of the site stop working until midnight UTC.
- Recommended: switch to **Workers Paid ($5/month)** for the event month, then cancel.
- Page files are served as static assets, which are free and unlimited on both plans.

## Develop and test

```bash
npm install
npm test            # builds the pages, then runs engine, server and page tests
npm run typecheck
npm run e2e         # full event in a real browser against a local server
npm run dev         # local server at http://localhost:8787 (run `npm run build` first)
```

For local development, put `DEV_CONSOLE_USER=you@example.com` in `packages/server/.dev.vars` (git-ignored): the local console at `/control` is then signed in as that name, since there is no Cloudflare Access locally. Add `EMERGENCY_PASSWORD=...` there to try `/emergency`.

`npm run e2e` also saves screenshots of every screen to `test-results/screens/`.

## Backups

The hub's storage keeps 30 days of point-in-time recovery. Admin can also export any event as JSON or CSV from the console's **Events** section.
