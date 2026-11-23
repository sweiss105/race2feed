# Race to Feed — live server

The live server for the event app: one Cloudflare Worker plus one Durable Object (the "hub")
that keeps the event's live state, the master clock and every live connection.
It is served at **https://r2f.weiss-audio.com**.

## Deploy

Run these from the repository root. You need a Cloudflare account that manages the
`weiss-audio.com` DNS (it already does).

1. Sign in to Cloudflare once on this computer:

   ```bash
   npx wrangler login
   ```

2. Set the first admin password. It is stored as an encrypted Worker secret, and you can
   change it later from the admin page.

   ```bash
   npx wrangler secret put ADMIN_PASSWORD -c packages/server/wrangler.jsonc
   ```

3. Deploy. The first deploy also creates the `r2f.weiss-audio.com` custom domain and its
   HTTPS certificate (this can take a few minutes the first time).

   ```bash
   npm run deploy
   ```

4. Check it is up: <https://r2f.weiss-audio.com/api/health> should show `{"ok":true}`.
   The admin, race control, referee, participant and projector pages arrive in the next
   build stage; until then the API can be driven from the command line.

## Plan and limits

- The Workers **Free** plan probably covers an event of about 1,750 people, but if a free
  daily limit is reached the live parts of the site stop working until midnight UTC.
- Recommended: switch to **Workers Paid ($5/month)** for the event month, then cancel.

## Develop and test

```bash
npm test            # engine + server tests (server tests run in the Workers runtime)
npm run typecheck
npm run dev         # local server at http://localhost:8787
```

For local development, put `ADMIN_PASSWORD=...` in `packages/server/.dev.vars`
(this file is git-ignored).

## Backups

The hub's storage keeps 30 days of point-in-time recovery. Admin can also export an event
as JSON or CSV from `/api/export?event=<id>&format=json|csv`.
