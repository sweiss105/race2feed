import { expect, type Browser, type Page } from '@playwright/test';

export const TEAMS = ['Alpha', 'Bravo', 'Charlie', 'Delta'];

/**
 * `wrangler dev` has no Cloudflare Access in front of it: DEV_CONSOLE_USER signs the console in.
 * Waits for the server's first view, so the Events panel on Settings has settled (folded away if an event is active).
 */
export async function signInAdmin(page: Page) {
  const firstView = page.waitForEvent('websocket', (ws) => ws.url().endsWith('/api/control/ws'))
    .then((ws) => ws.waitForEvent('framereceived', (f) => String(f.payload).includes('"type":"view"')));
  await page.goto('/control');
  await firstView;
  // An earlier spec's event may still be active with fairness warnings open: the link then reads
  // "Race Control 2 fairness warnings".
  await expect(page.getByRole('link', { name: /^Race Control/ })).toBeVisible();
}

/** Opens Settings' Events panel if it is folded away (it is while an event is active). */
export async function openEvents(page: Page) {
  const panel = page.locator('details.events-panel');
  await expect(panel).toBeVisible();
  if (!(await panel.evaluate((d: HTMLDetailsElement) => d.open))) await panel.locator('summary').click();
  await expect(page.getByLabel('Event name')).toBeVisible();
}

/** Waits until the console has `name` as its active event (which folds the Events panel away), then reopens the panel. */
export async function waitForActive(page: Page, name: string) {
  await expect(page.locator('details.events-panel > summary')).toContainText(`Active: ${name}`);
  await openEvents(page);
}

/**
 * Creates, activates and locks a one-category event: the four TEAMS on 4 tables unless told otherwise. Returns the console page.
 * The console asks for reduced motion: Playwright never clicks the Race page's pulsing button
 * while it moves, so it would wait forever.
 */
export async function setUpEvent(browser: Browser, name: string, teams: string[] = TEAMS, tables = 4) {
  const admin = await (await browser.newContext({ reducedMotion: 'reduce' })).newPage();
  await signInAdmin(admin);
  await admin.getByRole('link', { name: 'Settings', exact: true }).click();
  await openEvents(admin);
  await admin.getByLabel('Event name').fill(name);
  await admin.getByLabel('Tables').fill(String(tables));
  await admin.getByRole('button', { name: 'Create event' }).click();
  // The list reloads after the server confirms, so it says whether the new event went active by itself.
  const listed = admin.locator('details.events-panel tr', { hasText: name });
  await expect(listed).toBeAttached();
  if (!(await listed.textContent())!.includes('Active')) {
    await openEvents(admin);
    await listed.getByRole('button', { name: 'Make active' }).click();
  }
  await waitForActive(admin, name);
  const row = admin.getByRole('row', { name: new RegExp(name) });
  await expect(row).toBeVisible();
  await expect(row.getByText('Active')).toBeVisible();

  await admin.getByRole('link', { name: 'Teams' }).click();
  await admin.getByLabel('Paste CSV').fill(['team,category', ...teams.map((t) => `${t},Open`)].join('\n'));
  await admin.getByRole('button', { name: 'Import' }).click();
  await expect(admin.getByRole('button', { name: `Rename ${teams.at(-1)}` })).toBeVisible();

  await admin.getByRole('link', { name: 'Setup' }).click();
  await admin.getByRole('button', { name: 'Suggest groups and brackets' }).click();
  await expect(admin.getByLabel(`Group for ${teams[0]}`)).toBeVisible();
  await admin.getByRole('button', { name: 'Lock setup' }).click();
  await expect(admin.getByText('Locked', { exact: true })).toBeVisible();
  return admin;
}

/** Ticks the box on the auto-lock notice shown after pairing and continues to the live page. */
export async function acknowledgeAutoLock(ref: Page) {
  await expect(ref.getByRole('heading', { name: 'Keep your screen on' })).toBeVisible();
  await ref.getByLabel("I've turned off auto-lock on this device").check();
  await ref.getByRole('button', { name: 'Continue' }).click();
}

/** Pairs a fresh referee context to station 1 via the console's pairing code. */
export async function pairReferee(browser: Browser, admin: Page, viewport?: { width: number; height: number }) {
  await admin.getByRole('link', { name: 'Referees', exact: true }).click();
  await admin.getByRole('button', { name: 'Pair device for Tables 1 & 2' }).click();
  const code = (await admin.locator('[data-qr]').getAttribute('data-qr'))!.split('code=')[1]!;
  const ref = await (await browser.newContext(viewport ? { viewport } : {})).newPage();
  await ref.goto(`/ref?code=${code}`);
  await ref.getByLabel('Your name').fill('Ref');
  await ref.getByRole('button', { name: 'Start' }).click();
  await acknowledgeAutoLock(ref);
  await expect(ref.getByText('Tables 1 & 2')).toBeVisible();
  return ref;
}

/** Presses every Ready button on a referee page (one per table with a team), until it waits for the start. */
export async function pressReady(ref: Page) {
  const buttons = ref.getByRole('button', { name: /^Ready/ });
  await expect(buttons.first()).toBeVisible();
  while (await buttons.count()) {
    await buttons.first().click();
    await ref.waitForTimeout(150);
  }
  await expect(ref.getByText('Waiting for the start')).toBeVisible();
}

/** Readies every station from the console, then starts the race. */
export async function readyAndStart(admin: Page) {
  await expect(admin.locator('.pill')).toHaveText('open');
  const notReady = admin.locator('.station').getByRole('button', { name: 'Ready', exact: true });
  while (await notReady.count()) {
    await notReady.first().click();
    await admin.waitForTimeout(150);
  }
  await expect(notReady).toHaveCount(0);
  await admin.getByRole('button', { name: 'Start' }).click();
  await expect(admin.locator('.pill')).toHaveText('running');
}

/** Enters a console time for each named team that races this round. */
export async function timeEveryone(admin: Page, times: Record<string, string>) {
  const results = admin.getByRole('region', { name: 'Results' });
  for (const [name, time] of Object.entries(times)) {
    const row = results.locator('tr', { has: admin.getByRole('cell', { name, exact: true }) });
    if ((await row.count()) === 0) continue;
    await row.getByLabel('Time (m:ss.hh)').fill(time);
    await row.getByRole('button', { name: 'Set' }).click();
    await expect(row).toContainText(time);
  }
}
