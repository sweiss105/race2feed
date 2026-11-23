# Race to Feed — working notes

## Keep the docs current

- `docs/user-guide.md` is the staff-facing user guide. Any change that alters what an admin, race control, referee, participant, projector or Companion user sees or does must update the guide in the same commit.
- When user-facing UI or the guide changes, regenerate the screenshots and PDF with `npm run guide` and commit them (`docs/guide/images/`, `docs/Race-to-Feed-User-Guide.pdf`) with the change. If a screen changes in a way the guide's screenshot flow doesn't cover, update `e2e/guide.spec.ts` too.
- `README.md` covers architecture, local development, testing and deployment. Update it when any of those change (new package, script, secret, route or workflow).
- `docs/design.md` is the spec. Change it before or alongside behavior changes.

## Commands

- `npm test` runs all Vitest projects (engine, server-core, server-worker, web).
- `npm run typecheck` runs the TypeScript checks for all packages.
- e2e: Playwright against `wrangler dev` (see `e2e/` and the root `package.json`).

## Deploys

Merging to `main` deploys to r2f.weiss-audio.com via `.github/workflows/deploy.yml`. Every deploy restarts the hub and drops live sockets, so avoid deploying during an event.
