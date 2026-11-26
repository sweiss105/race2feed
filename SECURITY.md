# Security Policy

PRC (Packing Race Coordinator) is the web app that runs the Race to Feed event at r2f.weiss-audio.com.

## Supported versions

Only the version currently on the `main` branch is supported. It is the version that is deployed. There are no older releases to maintain.

## Reporting a vulnerability

Please report security problems privately, not in a public issue.

1. Go to the **Security** tab of this repository.
2. Choose **Report a vulnerability**.
3. Describe the problem, the steps to reproduce it, and what an attacker could do with it.

What to expect:

- An update when the report has been confirmed or declined, with the reason.
- A fix on `main` as soon as practical for confirmed problems. Reports are credited in the changelog unless you ask not to be named.

Please do not test against the live site during an event, and do not access, change or delete data that is not yours.

## Scope

In scope: the code in this repository and the deployed app.

Out of scope: Cloudflare's own sign-in pages and infrastructure, and problems that need physical access to an unlocked referee device or a signed-in race control laptop.
