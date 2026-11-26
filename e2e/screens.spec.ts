import { test, expect, type Page } from '@playwright/test';
import { pairReferee, readyAndStart, setUpEvent, timeEveryone, TEAMS } from './helpers';

const OUT = 'test-results/screens';
/** Waits for entrance animations (projector fades, undo bar) to settle before capturing. */
const shot = async (page: Page, name: string) => {
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
};

test('screens for visual review', async ({ browser }) => {
  test.setTimeout(180_000);
  const admin = await setUpEvent(browser, 'Race to Feed 2026');
  await admin.setViewportSize({ width: 1440, height: 900 });
  const ref = await pairReferee(browser, admin, { width: 390, height: 844 });
  const tablet = await (await browser.newContext({ viewport: { width: 1180, height: 820 } })).newPage();

  const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await phone.goto('/');
  await phone.getByRole('searchbox').fill('a');
  await shot(phone, 'participant-search-light');
  await phone.emulateMedia({ colorScheme: 'dark' });
  await shot(phone, 'participant-search-dark');
  await phone.emulateMedia({ colorScheme: 'light' });
  await phone.getByRole('button', { name: /Alpha/ }).click();

  const projector = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  await projector.goto('/projector');
  await expect(projector.getByRole('heading', { name: 'Race to Feed 2026' })).toBeVisible();
  await shot(projector, 'projector-welcome');

  await admin.getByRole('link', { name: 'Race Control', exact: true }).click();
  await expect(admin.locator('.race-status')).toHaveText('Ready to open round 1');
  await shot(admin, 'console-race-not-started');
  // The same header mid-pulse (the console context otherwise asks for reduced motion; see setUpEvent).
  await admin.emulateMedia({ reducedMotion: 'no-preference' });
  await admin.waitForTimeout(400); // the shot waits 600 more: 1 s into the 2 s loop, the largest glow
  await shot(admin, 'console-race-pulse');
  await admin.emulateMedia({ reducedMotion: 'reduce' });
  await admin.getByRole('button', { name: 'Open round 1' }).click();
  await expect(admin.locator('.race-status')).toHaveText('Waiting on 2 referees to be ready');
  await shot(admin, 'console-race-open');
  await expect(ref.getByRole('button', { name: 'Ready' })).toBeVisible();
  await shot(ref, 'referee-ready-phone');
  await expect(projector.getByRole('heading', { name: 'Round 1' })).toBeVisible();
  await shot(projector, 'projector-tables');
  await expect(phone.getByTestId('next-table')).toBeVisible();
  await shot(phone, 'participant-next-race-light');
  await phone.emulateMedia({ colorScheme: 'dark' });
  await shot(phone, 'participant-next-race-dark');
  await phone.emulateMedia({ colorScheme: 'light' });

  await admin.getByRole('link', { name: 'Settings' }).click();
  await admin.getByRole('switch', { name: 'Time penalties' }).check();
  await admin.getByRole('link', { name: 'Race Control', exact: true }).click();
  await ref.getByRole('button', { name: 'Ready' }).click();
  await readyAndStart(admin);
  await expect(ref.getByRole('button', { name: /^Alpha/ })).toBeEnabled();
  await shot(ref, 'referee-running-phone');
  await ref.emulateMedia({ colorScheme: 'dark' });
  await shot(ref, 'referee-running-phone-dark');
  await ref.emulateMedia({ colorScheme: 'light' });
  await ref.getByRole('button', { name: /^Alpha/ }).click();
  await expect(ref.getByRole('button', { name: 'Undo' })).toBeVisible();
  await shot(ref, 'referee-undo-phone');
  await shot(admin, 'console-race-running-light');
  await admin.emulateMedia({ colorScheme: 'dark' });
  await shot(admin, 'console-race-running-dark');
  await admin.emulateMedia({ colorScheme: 'light' });
  await shot(projector, 'projector-clock');

  // A tablet view of the same referee station (second device paired to station 1).
  const ref2 = await pairReferee(browser, admin, { width: 1180, height: 820 });
  await expect(ref2.getByRole('button', { name: /^Bravo/ })).toBeEnabled();
  await shot(ref2, 'referee-running-tablet');
  void tablet;

  await admin.getByRole('link', { name: 'Race Control', exact: true }).click();
  await timeEveryone(admin, { Bravo: '3:05.10', Charlie: '3:10.00', Delta: '3:20.50' });
  await expect(admin.locator('.race-status')).toHaveText(/^All teams in — finishing in \d+ s$/);
  await shot(admin, 'console-race-all-in');
  await admin.getByRole('button', { name: 'Finish now' }).click();
  await expect(projector.getByRole('heading', { name: 'Seeding results' })).toBeVisible();
  await shot(projector, 'projector-seeding-results');

  // Second seeding run, then open the heats so brackets exist.
  await expect(admin.locator('.race-status')).toHaveText('Ready to open round 2');
  await shot(admin, 'console-race-between-rounds');
  await admin.getByRole('button', { name: 'Open round 2' }).click();
  await readyAndStart(admin);
  await timeEveryone(admin, Object.fromEntries(TEAMS.map((t, i) => [t, `3:0${i}.00`])));
  await admin.getByRole('button', { name: 'Finish now' }).click();
  await expect(admin.locator('.pill')).toHaveText('finished');
  await admin.getByRole('button', { name: 'Open round 3' }).click();
  await expect(admin.locator('.pill')).toHaveText('open');

  await phone.getByRole('tab', { name: 'Brackets' }).click();
  await expect(phone.locator('.bracket-card').first()).toBeVisible();
  await shot(phone, 'participant-brackets-cards');
  await phone.getByRole('tab', { name: 'Diagram' }).click();
  await shot(phone, 'participant-brackets-diagram');
  await phone.emulateMedia({ colorScheme: 'dark' });
  await shot(phone, 'participant-brackets-diagram-dark');

  await admin.getByRole('link', { name: 'Setup' }).click();
  await shot(admin, 'console-setup');
  await admin.getByRole('link', { name: 'Referees', exact: true }).click();
  await shot(admin, 'console-devices');
  await admin.getByRole('link', { name: 'Settings' }).click();
  await shot(admin, 'console-settings');

  const login = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await login.goto('/emergency');
  await shot(login, 'emergency-login');
});
