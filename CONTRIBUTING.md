# Contributing to PRC

PRC (Packing Race Coordinator) is the web app that runs the Race to Feed event. Thanks for wanting to help.

## Before you start

- **Found a bug?** Open an issue with the steps to reproduce it, what you expected and what happened. For a security problem, follow `SECURITY.md` instead of opening a public issue.
- **Want to add or change a feature?** Open an issue first and describe it. The app is used at a live event, so changes to how a race runs are agreed before they are built.

## Getting set up

The `README.md` explains the layout of the code, local development and deployment. In short:

    npm install
    npm test
    npm run typecheck

## What every change needs

1. **Tests.** Write a test that fails without your change and passes with it. `npm test` and `npm run typecheck` must pass.
2. **End-to-end tests when screens or race flow change.** Run `npm run e2e`.
3. **Documentation in the same change:**
   - `docs/design.md` when behaviour changes. It is the specification.
   - `docs/user-guide.md` when anything staff, referees, participants or the projector see or do changes. Then run `npm run guide` to retake the screenshots and rebuild `docs/PRC-User-Guide.pdf`, and include them.
   - `README.md` when setup, scripts, routes or deployment change.
   - `CHANGELOG.md` for anything staff or operators would want to look up later.
4. **Plain wording.** Text on screen and in the guide is read by volunteers on event day. Use short sentences and everyday words.

## Naming

The software is **PRC**. **Race to Feed** is the event it runs. Please keep that distinction in code comments, screens and documents.

## Sending your change

Open a pull request against `main` that says what changed and why, and how you tested it. Keep each pull request to one topic.

Merging to `main` deploys to the live site and restarts the server, which drops live connections for a moment. Changes are therefore not merged while an event is running.

By contributing, you agree that your work is released under this repository's license (GPL-3.0).
