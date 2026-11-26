import { test, expect } from '@playwright/test';
import { pairReferee, readyAndStart, setUpEvent } from './helpers';

const OUT = 'test-results/screens';

test('a finish sent late is held until race control confirms it', async ({ browser }) => {
  test.setTimeout(120_000);
  const admin = await setUpEvent(browser, 'E2E Late finish');
  await admin.setViewportSize({ width: 1440, height: 900 });
  const ref = await pairReferee(browser, admin, { width: 1180, height: 820 });
  await admin.getByRole('link', { name: 'Race Control', exact: true }).click();
  await admin.getByRole('button', { name: 'Open round 1' }).click();
  await readyAndStart(admin);
  await expect(ref.getByRole('button', { name: /^Alpha/ })).toBeEnabled();

  // The referee tapped Alpha 11 seconds ago with no connection: the tap is in the device's saved
  // queue, and goes out when the page is next connected (here, after a reload).
  await ref.waitForTimeout(12_000);
  const teamId = await admin.getByRole('region', { name: 'Outstanding' }).locator('tr', { hasText: 'Alpha' }).getAttribute('data-team');
  await ref.evaluate(({ teamId }) => {
    const cmd = { type: 'tapFinish', teamId, atServerMs: Date.now() - 11_000, clientTapId: 'saved-offline', round: 1 };
    localStorage.setItem('r2f.tapQueue', JSON.stringify([{ clientTapId: cmd.clientTapId, cmd, round: 1 }]));
  }, { teamId });
  await ref.reload();

  // The referee sees it is waiting; race control sees it held, with Alpha still without a result.
  const alpha = ref.getByRole('button', { name: /^Alpha/ });
  await expect(alpha).toContainText('Sent late — waiting for race control');
  await expect(alpha).toBeDisabled();
  const held = admin.getByRole('region', { name: 'Late finishes to confirm' });
  await expect(held).toContainText('Alpha');
  await expect(held).toContainText(/received 1\d s after the tap/);
  await expect(admin.getByRole('region', { name: 'Outstanding' })).toContainText('Alpha');
  await held.scrollIntoViewIfNeeded();
  await admin.screenshot({ path: `${OUT}/late-finish-console.png` });
  await ref.screenshot({ path: `${OUT}/late-finish-referee.png` });

  await held.getByRole('button', { name: "Confirm Alpha's late finish" }).click();
  await expect(held).toContainText('All late finishes decided.');
  await expect(alpha).toContainText(/\d:\d\d\.\d\d/);
  await expect(admin.getByRole('region', { name: 'Outstanding' })).not.toContainText('Alpha');
});
