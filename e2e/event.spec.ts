import { test, expect } from '@playwright/test';
import { pairReferee, setUpEvent } from './helpers';

test('a seeding round across every page', async ({ browser }) => {
  const admin = await setUpEvent(browser, 'E2E Race');
  const ref = await pairReferee(browser, admin);

  const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await phone.goto('/');
  await phone.getByRole('searchbox').fill('Alp');
  await phone.getByRole('button', { name: /Alpha/ }).click();
  await expect(phone.getByRole('heading', { name: 'Alpha' })).toBeVisible();

  const projector = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  await projector.goto('/projector');
  await expect(projector.getByRole('heading', { name: 'E2E Race' })).toBeVisible();

  // Open round 1: referee readies station 1, race control readies station 2, then starts.
  await admin.getByRole('link', { name: 'Race Control', exact: true }).click();
  await admin.getByRole('button', { name: 'Open round 1' }).click();
  await expect(projector.getByRole('heading', { name: 'Round 1' })).toBeVisible();
  await expect(phone.getByTestId('next-table')).toHaveText('1');
  await ref.getByRole('button', { name: 'Ready' }).click();
  await expect(ref.getByText('Ready ✓')).toBeVisible();
  await admin.locator('.station', { hasText: 'Tables 3' }).getByRole('button', { name: 'Ready' }).click();
  await admin.getByRole('button', { name: 'Start' }).click();
  await expect(projector.getByTestId('master-clock')).toBeVisible();

  // Referee taps both teams at its tables.
  for (const name of ['Alpha', 'Bravo']) {
    const button = ref.getByRole('button', { name: new RegExp(`^${name}`) });
    await expect(button).toBeEnabled();
    await button.click();
  }
  await expect(ref.getByRole('button', { name: /^Alpha/ })).toContainText(/\d:\d\d\.\d\d/);

  // Race control enters times for the other two, then finishes.
  for (const [name, time] of [['Charlie', '3:10.00'], ['Delta', '3:20.50']] as const) {
    const row = admin.getByRole('region', { name: 'Results' }).locator('tr', { has: admin.getByRole('cell', { name, exact: true }) });
    await row.getByLabel('Time (m:ss.hh)').fill(time);
    await row.getByRole('button', { name: 'Set' }).click();
    await expect(row).toContainText(time);
  }
  await admin.getByRole('button', { name: 'Finish now' }).click();
  await expect(admin.locator('.pill')).toHaveText('finished');

  // Everyone sees the result.
  await expect(projector.getByRole('heading', { name: 'Seeding results' })).toBeVisible();
  await expect(phone.getByText(/Round 1/).first()).toBeVisible();
  await expect(phone.locator('.list').getByText(/\d:\d\d\.\d\d/).first()).toBeVisible();
});
