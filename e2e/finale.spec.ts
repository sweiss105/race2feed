import { test, expect, type Page } from '@playwright/test';
import { openEvents, pairReferee, readyAndStart, setUpEvent, timeEveryone } from './helpers';

const OUT = 'test-results/screens';
const shot = async (page: Page, name: string) => {
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
};

test('penalty review, champion and the end of the event', async ({ browser }) => {
  test.setTimeout(240_000);
  const admin = await setUpEvent(browser, 'E2E Finale');
  await admin.setViewportSize({ width: 1440, height: 900 });
  const ref = await pairReferee(browser, admin, { width: 1180, height: 820 });
  const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await phone.goto('/');
  await phone.getByRole('searchbox').fill('Alp');
  await phone.getByRole('button', { name: /Alpha/ }).click();
  const projector = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  await projector.goto('/projector');

  // Round 1 with penalties on: the referee gives Alpha a penalty.
  await admin.getByRole('link', { name: 'Settings' }).click();
  await admin.getByRole('switch', { name: 'Time penalties' }).click();
  await expect(admin.getByRole('switch', { name: 'Time penalties' })).toBeChecked();
  await admin.getByRole('link', { name: 'Race Control', exact: true }).click();
  await admin.getByRole('button', { name: 'Open round 1' }).click();
  await readyAndStart(admin);
  await ref.getByRole('button', { name: 'Penalty for Alpha' }).click();
  for (const name of ['Alpha', 'Bravo']) {
    const button = ref.getByRole('button', { name: new RegExp(`^${name}`) });
    await expect(button).toBeEnabled();
    await button.click();
  }
  await expect(ref.getByRole('button', { name: /^Bravo/ })).toContainText(/\d:\d\d\.\d\d/);
  await timeEveryone(admin, { Charlie: '3:10.00', Delta: '3:20.50' });
  await admin.getByRole('button', { name: 'Finish now' }).click();
  await expect(admin.locator('.pill')).toHaveText('finished');

  // After the round the referee says why.
  const note = ref.getByRole('region', { name: 'Penalty for Alpha' });
  await note.getByRole('button', { name: 'Started early' }).click();
  await note.getByLabel('Note (optional)').fill('Went before the horn');
  await shot(ref, 'referee-penalty-note');
  await note.getByRole('button', { name: 'Send to race control' }).click();
  await expect(note.getByText(/Sent ✓/)).toBeVisible();
  await expect(phone.getByText(/pending: under review/).first()).toBeVisible();

  // The next round waits for race control's decision.
  await expect(admin.getByRole('button', { name: 'Open round 2' })).toBeDisabled();
  await expect(admin.locator('.race-status')).toHaveText('Waiting on 1 penalty to be reviewed');
  const review = admin.getByRole('region', { name: 'Penalties to review' });
  await expect(review.getByText(/Went before the horn/)).toBeVisible();
  await expect(review.getByLabel('Penalty')).toHaveValue('early');
  await shot(admin, 'console-penalty-review');
  await review.getByRole('button', { name: 'Approve' }).click();
  await expect(review.getByText('All penalties decided.')).toBeVisible();
  await expect(admin.getByRole('button', { name: 'Open round 2' })).toBeEnabled();
  await expect(phone.getByText(/\(incl\. \+10s · Started early\)/).first()).toBeVisible();

  // Race the remaining rounds from the console.
  const times = { Alpha: '3:00.00', Bravo: '3:05.00', Charlie: '3:10.00', Delta: '3:15.00' };
  for (;;) {
    const open = admin.getByRole('button', { name: /^Open round \d+$/ });
    if (!(await open.isVisible())) break;
    await open.click();
    await readyAndStart(admin);
    await timeEveryone(admin, times);
    await admin.getByRole('button', { name: 'Finish now' }).click();
    await expect(admin.locator('.pill')).toHaveText('finished');
  }
  await expect(admin.locator('.race-status')).toHaveText('Event complete');
  await expect(admin.getByRole('button', { name: /^Open round/ })).toHaveCount(0);

  // Show the champion with the bag count.
  await admin.getByRole('button', { name: 'Show champion' }).click();
  const sheet = admin.getByRole('dialog', { name: 'Show the champion' });
  await sheet.getByLabel('Bags of food packed').fill('1,234');
  await sheet.getByRole('button', { name: 'Show' }).click();
  await expect(admin.getByRole('button', { name: 'Hide champion' })).toBeVisible();
  const champion = phone.getByRole('region', { name: 'Champion' });
  await expect(champion.getByText(/1,234 bags/)).toBeVisible();
  await expect(projector.getByText('1,234 bags of food packed!')).toBeVisible();
  await shot(phone, 'phone-champion');
  await shot(projector, 'projector-champion-finale');

  // End the event: tablets are signed out; phones keep the champion.
  await admin.getByRole('link', { name: 'Settings', exact: true }).click();
  await openEvents(admin);
  const row = admin.getByRole('row', { name: /E2E Finale/ });
  await row.getByRole('button', { name: 'End event' }).click();
  await shot(admin, 'console-end-event');
  await admin.getByRole('dialog', { name: /End E2E Finale\?/ }).getByRole('button', { name: 'End event' }).click();
  await expect(row.getByText('Ended')).toBeVisible();
  await expect(ref.getByRole('heading', { name: 'Scan the station QR code' })).toBeVisible();
  await expect(phone.getByText('Event complete')).toBeVisible();
  await expect(champion.getByText(/1,234 bags/)).toBeVisible();
  await phone.reload();
  await expect(phone.getByText('Event complete')).toBeVisible();
  await shot(phone, 'phone-event-complete');
});
