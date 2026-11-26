/**
 * Screenshots for the staff user guide (docs/user-guide.md → docs/PRC-User-Guide.pdf).
 * Run with `npm run guide:shots` (or `npm run guide` for screenshots and PDF). Not part of `npm run e2e`.
 *
 * Drives a whole fake event, "Race to Feed 2026", with made-up teams, on a throwaway local server.
 * Public pages (phone, projector) are opened at r2f.weiss-audio.com so the projector shows the real
 * site address, but every request and WebSocket is answered by the local server (see `publicPage`).
 */
import { test, expect, type Browser, type Locator, type Page } from '@playwright/test';
import { mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openEvents, readyAndStart, signInAdmin, timeEveryone, waitForActive } from './helpers';

const OUT = fileURLToPath(new URL('../docs/guide/images/', import.meta.url));
const SITE = 'http://r2f.weiss-audio.com';

const PHONE = { width: 390, height: 844 };
const TABLET = { width: 1180, height: 820 };
const CONSOLE = { width: 1440, height: 900 };
const PROJECTOR = { width: 1920, height: 1080 };

const CATEGORIES: Record<string, string[]> = {
  Students: ['Alpha', 'Bravo', 'Charlie', 'Delta'],
  Community: ['Echo', 'Foxtrot', 'Golf', 'Hotel'],
};
const TEAMS = Object.values(CATEGORIES).flat();

/** Distinct, realistic times for every team in a round, so no race ends in a tie. */
function roundTimes(round: number): Record<string, string> {
  const pad = (n: number) => String(n).padStart(2, '0');
  return Object.fromEntries(TEAMS.map((t, i) => [t, `3:${pad(10 + ((i * 7 + round * 3) % 40))}.${pad((i * 13 + round * 29) % 100)}`]));
}

/**
 * A page in its own browser window. The console asks for reduced motion: Playwright never clicks the
 * Race page's pulsing button while it moves (see e2e/helpers.ts).
 */
async function context(browser: Browser, viewport: { width: number; height: number }, reducedMotion: 'reduce' | 'no-preference' = 'no-preference') {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, reducedMotion });
  return ctx.newPage();
}

/** A public page at the real site address, served entirely by the local server. Nothing reaches the live site. */
async function publicPage(browser: Browser, viewport: { width: number; height: number }, baseURL: string) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, baseURL: SITE });
  const local = new URL(baseURL);
  await ctx.route(`${SITE}/**`, async (route) => {
    const url = new URL(route.request().url());
    url.protocol = local.protocol;
    url.host = local.host;
    await route.fulfill({ response: await route.fetch({ url: url.href }) });
  });
  await ctx.routeWebSocket((url) => url.host === new URL(SITE).host, (ws) => {
    const url = new URL(ws.url());
    url.host = local.host;
    const server = new WebSocket(url.href);
    // The app's messages are JSON text.
    const waiting: string[] = [];
    server.onopen = () => waiting.splice(0).forEach((m) => server.send(m));
    server.onmessage = (e) => ws.send(String(e.data));
    server.onclose = () => ws.close();
    ws.onMessage((m) => {
      const text = String(m);
      if (server.readyState === WebSocket.OPEN) server.send(text);
      else waiting.push(text);
    });
    ws.onClose(() => server.close());
  });
  return ctx.newPage();
}

const file = (name: string) => ({
  path: `${OUT}${name}`,
  ...(name.endsWith('.jpg') ? { type: 'jpeg' as const, quality: 82 } : { type: 'png' as const }),
});

/** Waits for entrance animations (projector fades, sheets, the undo bar) to settle, then captures the viewport. */
async function shot(page: Page, name: string) {
  await page.waitForTimeout(600);
  await page.screenshot(file(name));
}

/** Captures just the area around one or more elements, with some padding. */
async function region(page: Page, targets: Locator | Locator[], name: string, pad = 20, padBottom = pad) {
  const list = Array.isArray(targets) ? targets : [targets];
  await list[0]!.scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  const boxes = await Promise.all(list.map((l) => l.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + window.scrollX, y: r.top + window.scrollY, right: r.right + window.scrollX, bottom: r.bottom + window.scrollY };
  })));
  const size = await page.evaluate(() => ({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight }));
  const x = Math.max(0, Math.min(...boxes.map((b) => b.x)) - pad);
  const y = Math.max(0, Math.min(...boxes.map((b) => b.y)) - pad);
  const right = Math.min(size.w, Math.max(...boxes.map((b) => b.right)) + pad);
  const bottom = Math.min(size.h, Math.max(...boxes.map((b) => b.bottom)) + padBottom);
  await page.screenshot({ ...file(name), fullPage: true, clip: { x, y, width: right - x, height: bottom - y } });
}

test('screenshots for the user guide', async ({ browser, baseURL }) => {
  test.setTimeout(480_000);
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  // ── Emergency sign-in (the normal sign-in is Cloudflare's own page, which can't be shown locally) ──
  const login = await context(browser, CONSOLE);
  await login.goto('/emergency');
  await login.getByLabel('Password').fill('example-password');
  await region(login, login.locator('form.login'), 'console-emergency-sign-in.png', 40);
  await login.context().close();

  // Locally DEV_CONSOLE_USER (see guide.config.ts) signs the console in, in place of Cloudflare Access.
  const admin = await context(browser, CONSOLE, 'reduce');
  await signInAdmin(admin);

  // ── Settings → Events: last year's event (ended), then this year's ────────
  await admin.getByRole('link', { name: 'Settings', exact: true }).click();
  // With no active event the Events panel is open; it folds away whenever an event becomes active.
  const create = async (name: string, date: string, tables: string) => {
    await openEvents(admin);
    await admin.getByLabel('Event name').fill(name);
    await admin.getByLabel('Date').fill(date);
    await admin.getByLabel('Tables').fill(tables);
    await admin.getByRole('button', { name: 'Create event' }).click();
    await expect(admin.locator('details.events-panel tr', { hasText: name })).toBeAttached();
  };
  await create('Race to Feed 2025', '2025-11-15', '20');
  await waitForActive(admin, 'Race to Feed 2025');
  const lastYear = admin.getByRole('row', { name: /Race to Feed 2025/ });
  await expect(lastYear.getByText('Active')).toBeVisible();
  await lastYear.getByRole('button', { name: 'End event' }).click();
  await admin.getByRole('dialog').getByRole('button', { name: 'End event' }).click();
  await expect(lastYear.getByText('Ended')).toBeVisible();

  await create('Race to Feed 2026', '2026-11-14', '8');
  const event = admin.getByRole('row', { name: /Race to Feed 2026/ });
  // An ended event is still on display, so the new one waits for Make active.
  await event.getByRole('button', { name: 'Make active' }).click();
  await waitForActive(admin, 'Race to Feed 2026');
  await expect(event.getByText('Active')).toBeVisible();
  await admin.getByLabel('Event name').fill('Race to Feed 2027');
  await admin.getByLabel('Date').fill('2027-11-13');
  await admin.getByLabel('Tables').fill('26');
  await region(admin, admin.locator('details.events-panel'), 'console-events.jpg');
  await admin.getByLabel('Event name').fill('');
  // Folded away again, as it is whenever an event is active.
  await admin.locator('details.events-panel > summary').click();
  await region(admin, admin.locator('details.events-panel'), 'console-events-folded.jpg');

  // ── Teams: CSV import ─────────────────────────────────────────────────────
  await admin.getByRole('link', { name: 'Teams' }).click();
  const csv = ['team,category', ...Object.entries(CATEGORIES).flatMap(([c, ts]) => ts.map((t) => `${t},${c}`))].join('\n');
  await admin.getByLabel('Paste CSV').fill(csv);
  await admin.getByLabel('Paste CSV').evaluate((el) => { el.scrollTop = 0; (el as HTMLElement).blur(); });
  await region(admin, [admin.getByRole('heading', { name: 'Teams' }), admin.getByRole('region', { name: 'Import teams' })], 'console-teams-import.jpg');
  await admin.getByRole('button', { name: 'Import' }).click();
  await expect(admin.getByRole('button', { name: 'Rename Hotel' })).toBeVisible();

  // ── Setup: groups, tables, brackets, tables per referee ───────────────────
  await admin.getByRole('link', { name: 'Setup' }).click();
  await admin.getByRole('button', { name: 'Suggest groups and brackets' }).click();
  await expect(admin.getByLabel('Group for Alpha')).toBeVisible();
  // The top of Setup: the status line, the buttons and the Grand Championship switch.
  await region(admin, [admin.getByRole('heading', { name: 'Setup', exact: true }), admin.locator('.race-actions').first()], 'console-setup.jpg');
  // The Tournament format panel, Standard selected, with what the suggested setup adds up to.
  const format = admin.getByRole('region', { name: 'Tournament format' });
  await expect(format.getByRole('radio', { name: 'Standard' })).toHaveAttribute('aria-checked', 'true');
  await expect(format.getByTestId('format-summary')).toHaveText(/^\d+ rounds, \d+ races$/);
  await region(admin, format, 'console-setup-format.jpg', 0);
  await region(admin, admin.getByRole('region', { name: 'Brackets' }), 'console-setup-brackets.jpg');
  await region(admin, admin.getByRole('region', { name: 'Referees' }), 'console-tables-per-referee.jpg');
  await region(admin, admin.getByRole('region', { name: 'Seeding groups' }), 'console-setup-groups.jpg');
  // The guide server runs on a local address; show the real site's addresses in the picture.
  await admin.getByRole('region', { name: 'Screen links' }).locator('input').evaluateAll((inputs) => {
    for (const i of inputs as HTMLInputElement[]) i.value = i.value.replace(location.origin, 'https://r2f.weiss-audio.com');
  });
  await region(admin, admin.getByRole('region', { name: 'Screen links' }), 'console-screen-links.jpg');
  await admin.getByRole('button', { name: 'Lock setup' }).click();
  await expect(admin.getByText('Locked', { exact: true })).toBeVisible();

  // ── Settings: time penalties on ───────────────────────────────────────────
  await admin.getByRole('link', { name: 'Settings' }).click();
  await expect(admin.getByRole('region', { name: 'Penalty list' })).toBeVisible();
  await admin.getByRole('switch', { name: 'Time penalties' }).check();
  await expect(admin.getByRole('switch', { name: 'Time penalties' })).toBeChecked();
  await admin.evaluate(() => window.scrollTo(0, 0));
  await shot(admin, 'console-settings.jpg');
  await region(admin, admin.getByRole('region', { name: 'Penalty list' }), 'console-penalty-list.jpg');
  // The Companion keys panel before any key is created, so no key is ever on screen.
  const keys = admin.locator('section', { has: admin.getByRole('heading', { name: 'Companion keys' }) });
  await keys.getByLabel('Key name').fill('Stream Deck');
  await keys.getByLabel('Key name').blur();
  await region(admin, keys, 'console-companion-keys.jpg');
  await keys.getByLabel('Key name').fill('');
  await region(admin, admin.getByRole('region', { name: 'Appearance' }), 'console-appearance.jpg');

  // ── Referee: an unpaired tablet ───────────────────────────────────────────
  const unpaired = await context(browser, TABLET);
  await unpaired.goto('/ref');
  await expect(unpaired.getByRole('heading', { name: 'Scan the station QR code' })).toBeVisible();
  await region(unpaired, [unpaired.getByRole('heading', { name: 'Scan the station QR code' }), unpaired.getByText(/Race control shows a QR code/)], 'referee-scan.jpg', 48);
  await unpaired.context().close();

  // ── Referees: pair the tablet for tables 1 & 2 ────────────────────────────
  await admin.getByRole('link', { name: 'Referees', exact: true }).click();
  await admin.getByRole('button', { name: 'Pair tablet for Tables 1 & 2' }).click();
  const qr = admin.locator('[data-qr]');
  await expect(qr).toBeVisible();
  await shot(admin, 'console-devices-pairing.jpg');
  const code = (await qr.getAttribute('data-qr'))!.split('code=')[1]!;
  const ref = await context(browser, TABLET);
  await ref.goto(`/ref?code=${code}`);
  await ref.getByLabel('Your name').fill('Sam');
  await region(ref, ref.locator('form.login'), 'referee-name.jpg', 48);
  await ref.getByRole('button', { name: 'Start' }).click();
  await expect(ref.getByRole('heading', { name: 'Keep your screen on' })).toBeVisible();
  await ref.getByLabel("I've turned off auto-lock on this device").check();
  await region(ref, ref.locator('.ref-autolock'), 'referee-auto-lock.jpg', 48);
  await ref.getByRole('button', { name: 'Continue' }).click();
  await expect(ref.getByText('Tables 1 & 2')).toBeVisible();
  await admin.getByRole('button', { name: 'Done' }).click();
  // A referee for every other station too, so each station's card has a name once the round opens.
  for (const [station, name] of [['Tables 3 & 4', 'Dana'], ['Tables 5 & 6', 'Lee'], ['Tables 7 & 8', 'Alex']] as const) {
    await admin.getByRole('button', { name: `Pair tablet for ${station}` }).click();
    await expect(qr).toBeVisible();
    const other = await context(browser, TABLET);
    await other.goto(`/ref?code=${(await qr.getAttribute('data-qr'))!.split('code=')[1]!}`);
    await other.getByLabel('Your name').fill(name);
    await other.getByRole('button', { name: 'Start' }).click();
    await other.getByLabel("I've turned off auto-lock on this device").check();
    await other.getByRole('button', { name: 'Continue' }).click();
    await expect(other.getByText(station)).toBeVisible();
    await admin.getByRole('button', { name: 'Done' }).click();
  }

  // ── Phone and projector, before the first round ───────────────────────────
  const phone = await publicPage(browser, PHONE, baseURL!);
  await phone.goto('/');
  await phone.getByRole('searchbox').fill('a');
  await expect(phone.getByRole('button', { name: /Alpha/ })).toBeVisible();
  await shot(phone, 'phone-search.png');
  await phone.getByRole('button', { name: /Alpha/ }).click();
  await expect(phone.getByText(/your table appears here when it opens/)).toBeVisible();

  const projector = await publicPage(browser, PROJECTOR, baseURL!);
  await projector.goto('/projector');
  await expect(projector.getByRole('heading', { name: 'Race to Feed 2026' })).toBeVisible();
  await shot(projector, 'projector-welcome.jpg');

  // ── Round 1: the big button, then open ────────────────────────────────────
  await admin.getByRole('link', { name: 'Race Control', exact: true }).click();
  const status = admin.locator('.race-status');
  await expect(status).toHaveText('Ready to open round 1');
  // The button mid-pulse: 1 s into its 2 s loop is the largest glow (region() waits 600 ms more).
  await admin.emulateMedia({ reducedMotion: 'no-preference' });
  await admin.waitForTimeout(400);
  await region(admin, admin.locator('header.race-head'), 'console-race-button.jpg', 40, 10);
  await admin.emulateMedia({ reducedMotion: 'reduce' });
  await admin.getByRole('button', { name: 'Open round 1' }).click();
  await expect(admin.locator('.pill')).toHaveText('open');

  await expect(phone.getByTestId('next-table')).toBeVisible();
  await shot(phone, 'phone-next-race.png');
  await expect(projector.getByRole('heading', { name: 'Round 1' })).toBeVisible();

  // The referee readies table 1; table 2's Ready is still to press.
  await ref.getByRole('button', { name: /^Ready: Table 1,/ }).click();
  await expect(ref.getByText('Ready ✓')).toBeVisible();
  await expect(ref.getByRole('button', { name: /^Ready: Table 2,/ })).toBeVisible();
  await shot(ref, 'referee-ready.jpg');
  await expect(admin.locator('.station', { hasText: 'Tables 1 & 2' })).toContainText('1 of 2 tables ready');
  await expect(status).toHaveText('Waiting on 4 referees to be ready');
  await shot(admin, 'console-race-open.jpg');
  // Table 1 ready, the rest not: the projector shows both kinds of dot (the round update is paced, so wait for it).
  await expect(projector.getByRole('img', { name: 'Ready', exact: true })).toHaveCount(1);
  await shot(projector, 'projector-tables.jpg');
  await ref.getByRole('button', { name: /^Ready: Table 2,/ }).click();
  await expect(ref.getByText('Waiting for the start')).toBeVisible();

  // ── Round 1: running ──────────────────────────────────────────────────────
  await readyAndStart(admin);
  // No team is in yet: the projector shows the big clock alone.
  await expect(projector.getByTestId('master-clock')).toBeVisible();
  await projector.waitForTimeout(2000);
  await shot(projector, 'projector-clock-start.jpg');
  const alpha = ref.getByRole('button', { name: /^Alpha/ });
  await expect(alpha).toBeEnabled();
  await ref.waitForTimeout(4000);
  await shot(ref, 'referee-tap-buttons.jpg');
  await ref.getByRole('button', { name: 'Penalty for Alpha' }).click();
  await expect(ref.getByRole('status').filter({ hasText: 'Penalty for Alpha' })).toBeVisible();
  await ref.waitForTimeout(1500);
  await alpha.click();
  await expect(ref.getByRole('status').filter({ hasText: 'Alpha finished' })).toBeVisible();
  await expect(alpha).toContainText(/\d:\d\d\.\d\d/);
  await shot(ref, 'referee-undo.jpg');
  await expect(admin.getByRole('heading', { name: 'Waiting on 7 teams' })).toBeVisible();
  await expect(status).toHaveText('Racing — waiting on 7 teams');
  await shot(admin, 'console-race-running.jpg');
  await ref.waitForTimeout(2000);
  const bravo = ref.getByRole('button', { name: /^Bravo/ });
  await bravo.click();
  await expect(bravo).toContainText(/\d:\d\d\.\d\d/);
  await expect(projector.getByTestId('master-clock')).toBeVisible();
  // Alpha and Bravo are in: the clock has moved up and the list shows them first, the rest still racing.
  const teams = projector.getByLabel('Teams');
  await expect(teams.locator('.row', { hasText: 'Bravo' })).toContainText(/\d:\d\d\.\d\d/);
  await expect(teams.getByRole('img', { name: 'Finished' })).toHaveCount(2);
  await shot(projector, 'projector-clock.jpg');

  // ── Round 1: the referee explains the penalty while the race is still running ──
  const note = ref.getByRole('region', { name: 'Penalty for Alpha' });
  await note.getByRole('button', { name: 'False Start' }).click();
  await note.getByLabel('Note (optional)').fill('Went before the horn');
  await note.getByLabel('Note (optional)').blur();
  await expect(ref.locator('.undo-bar')).toHaveCount(0, { timeout: 15_000 });
  // A taller screen for this one shot, so the whole card shows under the team buttons without scrolling.
  const tablet = ref.viewportSize()!;
  await ref.setViewportSize({ width: tablet.width, height: 1240 });
  await ref.locator('.ref-below').evaluate((el) => { el.scrollTop = 0; });
  await shot(ref, 'referee-penalty-notes.jpg');
  await ref.setViewportSize(tablet);
  await note.getByRole('button', { name: 'Send to race control' }).click();
  await expect(note.getByText(/Sent ✓/)).toBeVisible();

  const r1 = roundTimes(1);
  await timeEveryone(admin, Object.fromEntries(TEAMS.filter((t) => t !== 'Alpha' && t !== 'Bravo').map((t) => [t, r1[t]!])));
  // Every team is in: the auto-finish countdown runs (30 s by default).
  await expect(status).toHaveText(/^All teams in — finishing in \d+ s$/);
  await region(admin, admin.locator('header.race-head'), 'console-race-all-in.jpg', 40, 10);
  await admin.getByRole('button', { name: 'Finish now' }).click();
  await expect(admin.locator('.pill')).toHaveText('finished');

  // ── Round 1: the penalty is pending on phones until race control decides ──
  await expect(phone.getByText(/pending: under review/).first()).toBeVisible();
  await shot(phone, 'phone-results-pending.png');

  // ── Round 1: race control reviews the penalty, then corrects results ──────
  const review = admin.getByRole('region', { name: 'Penalties to review' });
  await expect(review.getByText(/Went before the horn/)).toBeVisible();
  await expect(review.getByLabel('Penalty')).toHaveValue('false-start');
  await expect(status).toHaveText('Waiting on 1 penalty to be reviewed');
  await expect(admin.getByRole('button', { name: 'Open round 2' })).toBeDisabled();
  await admin.evaluate(() => window.scrollTo(0, 0));
  await region(admin, admin.locator('header.race-head'), 'console-race-penalty-waiting.jpg', 40, 10);
  await region(admin, [review.getByRole('heading'), review.locator('.review-card')], 'console-penalty-review.jpg');
  await review.getByRole('button', { name: 'Approve' }).click();
  await expect(review.getByText('All penalties decided.')).toBeVisible();

  const results = admin.getByRole('region', { name: 'Results' });
  const rowOf = (name: string) => results.locator('tr', { has: admin.getByRole('cell', { name, exact: true }) });
  await timeEveryone(admin, { Bravo: '3:18.75' });
  await rowOf('Alpha').getByLabel('Time (m:ss.hh)').fill('3:21.40');
  await region(admin, [results.locator('.race-head'), rowOf('Charlie')], 'console-results.jpg', 20, 1);
  await rowOf('Alpha').getByRole('button', { name: 'Set' }).click();
  await expect(rowOf('Alpha')).toContainText('3:31.40');

  await expect(phone.getByText(/\(incl\. \+10s · False Start\)/).first()).toBeVisible();
  await shot(phone, 'phone-results-penalty.png');

  // ── Round 2: the referees change stations; Sam is sent to Tables 3 & 4 ────
  const stations = admin.getByRole('region', { name: 'Stations' });
  const rotationShots = async () => {
    const card = stations.locator('.station', { has: admin.locator('.headline', { hasText: 'Tables 3 & 4' }) });
    const there = (await card.locator('.station-ref .callout').innerText()).trim();
    // The swap list open on the card for Tables 3 & 4. Who the app put there differs from run to run,
    // so swap Sam in unless Sam is there already.
    await card.getByRole('button', { name: `Swap ${there}` }).click();
    const select = card.getByRole('combobox', { name: `Swap ${there} with` });
    const options = await select.locator('option:not([disabled])').allTextContents();
    await select.selectOption({ label: there === 'Sam' ? options[0]! : options.find((o) => o.startsWith('Sam — '))! });
    await region(admin, stations, 'console-stations-referees.jpg');
    if (there === 'Sam') await card.getByRole('button', { name: 'Cancel' }).click();
    else await card.getByRole('button', { name: 'Swap', exact: true }).click();
    await expect(card.locator('.station-ref .callout')).toHaveText('Sam');
    await expect(ref.getByRole('heading', { level: 1, name: 'Round 2: go to Tables 3 & 4' })).toBeVisible();
    await shot(ref, 'referee-go-to-tables.jpg');
    await ref.getByRole('button', { name: "I'm there" }).click();
    await expect(ref.getByRole('button', { name: /^Ready/ }).first()).toBeVisible();
  };

  // ── Round 3, head to head: two races finish 0.30 s apart, each at one referee's tables ──
  const CLOSE: [string, string][] = [['Bravo', 'Delta'], ['Hotel', 'Foxtrot']];
  const closeFinishes = (times: Record<string, string>) => {
    const out = { ...times };
    for (const [a, b] of CLOSE) {
      const [, min, sec, hundredths] = /^(\d+):(\d\d)\.(\d\d)$/.exec(out[a]!)!;
      const total = Number(min) * 6000 + Number(sec) * 100 + Number(hundredths) + 30;
      const pad = (n: number) => String(n).padStart(2, '0');
      out[b] = `${Math.floor(total / 6000)}:${pad(Math.floor(total / 100) % 60)}.${pad(total % 100)}`;
    }
    return out;
  };
  const fairnessShot = async () => {
    const fairness = admin.getByRole('region', { name: 'Fairness' });
    const close = fairness.locator('.card', { hasText: 'Close finish' });
    await expect(close).toHaveCount(CLOSE.length);
    // Race control has looked into one of them.
    await close.last().getByRole('button', { name: 'Dismiss' }).click();
    await close.last().getByLabel('Note').fill('Watched the video with both captains. The finish was clean.');
    await close.last().getByRole('button', { name: 'Save' }).click();
    await expect(close).toHaveCount(CLOSE.length - 1);
    await fairness.locator('details > summary').click();
    await expect(fairness.locator('details')).toContainText('Watched the video');
    await region(admin, fairness, 'console-fairness.jpg');
  };

  // ── The rest of the event, raced from the console ─────────────────────────
  let round = 1;
  let shownBrackets = false;
  for (;;) {
    const open = admin.getByRole('button', { name: /^Open round \d+$/ });
    if (!(await open.isVisible())) break;
    await open.click();
    round += 1;
    await expect(admin.locator('.pill')).toHaveText('open');
    if (round === 2) await rotationShots();
    await readyAndStart(admin);
    await timeEveryone(admin, round === 3 ? closeFinishes(roundTimes(3)) : roundTimes(round));
    await admin.getByRole('button', { name: 'Finish now' }).click();
    await expect(admin.locator('.pill')).toHaveText('finished');

    if (round === 2) {
      await expect(projector.getByRole('heading', { name: 'Seeding results' })).toBeVisible();
      await shot(projector, 'projector-seeding-results.jpg');
    } else if (!shownBrackets) {
      shownBrackets = true;
      await expect(projector.getByRole('heading', { name: /Brackets/ })).toBeVisible();
      await shot(projector, 'projector-brackets.jpg');
      await phone.getByRole('tab', { name: 'Brackets' }).click();
      await expect(phone.locator('.bracket-card').first()).toBeVisible();
      await shot(phone, 'phone-brackets.png');
      await phone.getByRole('tab', { name: 'My team' }).click();
      await fairnessShot();
    }
  }
  await expect(status).toHaveText('Event complete');

  // ── Show the champion ─────────────────────────────────────────────────────
  await admin.getByRole('button', { name: 'Show champion' }).click();
  const sheet = admin.getByRole('dialog', { name: 'Show the champion' });
  await sheet.getByLabel('Bags of food packed').fill('6,480');
  await shot(admin, 'console-show-champion.jpg');
  await sheet.getByRole('button', { name: 'Show' }).click();
  await expect(admin.getByRole('button', { name: 'Hide champion' })).toBeVisible();
  await expect(phone.getByRole('region', { name: 'Champion' }).getByText(/6,480 bags/)).toBeVisible();
  await expect(projector.getByText('6,480 bags of food packed!')).toBeVisible();
  await phone.evaluate(() => window.scrollTo(0, 0));
  await shot(phone, 'phone-champion.png');
  await shot(projector, 'projector-champion.jpg');

  // ── End the event ─────────────────────────────────────────────────────────
  await admin.getByRole('link', { name: 'Settings', exact: true }).click();
  await openEvents(admin);
  await event.getByRole('button', { name: 'End event' }).click();
  await expect(admin.getByRole('dialog', { name: /End Race to Feed 2026\?/ })).toBeVisible();
  await shot(admin, 'console-end-event.jpg');
  await admin.getByRole('dialog').getByRole('button', { name: 'End event' }).click();
  await expect(event.getByText('Ended')).toBeVisible();

  // ── Delete an event: a throwaway test event, created and then deleted ─────
  await create('Test run', '2026-11-01', '2');
  const throwaway = admin.getByRole('row', { name: /Test run/ });
  await throwaway.getByRole('button', { name: 'Delete' }).click();
  const deleteSheet = admin.getByRole('dialog', { name: 'Delete Test run?' });
  await deleteSheet.getByLabel("Type the event's name to confirm").fill('Test run');
  await expect(deleteSheet.getByRole('button', { name: 'Delete event' })).toBeEnabled();
  await shot(admin, 'console-delete-event.jpg');
  await deleteSheet.getByRole('button', { name: 'Delete event' }).click();
  await expect(deleteSheet).toBeHidden();
  await expect(throwaway).toHaveCount(0);
});
