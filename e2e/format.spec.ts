import { test, expect, type Browser, type Page } from '@playwright/test';
import { readyAndStart, setUpEvent, timeEveryone } from './helpers';

/**
 * A one-category event (4 teams unless told otherwise) in another tournament format: setUpEvent locks it as Standard, so unlock,
 * choose the format in Setup's Tournament format panel, rebuild the groups and brackets for it, and lock again.
 */
async function setUpWithFormat(browser: Browser, name: string, choose: string[], summary: string, teams?: string[], tables?: number) {
  const admin = await setUpEvent(browser, name, teams, tables);
  await admin.getByRole('button', { name: 'Unlock setup' }).click();
  const panel = admin.getByRole('region', { name: 'Tournament format' });
  for (const choice of choose) {
    // "Knockout" is both a preset and a bracket format: the preset comes first.
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

test('Knockout: six teams, two byes, to the champion', async ({ browser }) => {
  test.setTimeout(240_000);
  const SIX = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot'];
  const admin = await setUpWithFormat(browser, 'E2E Knockout', ['Knockout', '1 round'], '4 rounds, 12 races', SIX, 6);
  await admin.getByRole('link', { name: 'Setup' }).click();
  await expect(admin.getByRole('region', { name: 'Brackets' })).toContainText('A knockout bracket has 2 to 6 teams (as many as there are tables).');
  await expect(admin.getByLabel('Open tier 1 size')).toHaveValue('6');
  await admin.getByRole('link', { name: 'Race Control', exact: true }).click();
  const projector = await projectorPage(browser);
  const phone = await phonePage(browser, 'Bravo');
  const match = (page: Page, name: string) => page.getByRole('group', { name, exact: true });
  const rows = (page: Page, name: string) => match(page, name).locator('.ko-row');

  // Seeding: Alpha is seed 1 … Foxtrot seed 6.
  await raceRound(admin, 1, { Alpha: '3:00.00', Bravo: '3:01.00', Charlie: '3:02.00', Delta: '3:03.00', Echo: '3:04.00', Foxtrot: '3:05.00' });
  await phone.getByRole('tab', { name: 'Brackets' }).click();
  await expect(phone.getByText('Brackets appear once seeding is done and the first bracket round opens.')).toBeVisible();
  // Race control already has the tree, with the top two seeds' byes.
  const consoleTree = admin.getByRole('region', { name: 'Brackets' });
  await expect(consoleTree.getByText('Bye')).toHaveCount(2);

  // Quarter-finals: only seeds 3 to 6 race; Alpha and Bravo have a bye. The lower seeds win both.
  await raceRound(admin, 2, { Delta: '3:12.00', Echo: '3:06.00', Charlie: '3:10.00', Foxtrot: '3:07.00' });
  await expect(projector.getByRole('heading', { name: 'Open Gold' })).toBeVisible();
  await expect(projector.locator('.ko-tree h5')).toHaveText(['Quarter-finals', 'Semi-finals', 'Final']);
  await expect(projector.getByText('Bye')).toHaveCount(2);
  await expect(rows(projector, 'Quarter-final 1')).toHaveText(['4Delta3:12.00', '5Echo3:06.00']);
  await expect(match(projector, 'Quarter-final 1').locator('.ko-row.win')).toHaveText('5Echo3:06.00');
  // The semi-final names its teams when its round opens: until then it waits for the quarter-final's winner.
  await expect(rows(phone, 'Semi-final 1')).toHaveText(['1Alpha', 'Winner of Quarter-final 1']);
  await expect(rows(phone, 'Third place')).toHaveText(['Loser of Semi-final 1', 'Loser of Semi-final 2']);

  // Semi-finals: the teams with a bye come in against the quarter-final winners.
  await admin.getByRole('button', { name: 'Open round 3', exact: true }).click();
  await expect(rows(phone, 'Semi-final 1')).toHaveText(['1Alpha—', '5Echo—']);
  await expect(rows(phone, 'Semi-final 2')).toHaveText(['2Bravo—', '6Foxtrot—']);
  await expect(phone.locator('.ko-row.me')).toHaveCount(2);
  await readyAndStart(admin);
  await timeEveryone(admin, { Alpha: '3:00.00', Echo: '3:08.00', Bravo: '3:01.00', Foxtrot: '3:09.00' });
  await admin.getByRole('button', { name: 'Finish now' }).click();
  await expect(admin.locator('.pill')).toHaveText('finished');

  // The final and the third-place race, in the same round.
  await admin.getByRole('button', { name: 'Open round 4', exact: true }).click();
  await expect(rows(phone, 'Final')).toHaveText(['1Alpha—', '2Bravo—']);
  await expect(rows(phone, 'Third place')).toHaveText(['5Echo—', '6Foxtrot—']);
  await expect(admin.getByRole('region', { name: 'Results' })).toContainText('Open Gold · Third place');
  await readyAndStart(admin);
  await timeEveryone(admin, { Alpha: '3:02.00', Bravo: '2:59.00', Echo: '3:11.00', Foxtrot: '3:05.00' });
  await admin.getByRole('button', { name: 'Finish now' }).click();
  await expect(admin.locator('.pill')).toHaveText('finished');
  await expect(match(projector, 'Final').locator('.ko-row.win')).toHaveText('2Bravo2:59.00');
  await expect(match(projector, 'Third place').locator('.ko-row.win')).toHaveText('6Foxtrot3:05.00');

  await showChampion(admin);
  await expect(projector.getByRole('heading', { name: 'Open champion' })).toBeVisible();
  await expect(projector.locator('.proj-champion .name')).toHaveText('Bravo');
  await expect(phone.getByRole('region', { name: 'Champion' })).toContainText('Bravo');
  // Final, third place, then the quarter-final losers by their time in that round.
  await expect(phone.getByRole('region', { name: 'Final standings' }).locator('li'))
    .toHaveText(['1Bravo', '2Alpha', '3Foxtrot', '4Echo', '5Charlie', '6Delta']);
});
