import { expect, test } from './fixtures';
import { IPC } from './support/ipcChannels';
import { emitWailsEvent } from './support/mockRuntime';

// P212: the Mobile access settings pane and the phone pairing prompt.

const stoppedStatus = {
  enabled: false,
  running: false,
  httpsPort: 7790,
  setupPort: 7791,
  appUrls: [],
  setupUrls: [],
  fingerprint: '',
  leafExpiresAt: 0,
  error: '',
};
const runningStatus = {
  ...stoppedStatus,
  enabled: true,
  running: true,
  appUrls: ['https://192.168.1.20:7790/'],
  setupUrls: ['http://192.168.1.20:7791/'],
  fingerprint: 'AB:CD:EF:01',
};
const device = {
  id: 'dev-1',
  label: 'Pixel 7',
  userAgent: 'Mozilla/5.0',
  createdAt: 1_700_000_000_000,
  lastSeenAt: 1_700_000_100_000,
  lastIp: '192.168.1.40',
  revokedAt: null,
};

async function openPane(window: import('@playwright/test').Page): Promise<void> {
  await emitWailsEvent(window, IPC.openSettings, undefined);
  await window.locator('[data-testid="settings-section-Mobile access"]').click();
}

test('enabling shows the QR codes, URLs and fingerprint', async ({ relaunch }) => {
  const { window, control } = await relaunch({
    control: [{ channel: IPC.mobileSetEnabled, response: runningStatus }],
  });
  await openPane(window);
  await expect(window.locator('[data-testid="mobile-access-step-app"]')).toHaveCount(0);

  await window.locator('[data-testid="mobile-access-enabled"]').click();
  await expect
    .poll(() => control.log().find((e) => e.channel === IPC.mobileSetEnabled)?.args)
    .toEqual({ enabled: true });

  const app = window.locator('[data-testid="mobile-access-step-app"]');
  await expect(app).toContainText('https://192.168.1.20:7790/');
  await expect(app.locator('svg')).toHaveCount(1);
  await expect(window.locator('[data-testid="mobile-access-step-certificate"]')).toContainText(
    'http://192.168.1.20:7791/',
  );
  await expect(window.locator('[data-testid="mobile-access-fingerprint"]')).toHaveText(
    'AB:CD:EF:01',
  );
});

test('revoking a phone confirms first, then calls Revoke', async ({ relaunch }) => {
  const { window, control } = await relaunch({
    control: [
      { channel: IPC.mobileStatusGet, response: runningStatus },
      { channel: IPC.mobileDevicesList, response: [device] },
      { channel: IPC.mobileRevoke, response: null },
    ],
  });
  await openPane(window);
  await expect(window.locator('[data-testid="mobile-device-row-dev-1"]')).toContainText('Pixel 7');

  await window.locator('[data-testid="mobile-device-revoke-dev-1"]').click();
  await expect(window.locator('[data-testid="confirm-dialog"]')).toBeVisible();
  expect(control.log().some((e) => e.channel === IPC.mobileRevoke)).toBe(false);
  await window.locator('[data-testid="confirm-dialog-confirm"]').click();

  await expect
    .poll(() => control.log().find((e) => e.channel === IPC.mobileRevoke)?.args)
    .toEqual({ id: 'dev-1' });
});

test('a pushed device list replaces the rendered one', async ({ relaunch }) => {
  const { window } = await relaunch({
    control: [{ channel: IPC.mobileStatusGet, response: runningStatus }],
  });
  await openPane(window);
  await expect(window.locator('[data-testid="mobile-devices-empty"]')).toBeVisible();
  await emitWailsEvent(window, IPC.mobileDevices, [device]);
  await expect(window.locator('[data-testid="mobile-device-row-dev-1"]')).toBeVisible();
});

const request = {
  requestId: 'req-1',
  clientId: 'c1',
  label: 'Pixel 7',
  code: '4821',
  remoteIp: '192.168.1.40',
  userAgent: 'Mozilla/5.0',
  expiresAtMs: Date.now() + 120_000,
};

test('the pairing prompt shows the code and origin; approve and deny call the bound methods', async ({
  relaunch,
}) => {
  const { window, control } = await relaunch({
    control: [
      { channel: IPC.mobilePairingApprove, response: { result: 'resolved' } },
      { channel: IPC.mobilePairingDeny, response: { result: 'resolved' } },
    ],
  });
  const dialog = window.locator('[data-testid="mobile-pairing-dialog"]');
  await expect(dialog).toHaveCount(0);

  await emitWailsEvent(window, IPC.mobilePairing, { pending: request, queued: 1 });
  await expect(dialog).toBeVisible();
  await expect(window.locator('[data-testid="mobile-pairing-code"]')).toHaveText('4821');
  await expect(window.locator('[data-testid="mobile-pairing-origin"]')).toContainText(
    '192.168.1.40',
  );

  await window.locator('[data-testid="mobile-pairing-approve"]').click();
  await expect
    .poll(() => control.log().find((e) => e.channel === IPC.mobilePairingApprove)?.args)
    .toEqual({ id: 'req-1' });

  await emitWailsEvent(window, IPC.mobilePairing, {
    pending: { ...request, requestId: 'req-2' },
    queued: 1,
  });
  await window.locator('[data-testid="mobile-pairing-deny"]').click();
  await expect
    .poll(() => control.log().find((e) => e.channel === IPC.mobilePairingDeny)?.args)
    .toEqual({ id: 'req-2' });
});
