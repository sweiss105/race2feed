# Race to Feed — live server

The event app runs as one Cloudflare Worker plus one Durable Object (the "hub"):
- The **hub** keeps the event's live state, the master clock and every live connection.
- The **Worker** serves the pages (built from `packages/web`) as static files.

It's served at **https://r2f.weiss-audio.com**.

| Address | Page |
|---|---|
| `/` | Participants: find your team, next table, brackets, results |
| `/projector` | Projector screens |
| `/ref` | Referees (open it by scanning a station QR code from the console) |
| `/control` | Race control console |

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
3. **Set the first console password,** if it isn't set yet. In Cloudflare, go to **Workers & Pages → race2feed → Settings → Variables and Secrets → Add**. Choose type **Secret**, name it `ADMIN_PASSWORD`, enter the value and deploy.

   After that, change passwords in the console under **Settings**.

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

For local development, put `ADMIN_PASSWORD=...` in `packages/server/.dev.vars`. That file is git-ignored.

`npm run e2e` also saves screenshots of every screen to `test-results/screens/`.

## Backups

The hub's storage keeps 30 days of point-in-time recovery. Admin can also export any event as JSON or CSV from the console's **Events** section.
