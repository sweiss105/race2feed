import { expect, type Browser, type Page } from '@playwright/test';

export const TEAMS = ['Alpha', 'Bravo', 'Charlie', 'Delta'];

export async function signInAdmin(page: Page) {
  await page.goto('/control');
  await page.getByLabel('Password').fill('e2e-admin');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('link', { name: 'Race' })).toBeVisible();
}

/** Creates, activates and locks a 4-team event on 4 tables. Returns the console page. */
export async function setUpEvent(browser: Browser, name: string) {
  const admin = await (await browser.newContext()).newPage();
  await signInAdmin(admin);
  await admin.getByRole('link', { name: 'Events' }).click();
  await admin.getByLabel('Event name').fill(name);
  await admin.getByLabel('Tables').fill('4');
  await admin.getByRole('button', { name: 'Create event' }).click();
  const row = admin.getByRole('row', { name: new RegExp(name) });
  await expect(row).toBeVisible();
  const activate = row.getByRole('button', { name: 'Make active' });
  if (await activate.isVisible()) await activate.click();
  await expect(row.getByText('Active')).toBeVisible();

  await admin.getByRole('link', { name: 'Teams' }).click();
  await admin.getByLabel('Paste CSV').fill(['team,category', ...TEAMS.map((t) => `${t},Open`)].join('\n'));
  await admin.getByRole('button', { name: 'Import' }).click();
  await expect(admin.getByRole('button', { name: 'Rename Delta' })).toBeVisible();

  await admin.getByRole('link', { name: 'Setup' }).click();
  await admin.getByRole('button', { name: 'Suggest groups and brackets' }).click();
  await expect(admin.getByLabel('Group for Alpha')).toBeVisible();
  await admin.getByRole('button', { name: 'Lock setup' }).click();
  await expect(admin.getByText('Locked')).toBeVisible();
  return admin;
}

/** Pairs a fresh referee context to station 1 via the console's pairing code. */
export async function pairReferee(browser: Browser, admin: Page, viewport?: { width: number; height: number }) {
  await admin.getByRole('link', { name: 'Devices' }).click();
  await admin.getByRole('button', { name: 'Pair tablet for Tables 1 & 2' }).click();
  const code = (await admin.locator('[data-qr]').getAttribute('data-qr'))!.split('code=')[1]!;
  const ref = await (await browser.newContext(viewport ? { viewport } : {})).newPage();
  await ref.goto(`/ref?code=${code}`);
  await expect(ref.getByText('Tables 1 & 2')).toBeVisible();
  return ref;
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
