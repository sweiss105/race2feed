/**
 * Screenshots for the staff user guide (docs/user-guide.md → docs/Race-to-Feed-User-Guide.pdf).
 * Run with `npm run guide:shots` (or `npm run guide` for screenshots and PDF). Not part of `npm run e2e`.
 *
 * Drives a whole fake event, "Race to Feed 2026", with made-up teams, on a throwaway local server.
 * Public pages (phone, projector) are opened at r2f.weiss-audio.com so the projector shows the real
 * site address, but every request and WebSocket is answered by the local server (see `publicPage`).
 */
import { test, expect, type Browser, type Locator, type Page } from '@playwright/test';
import { mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readyAndStart, signInAdmin, timeEveryone } from './helpers';

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

async function context(browser: Browser, viewport: { width: number; height: number }) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2 });
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

  // ── Console sign-in ───────────────────────────────────────────────────────
  const login = await context(browser, CONSOLE);
  await login.goto('/control');
  await login.getByRole('radio', { name: 'Admin' }).click();
  await login.getByLabel('Password').fill('example-password');
  await region(login, login.locator('form.login'), 'console-sign-in.png', 40);
  await login.context().close();

  const admin = await context(browser, CONSOLE);
  await signInAdmin(admin);

  // ── Events: last year's event (ended), then this year's ───────────────────
  await admin.getByRole('link', { name: 'Events' }).click();
  const create = async (name: string, date: string, tables: string) => {
    await admin.getByLabel('Event name').fill(name);
    await admin.getByLabel('Date').fill(date);
    await admin.getByLabel('Tables').fill(tables);
    await admin.getByRole('button', { name: 'Create event' }).click();
    await expect(admin.getByRole('row', { name: new RegExp(name) })).toBeVisible();
  };
  await create('Race to Feed 2025', '2025-11-15', '20');
  const lastYear = admin.getByRole('row', { name: /Race to Feed 2025/ });
  await expect(lastYear.getByText('Active')).toBeVisible();
  await lastYear.getByRole('button', { name: 'End event' }).click();
  await admin.getByRole('dialog').getByRole('button', { name: 'End event' }).click();
  await expect(lastYear.getByText('Ended')).toBeVisible();

  await create('Race to Feed 2026', '2026-11-14', '8');
  const event = admin.getByRole('row', { name: /Race to Feed 2026/ });
  // An ended event is still on display, so the new one waits for Make active.
  await event.getByRole('button', { name: 'Make active' }).click();
  await expect(event.getByText('Active')).toBeVisible();
  await admin.getByLabel('Event name').fill('Race to Feed 2027');
  await admin.getByLabel('Date').fill('2027-11-13');
  await admin.getByLabel('Tables').fill('26');
  await region(admin, [admin.getByRole('heading', { name: 'Events' }), admin.locator('table.table')], 'console-events.jpg');
  await admin.getByLabel('Event name').fill('');

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
  await shot(admin, 'console-setup.jpg');
  await region(admin, admin.getByRole('region', { name: 'Referees' }), 'console-tables-per-referee.jpg');
  await region(admin, admin.getByRole('region', { name: 'Seeding groups' }), 'console-setup-groups.jpg');
  await admin.getByRole('button', { name: 'Lock setup' }).click();
  await expect(admin.getByText('Locked')).toBeVisible();

  // ── Settings ──────────────────────────────────────────────────────────────
  await admin.getByRole('link', { name: 'Settings' }).click();
  await expect(admin.getByRole('region', { name: 'Penalty list' })).toBeVisible();
  await admin.evaluate(() => window.scrollTo(0, 0));
  await shot(admin, 'console-settings.jpg');
  await region(admin, admin.getByRole('region', { name: 'Penalty list' }), 'console-penalty-list.jpg');
  // The Companion keys panel before any key is created, so no key is ever on screen.
  const keys = admin.locator('section', { has: admin.getByRole('heading', { name: 'Companion keys' }) });
  await keys.getByLabel('Key name').fill('Stream Deck');
  await keys.getByLabel('Key name').blur();
  await region(admin, keys, 'console-companion-keys.jpg');
  await keys.getByLabel('Key name').fill('');

  // ── Referee: an unpaired tablet ───────────────────────────────────────────
  const unpaired = await context(browser, TABLET);
  await unpaired.goto('/ref');
  await expect(unpaired.getByRole('heading', { name: 'Scan the station QR code' })).toBeVisible();
  await region(unpaired, [unpaired.getByRole('heading', { name: 'Scan the station QR code' }), unpaired.getByText(/Race control shows a QR code/)], 'referee-scan.jpg', 48);
  await unpaired.context().close();

  // ── Devices: pair the tablet for tables 1 & 2 ─────────────────────────────
  await admin.getByRole('link', { name: 'Devices' }).click();
  await admin.getByRole('button', { name: 'Pair tablet for Tables 1 & 2' }).click();
  const qr = admin.locator('[data-qr]');
  await expect(qr).toBeVisible();
  await shot(admin, 'console-devices-pairing.jpg');
  const code = (await qr.getAttribute('data-qr'))!.split('code=')[1]!;
  const ref = await context(browser, TABLET);
  await ref.goto(`/ref?code=${code}`);
  await expect(ref.getByText('Tables 1 & 2')).toBeVisible();
  await admin.getByRole('button', { name: 'Done' }).click();

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

  // ── Round 1: open, with time penalties on ─────────────────────────────────
  await admin.getByRole('link', { name: 'Race' }).click();
  await admin.getByRole('switch').click();
  await expect(admin.getByRole('switch')).toBeChecked();
  await admin.getByRole('button', { name: 'Open next round' }).click();
  await expect(admin.locator('.pill')).toHaveText('open');

  await expect(ref.getByRole('button', { name: 'Ready' })).toBeVisible();
  await shot(ref, 'referee-ready.jpg');
  await expect(phone.getByTestId('next-table')).toBeVisible();
  await shot(phone, 'phone-next-race.png');
  await expect(projector.getByRole('heading', { name: 'Round 1' })).toBeVisible();
  await shot(projector, 'projector-tables.jpg');

  await ref.getByRole('button', { name: 'Ready' }).click();
  await expect(ref.getByText('Ready ✓')).toBeVisible();
  await expect(admin.getByText('3 stations not ready yet.')).toBeVisible();
  await shot(admin, 'console-race-open.jpg');

  // ── Round 1: running ──────────────────────────────────────────────────────
  await readyAndStart(admin);
  const alpha = ref.getByRole('button', { name: /^Alpha/ });
  await expect(alpha).toBeEnabled();
  await ref.waitForTimeout(4000);
  await shot(ref, 'referee-tap-buttons.jpg');
  await ref.getByRole('button', { name: '+5s penalty for Alpha' }).click();
  await expect(ref.getByRole('status').filter({ hasText: 'Penalty for Alpha' })).toBeVisible();
  await ref.waitForTimeout(1500);
  await alpha.click();
  await expect(ref.getByRole('status').filter({ hasText: 'Alpha finished' })).toBeVisible();
  await expect(alpha).toContainText(/\d:\d\d\.\d\d/);
  await shot(ref, 'referee-undo.jpg');
  await expect(admin.getByRole('heading', { name: 'Waiting on 7 teams' })).toBeVisible();
  await shot(admin, 'console-race-running.jpg');
  await ref.waitForTimeout(2000);
  const bravo = ref.getByRole('button', { name: /^Bravo/ });
  await bravo.click();
  await expect(bravo).toContainText(/\d:\d\d\.\d\d/);
  await expect(projector.getByTestId('master-clock')).toBeVisible();
  await expect(projector.getByLabel('Finished')).toContainText('Bravo');
  await shot(projector, 'projector-clock.jpg');

  const r1 = roundTimes(1);
  await timeEveryone(admin, Object.fromEntries(TEAMS.filter((t) => t !== 'Alpha' && t !== 'Bravo').map((t) => [t, r1[t]!])));
  await admin.getByRole('button', { name: 'Finish' }).click();
  await expect(admin.locator('.pill')).toHaveText('finished');

  // ── Round 1: the referee explains the penalty ─────────────────────────────
  const note = ref.getByRole('region', { name: 'Penalty for Alpha' });
  await note.getByRole('button', { name: 'Started early' }).click();
  await note.getByLabel('Note (optional)').fill('Went before the horn');
  await note.getByLabel('Note (optional)').blur();
  await expect(ref.locator('.undo-bar')).toHaveCount(0, { timeout: 15_000 });
  await region(ref, [ref.getByText('Round 1 finished'), ref.locator('.ref-notes')], 'referee-penalty-notes.jpg', 20);
  await note.getByRole('button', { name: 'Send to race control' }).click();
  await expect(note.getByText(/Sent ✓/)).toBeVisible();

  // ── Round 1: race control corrects results and reviews the penalty ────────
  const results = admin.getByRole('region', { name: 'Results' });
  const rowOf = (name: string) => results.locator('tr', { has: admin.getByRole('cell', { name, exact: true }) });
  await timeEveryone(admin, { Bravo: '3:18.75' });
  await rowOf('Alpha').getByLabel('Time (m:ss.hh)').fill('3:21.40');
  await region(admin, [results.locator('.race-head'), rowOf('Charlie')], 'console-results.jpg', 20, 1);
  await rowOf('Alpha').getByRole('button', { name: 'Set' }).click();
  await expect(rowOf('Alpha')).toContainText('3:26.40');

  const review = admin.getByRole('region', { name: 'Penalties to review' });
  await expect(review.getByText(/Went before the horn/)).toBeVisible();
  await expect(review.getByLabel('Penalty')).toHaveValue('early');
  await region(admin, [review.getByRole('heading'), review.locator('.review-card')], 'console-penalty-review.jpg');
  await review.getByRole('button', { name: 'Approve' }).click();
  await expect(review.getByText('All penalties decided.')).toBeVisible();

  await expect(phone.getByText(/\(incl\. \+10s · Started early\)/).first()).toBeVisible();
  await shot(phone, 'phone-results-penalty.png');

  // ── The rest of the event, raced from the console ─────────────────────────
  let round = 1;
  let shownBrackets = false;
  for (;;) {
    const open = admin.getByRole('button', { name: 'Open next round' });
    if (!(await open.isVisible())) break;
    await open.click();
    round += 1;
    await readyAndStart(admin);
    await timeEveryone(admin, roundTimes(round));
    await admin.getByRole('button', { name: 'Finish' }).click();
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
    }
  }
  await expect(admin.getByRole('button', { name: 'No rounds left' })).toBeDisabled();

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
  await admin.getByRole('link', { name: 'Events' }).click();
  await event.getByRole('button', { name: 'End event' }).click();
  await expect(admin.getByRole('dialog', { name: /End Race to Feed 2026\?/ })).toBeVisible();
  await shot(admin, 'console-end-event.jpg');
  await admin.getByRole('dialog').getByRole('button', { name: 'End event' }).click();
  await expect(event.getByText('Ended')).toBeVisible();
});
