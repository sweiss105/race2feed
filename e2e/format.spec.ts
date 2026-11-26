import { test, expect, type Browser, type Page } from '@playwright/test';
import { readyAndStart, setUpEvent, timeEveryone } from './helpers';

/**
 * A 4-team, one-category event in another tournament format: setUpEvent locks it as Standard, so unlock,
 * choose the format in Setup's Tournament format panel, rebuild the groups and brackets for it, and lock again.
 */
async function setUpWithFormat(browser: Browser, name: string, choose: string[], summary: string) {
  const admin = await setUpEvent(browser, name);
  await admin.getByRole('button', { name: 'Unlock setup' }).click();
  const panel = admin.getByRole('region', { name: 'Tournament format' });
  for (const choice of choose) {
    // "Seeding only" is both a preset and a bracket format: the preset comes first.
    const option = panel.getByRole('radio', { name: choice, exact: true }).first();
    await option.click();
    await expect(option).toHaveAttribute('aria-checked', 'true');
    await admin.waitForTimeout(200);
  }
  await admin.getByRole('button', { name: 'Suggest groups and brackets' }).click();
  await expect(panel.getByTestId('format-summary')).toHaveText(summary);
  await admin.getByRole('button', { name: 'Lock setup' }).click();
  await expect(admin.getByText('Locked', { exact: true })).toBeVisible();
  await expect(panel.getByText('Setup is locked. Unlock it to change the format.')).toBeVisible();
  await admin.getByRole('link', { name: 'Race Control', exact: true }).click();
  return admin;
}

async function raceRound(admin: Page, round: number, times: Record<string, string>) {
  await admin.getByRole('button', { name: `Open round ${round}`, exact: true }).click();
  await readyAndStart(admin);
  await timeEveryone(admin, times);
  await admin.getByRole('button', { name: 'Finish now' }).click();
  await expect(admin.locator('.pill')).toHaveText('finished');
}

async function showChampion(admin: Page) {
  await expect(admin.locator('.race-status')).toHaveText('Event complete');
  await expect(admin.getByRole('button', { name: /^Open round/ })).toHaveCount(0);
  await admin.getByRole('button', { name: 'Show champion' }).click();
  await admin.getByRole('dialog', { name: 'Show the champion' }).getByRole('button', { name: 'Show' }).click();
  await expect(admin.getByRole('button', { name: 'Hide champion' })).toBeVisible();
}

const projectorPage = async (browser: Browser) => {
  const projector = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  await projector.goto('/projector');
  return projector;
};
const phonePage = async (browser: Browser, team: string) => {
  const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await phone.goto('/');
  await phone.getByRole('searchbox').fill(team.slice(0, 3));
  await phone.getByRole('button', { name: new RegExp(team) }).click();
  await expect(phone.getByRole('heading', { name: team })).toBeVisible();
  return phone;
};

test('Short: one seeding round, one final per bracket, champion', async ({ browser }) => {
  test.setTimeout(180_000);
  const admin = await setUpWithFormat(browser, 'E2E Short', ['Short'], '2 rounds, 5 races');
  const projector = await projectorPage(browser);
  const phone = await phonePage(browser, 'Bravo');

  // The one seeding round: just the time, no run columns.
  await raceRound(admin, 1, { Alpha: '3:00.00', Bravo: '3:05.00', Charlie: '3:10.00', Delta: '3:15.00' });
  await expect(projector.getByRole('heading', { name: 'Seeding results' })).toBeVisible();
  await expect(projector.locator('.row.head')).toHaveText('Time');
  await expect(projector.getByText('Run 1')).toHaveCount(0);
  await expect(phone.getByRole('list', { name: 'Seeding' })).toContainText('Time3:05.00');

  // The one finals round: all four in one race, and its finishing order is the result.
  await raceRound(admin, 2, { Alpha: '3:20.00', Bravo: '3:01.00', Charlie: '3:10.00', Delta: '3:15.00' });
  await expect(projector.getByText('Round 2 · Final')).toBeVisible();
  await expect(projector.getByText(/Placement/)).toHaveCount(0);
  await expect(projector.locator('.race-row').first()).toContainText('Alpha');
  await expect(projector.locator('.race-row').first()).toContainText('4');
  await phone.getByRole('tab', { name: 'Brackets' }).click();
  await expect(phone.getByText('Round 2 · Final')).toBeVisible();
  await expect(phone.locator('.race-row.me')).toContainText('1');

  await showChampion(admin);
  await expect(projector.getByRole('heading', { name: 'Open champion' })).toBeVisible();
  await expect(projector.locator('.proj-champion .name')).toHaveText('Bravo');
  await expect(phone.getByRole('region', { name: 'Champion' })).toContainText('Bravo');
  await expect(phone.getByRole('region', { name: 'Final standings' }).locator('li').first()).toHaveText('1Bravo');
});

test('Seeding only with three runs and Drop the slowest', async ({ browser }) => {
  test.setTimeout(240_000);
  const admin = await setUpWithFormat(browser, 'E2E Seeding only', ['Seeding only', '3 rounds', 'Drop the slowest'], '3 rounds, 12 races');
  await admin.getByRole('link', { name: 'Setup' }).click();
  await expect(admin.getByRole('region', { name: 'Brackets' })).toContainText('Seeding only uses no brackets.');
  await admin.getByRole('link', { name: 'Race Control', exact: true }).click();
  const projector = await projectorPage(browser);
  const phone = await phonePage(browser, 'Alpha');

  // No brackets anywhere: the phone's tab is Standings, and it waits for seeding.
  await expect(phone.getByRole('tab', { name: 'Brackets' })).toHaveCount(0);
  await phone.getByRole('tab', { name: 'Standings' }).click();
  await expect(phone.getByText('Standings are decided by seeding')).toBeVisible();

  // Alpha has one bad run, which is the one left out.
  await raceRound(admin, 1, { Alpha: '3:00.00', Bravo: '3:05.00', Charlie: '3:10.00', Delta: '3:15.00' });
  await raceRound(admin, 2, { Alpha: '4:00.00', Bravo: '3:06.00', Charlie: '3:11.00', Delta: '3:16.00' });
  await raceRound(admin, 3, { Alpha: '3:01.00', Bravo: '3:07.00', Charlie: '3:12.00', Delta: '3:17.00' });

  await expect(projector.getByRole('heading', { name: 'Seeding results' })).toBeVisible();
  await expect(projector.locator('.row.head')).toHaveText('Run 1Run 2Run 3Best two');
  await expect(projector.getByText('Run 2')).toBeVisible();
  const alpha = projector.locator('.proj-seeding .row', { hasText: 'Alpha' });
  await expect(alpha).toContainText('6:01.00');
  await expect(alpha.locator('.n')).toHaveText('1');
  await expect(alpha.locator('s')).toHaveText('4:00.00 not counted');
  await expect(projector.locator('.proj-seeding .row', { hasText: 'Bravo' })).toContainText('6:11.00');

  await expect(phone.getByRole('region', { name: 'Final standings' }).locator('li')).toHaveText(['1Alpha', '2Bravo', '3Charlie', '4Delta']);
  await phone.getByRole('tab', { name: 'My team' }).click();
  const seeding = phone.getByRole('list', { name: 'Seeding' });
  await expect(seeding).toContainText('Best two6:01.00');
  await expect(seeding.locator('s')).toHaveText('4:00.00 not counted');

  await showChampion(admin);
  await expect(projector.getByRole('heading', { name: 'Open champion' })).toBeVisible();
  await expect(projector.locator('.proj-champion .name')).toHaveText('Alpha');
  await expect(phone.getByRole('region', { name: 'Champion' })).toContainText('Alpha');
});
