import { test, expect, type Browser, type Page } from '@playwright/test';
import { acknowledgeAutoLock, openEvents, pressReady, readyAndStart, setUpEvent, timeEveryone } from './helpers';

/** With a fairness warning open the menu link reads "Race Control 1 fairness warnings", so match its start. */
const raceControl = (admin: Page) => admin.getByRole('link', { name: /^Race Control/ });

/** Pairs a fresh referee tablet to a station under a name, through the console's pairing code. */
async function pair(browser: Browser, admin: Page, station: string, name: string) {
  await admin.getByRole('link', { name: 'Referees', exact: true }).click();
  await admin.getByRole('button', { name: `Pair tablet for ${station}` }).click();
  const code = (await admin.locator('[data-qr]').getAttribute('data-qr'))!.split('code=')[1]!;
  const ref = await (await browser.newContext({ viewport: { width: 1180, height: 820 } })).newPage();
  await ref.goto(`/ref?code=${code}`);
  await ref.getByLabel('Your name').fill(name);
  await ref.getByRole('button', { name: 'Start' }).click();
  await acknowledgeAutoLock(ref);
  await expect(ref.getByText(station)).toBeVisible();
  await admin.getByRole('button', { name: 'Done' }).click();
  return ref;
}

/** Races the open round from the console with the given times. */
async function race(admin: Page, times: Record<string, string>) {
  await readyAndStart(admin);
  await timeEveryone(admin, times);
  await admin.getByRole('button', { name: 'Finish now' }).click();
  await expect(admin.locator('.pill')).toHaveText('finished');
}

const SEEDING = { Alpha: '3:00.00', Bravo: '3:05.00', Charlie: '3:10.00', Delta: '3:15.00' };

test('referees rotate, race control swaps them, and a close finish is flagged and dismissed', async ({ browser }) => {
  test.setTimeout(240_000);
  const admin = await setUpEvent(browser, 'E2E Rotation');
  await admin.setViewportSize({ width: 1440, height: 900 });

  // A new event rotates its referees.
  await admin.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(admin.getByRole('switch', { name: 'Rotate referees each round' })).toBeChecked();

  const dana = await pair(browser, admin, 'Tables 1 & 2', 'Dana');
  const lee = await pair(browser, admin, 'Tables 3 & 4', 'Lee');
  const go = (ref: Page, round: number, tables: string) => ref.getByRole('heading', { level: 1, name: `Round ${round}: go to ${tables}` });
  const there = (ref: Page) => ref.getByRole('button', { name: "I'm there" });
  /** The top of the tablet: the tables the referee has this round. */
  const header = (ref: Page) => ref.locator('.ref-meta .headline');

  const stations = admin.getByRole('region', { name: 'Stations' });
  const card = (tables: string) => stations.locator('.station', { has: admin.locator('.headline', { hasText: tables }) });

  // ── Round 1: everyone starts at the tables they paired to, so nobody is told to move ──
  await raceControl(admin).click();
  await admin.getByRole('button', { name: 'Open round 1' }).click();
  await expect(admin.locator('.pill')).toHaveText('open');
  await expect(card('Tables 1 & 2')).toContainText('Dana');
  await expect(card('Tables 3 & 4')).toContainText('Lee');
  await expect(header(dana)).toHaveText('Tables 1 & 2');
  await expect(header(lee)).toHaveText('Tables 3 & 4');
  for (const [ref, teams] of [[dana, ['Alpha', 'Bravo']], [lee, ['Charlie', 'Delta']]] as const) {
    await expect(ref.getByRole('button', { name: /^Ready/ }).first()).toBeVisible();
    await expect(there(ref)).toHaveCount(0);
    for (const team of teams) await expect(ref.getByRole('button', { name: new RegExp(`^Ready.*${team}`) })).toBeVisible();
  }
  await race(admin, SEEDING);

  // ── Round 2: both referees have just judged their teams, so they change places and are told to go ──
  await admin.getByRole('button', { name: 'Open round 2' }).click();
  await expect(admin.locator('.pill')).toHaveText('open');
  await expect(card('Tables 1 & 2')).toContainText('Lee');
  await expect(card('Tables 3 & 4')).toContainText('Dana');
  await expect(go(dana, 2, 'Tables 3 & 4')).toBeVisible();
  await expect(go(lee, 2, 'Tables 1 & 2')).toBeVisible();
  await expect(header(dana)).toHaveText('Tables 3 & 4');
  await expect(header(lee)).toHaveText('Tables 1 & 2');
  // Ready comes after "I'm there".
  await expect(dana.getByRole('button', { name: /^Ready/ })).toHaveCount(0);
  await there(dana).click();
  await expect(go(dana, 2, 'Tables 3 & 4')).toHaveCount(0);
  await expect(dana.getByRole('button', { name: /^Ready/ }).first()).toBeVisible();
  await pressReady(dana);
  await expect(card('Tables 3 & 4')).toContainText('Ready');

  // ── Swap them: the tablets follow, and the Ready given at those tables is cleared ──
  await card('Tables 3 & 4').getByRole('button', { name: 'Swap Dana' }).click();
  const select = stations.getByRole('combobox', { name: 'Swap Dana with' });
  await select.selectOption({ label: 'Lee — Tables 1 & 2' });
  await stations.getByRole('button', { name: 'Swap', exact: true }).click();
  await expect(card('Tables 1 & 2')).toContainText('Dana');
  await expect(card('Tables 3 & 4')).toContainText('Lee');
  await expect(card('Tables 3 & 4')).toContainText('Not ready');
  await expect(header(dana)).toHaveText('Tables 1 & 2');
  await expect(header(lee)).toHaveText('Tables 3 & 4');
  // The swap gave each of them both of last round's teams again, which race control is told about.
  const fairness = admin.getByRole('region', { name: 'Fairness' });
  await expect(fairness.locator('.card', { hasText: 'Same referee, same team' })).toHaveCount(4);
  await expect(fairness.locator('.card', { hasText: 'Dana had Bravo at their tables in rounds 1 and 2.' })).toBeVisible();
  await expect(admin.getByRole('link', { name: 'Race Control 4 fairness warnings' })).toBeVisible();
  // The Referees page says where each one is this round.
  await admin.getByRole('link', { name: 'Referees', exact: true }).click();
  await expect(admin.getByRole('columnheader', { name: 'Starting station' })).toBeVisible();
  await expect(admin.getByRole('row', { name: /Dana/ })).toContainText('this round: Tables 1 & 2');
  await expect(admin.getByRole('row', { name: /Lee/ })).toContainText('this round: Tables 3 & 4');
  await raceControl(admin).click();
  await race(admin, SEEDING);

  // ── Round 3, head to head: two finishes 0.30 s apart at one referee's tables ──
  await admin.getByRole('button', { name: 'Open round 3' }).click();
  await expect(admin.locator('.pill')).toHaveText('open');
  await expect(stations.getByRole('button', { name: /^Swap / })).toHaveCount(2);
  await readyAndStart(admin);
  // Once the race runs, nobody can be swapped.
  await expect(stations.getByRole('button', { name: /^Swap / })).toHaveCount(0);
  await timeEveryone(admin, { Alpha: '3:00.00', Delta: '3:00.30', Bravo: '3:05.00', Charlie: '3:10.00' });
  await admin.getByRole('button', { name: 'Finish now' }).click();
  await expect(admin.locator('.pill')).toHaveText('finished');

  const close = fairness.locator('.card', { hasText: 'Close finish' });
  await expect(close).toHaveCount(1);
  await expect(close).toContainText('Round 3');
  await expect(close).toContainText('Alpha');
  await expect(close).toContainText('Delta');
  const open = await fairness.locator('.card').count();
  await expect(fairness.getByLabel(`${open} to look at`)).toBeVisible();
  await expect(admin.getByRole('link', { name: `Race Control ${open} fairness warning${open === 1 ? '' : 's'}` })).toBeVisible();

  // ── Dismiss it with a note ──
  const note = 'Watched the video with both captains';
  await close.getByRole('button', { name: 'Dismiss' }).click();
  await expect(close.getByRole('button', { name: 'Save' })).toBeDisabled();
  await close.getByLabel('Note').fill(note);
  await close.getByRole('button', { name: 'Save' }).click();
  await expect(fairness.locator('.card', { hasText: 'Close finish' })).toHaveCount(0);
  const dismissed = fairness.locator('details');
  await dismissed.getByText('Dismissed (1)').click();
  await expect(dismissed).toContainText('Close finish');
  await expect(dismissed).toContainText(note);
  await expect(dismissed).toContainText('e2e@example.com');

  // ── The fairness report has the warning, its note and who judged what ──
  await admin.getByRole('link', { name: 'Settings', exact: true }).click();
  await openEvents(admin);
  const href = await admin.getByRole('row', { name: /E2E Rotation/ }).getByRole('link', { name: 'Fairness report' }).getAttribute('href');
  expect(href).toMatch(/format=fairness/);
  const report = await admin.request.get(href!);
  expect(report.ok()).toBe(true);
  const csv = await report.text();
  const line = csv.split('\n').find((l) => l.startsWith('close_finish,'));
  expect(line).toContain('dismissed');
  expect(line).toContain(note);
  expect(csv).toContain('Referee assignments');
});

// A swap after "I'm there" sends the referee on again, even back to the tables they had last round.
test('a referee swapped back to last round\'s tables after pressing "I\'m there" is told to go', async ({ browser }) => {
  const admin = await setUpEvent(browser, 'E2E Swap back');
  const dana = await pair(browser, admin, 'Tables 1 & 2', 'Dana');
  await pair(browser, admin, 'Tables 3 & 4', 'Lee');
  await raceControl(admin).click();
  await admin.getByRole('button', { name: 'Open round 1' }).click();
  await race(admin, SEEDING);
  await admin.getByRole('button', { name: 'Open round 2' }).click();
  await dana.getByRole('button', { name: "I'm there" }).click();
  const stations = admin.getByRole('region', { name: 'Stations' });
  await stations.getByRole('button', { name: 'Swap Dana' }).click();
  await stations.getByRole('combobox', { name: 'Swap Dana with' }).selectOption({ label: 'Lee — Tables 1 & 2' });
  await stations.getByRole('button', { name: 'Swap', exact: true }).click();
  await expect(dana.locator('.ref-meta .headline')).toHaveText('Tables 1 & 2');
  await expect(dana.getByRole('heading', { level: 1, name: 'Round 2: go to Tables 1 & 2' })).toBeVisible();
});
