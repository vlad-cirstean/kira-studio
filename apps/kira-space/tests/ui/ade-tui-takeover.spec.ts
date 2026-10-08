import { expect, test } from './fixtures';
import { adeFixture, openPlan } from './support/adeV2';
import { IPC } from './support/ipcChannels';
import { emitWailsEvent } from './support/mockRuntime';

// A phone controls an agent terminal: the window that holds it shows an overlay and a Reconnect
// button, and a launch the phone started opens its terminal here before the server answers.

const t = (id: string) => `[data-testid="${id}"]`;

const hold = {
  terminalId: 'term-tk01',
  sessionId: 'tk01',
  deviceId: 'dev-1',
  label: 'Pixel 7',
  connected: true,
  since: 1_790_070_000_000,
  returnsAt: 0,
};

const control = [
  { channel: IPC.mobileLaunchOpened, response: null },
  { channel: IPC.mobileReclaimTerminal, response: null },
];

function calls(log: { log(): { channel: string; args?: unknown }[] }, channel: string) {
  return log.log().filter((e) => e.channel === channel);
}

async function phoneLaunch(page: import('@playwright/test').Page): Promise<void> {
  await emitWailsEvent(page, IPC.mobileOpenLaunch, {
    launch: adeFixture('launch'),
    taskId: 'T_bill',
    branchId: 'b_billdash',
  });
}

test('a phone-started launch opens its terminal here, then answers the server', async ({
  relaunch,
}) => {
  const { window: page, control: log } = await openPlan(relaunch, control);
  await phoneLaunch(page);
  await expect.poll(() => calls(log, IPC.terminalOpen)).toHaveLength(1);
  await expect
    .poll(() => calls(log, IPC.mobileLaunchOpened)[0]?.args)
    .toEqual({ terminalId: 'term-tk01', error: '' });
});

test('a hold shows the overlay and the strip badge; Reconnect reclaims the terminal', async ({
  relaunch,
}) => {
  const { window: page, control: log } = await openPlan(relaunch, control);
  await phoneLaunch(page);
  await expect(page.locator(t('ade-tui-pane'))).toBeVisible();
  await expect(page.locator(t('ade-tui-phone-overlay'))).toHaveCount(0);

  await emitWailsEvent(page, IPC.mobileTerminals, [hold]);
  await expect(page.locator(t('ade-tui-phone-overlay'))).toContainText('Controlled from Pixel 7');
  await expect(page.locator(t('ade-session-phone'))).toBeVisible();

  await emitWailsEvent(page, IPC.mobileTerminals, [
    { ...hold, connected: false, returnsAt: 1_790_070_060_000 },
  ]);
  await expect(page.locator(t('ade-tui-phone-offline'))).toContainText('returns here at');

  await page.locator(t('ade-tui-reconnect')).click();
  await expect
    .poll(() => calls(log, IPC.mobileReclaimTerminal)[0]?.args)
    .toMatchObject({ terminalId: 'term-tk01' });

  await emitWailsEvent(page, IPC.mobileTerminals, []);
  await expect(page.locator(t('ade-tui-phone-overlay'))).toHaveCount(0);
  await expect(page.locator(t('ade-session-phone'))).toHaveCount(0);
});
