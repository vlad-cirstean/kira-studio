import type { Page } from '@playwright/test';
import { defaultSettings } from '../../frontend/src/state/settingsDomain';
import { expect, test } from './fixtures';
import { FIXED_NOW, openPlan } from './support/adeV2';
import { contract } from './support/contract';
import { IPC } from './support/ipcChannels';
import { emitWailsEvent } from './support/mockRuntime';

// P239: the Claude Code usage limits item in the ADE status bar, and its Settings switch.

const HOUR = 3_600_000;

function snapshot(five: number | null, seven: number | null, extra: Record<string, unknown> = {}) {
  return {
    state: 'ok',
    source: 'session',
    fiveHour: five === null ? null : { usedPercent: five, resetsAt: FIXED_NOW + 2 * HOUR },
    sevenDay: seven === null ? null : { usedPercent: seven, resetsAt: FIXED_NOW + 50 * HOUR },
    updatedAt: FIXED_NOW - 5 * 60_000,
    detail: '',
    ...extra,
  };
}

interface UsageWindow {
  usedPercent: number;
  resetsAt: number;
}

// The backend snapshot (flows/usageflow, contract claude-usage); times are wall-clock there, so
// the spec dates them from FIXED_NOW.
function fromContract(key: string) {
  const snap = contract<{
    fiveHour: UsageWindow | null;
    sevenDay: UsageWindow | null;
    source: string;
    state: string;
  }>('claude-usage', key);
  return {
    ...snap,
    fiveHour: snap.fiveHour && { ...snap.fiveHour, resetsAt: FIXED_NOW + 2 * HOUR },
    sevenDay: snap.sevenDay && { ...snap.sevenDay, resetsAt: FIXED_NOW + 50 * HOUR },
    updatedAt: FIXED_NOW - 5 * 60_000,
  };
}

const pct = (w: UsageWindow | null) => Math.round(w?.usedPercent ?? 0);

const usageControl = (snap: unknown) => [{ channel: IPC.claudeUsageGet, response: snap }];
const item = (page: Page) => page.locator('[data-testid="claude-usage-status"]');
const text = (page: Page) => page.locator('[data-testid="claude-usage-text"]');

test('hidden outside the ADE module', async ({ relaunch }) => {
  const { window: page } = await relaunch({ control: usageControl(snapshot(23, 41)) });
  await expect(item(page)).toHaveCount(0);
});

test('shows both windows, and the tooltip lists the reset times and the source', async ({
  relaunch,
}) => {
  const { window: page } = await openPlan(relaunch, usageControl(snapshot(23.4, 41.2)));
  await expect(text(page)).toHaveText('5h 23% · wk 41%');
  await expect(item(page)).toHaveClass(/text-fg/);
  await item(page).hover();
  const tip = page.locator('[data-testid="claude-usage-tooltip"]');
  await expect(tip).toContainText('5-hour: 23% used');
  await expect(tip).toContainText('in 2h 0m');
  await expect(tip).toContainText('Weekly: 41% used');
  await expect(tip).toContainText('From a Claude Code session, 5m ago');
});

test('contract: a session snapshot shows both windows and its source', async ({ relaunch }) => {
  const snap = fromContract('ClaudeUsageService.Get#session');
  const { window: page } = await openPlan(relaunch, usageControl(snap));
  await expect(text(page)).toHaveText(`5h ${pct(snap.fiveHour)}% · wk ${pct(snap.sevenDay)}%`);
  await item(page).hover();
  await expect(page.locator('[data-testid="claude-usage-tooltip"]')).toContainText(
    'From a Claude Code session',
  );
});

test('contract: a run snapshot names the run source', async ({ relaunch }) => {
  const snap = fromContract('ClaudeUsageService.Get#run');
  const { window: page } = await openPlan(relaunch, usageControl(snap));
  await expect(text(page)).toHaveText(`5h ${pct(snap.fiveHour)}% · wk ${pct(snap.sevenDay)}%`);
  await item(page).hover();
  await expect(page.locator('[data-testid="claude-usage-tooltip"]')).toContainText(
    'From a background ADE run',
  );
});

test('contract: one window only shows only that window', async ({ relaunch }) => {
  const snap = fromContract('ClaudeUsageService.Get#expired');
  expect(snap.sevenDay).toBeNull();
  const { window: page } = await openPlan(relaunch, usageControl(snap));
  await expect(text(page)).toHaveText(`5h ${pct(snap.fiveHour)}%`);
});

test('the usage item sits in the left group with the dashboard icon', async ({ relaunch }) => {
  const { window: page } = await openPlan(relaunch, usageControl(snapshot(23, 41)));
  const usage = await item(page).boundingBox();
  const viewport = page.viewportSize();
  if (!(usage && viewport)) throw new Error('status bar item not laid out');
  expect(usage.x).toBeLessThan(24);
  expect(usage.x + usage.width).toBeLessThan(viewport.width / 2);
  await expect(item(page).locator('.codicon-dashboard')).toHaveCount(1);
});

test('warns at 80 percent and errors at 95 percent', async ({ relaunch }) => {
  const { window: page } = await openPlan(relaunch, usageControl(snapshot(85, 10)));
  await expect(item(page)).toHaveClass(/text-warn-text/);
  await emitWailsEvent(page, IPC.claudeUsage, snapshot(85, 97));
  await expect(text(page)).toHaveText('5h 85% · wk 97%');
  await expect(item(page)).toHaveClass(/text-error/);
});

test('shows a dash and the hint before any session reported', async ({ relaunch }) => {
  const { window: page } = await openPlan(
    relaunch,
    usageControl({
      state: 'waiting',
      source: '',
      fiveHour: null,
      sevenDay: null,
      updatedAt: 0,
      detail: 'Start a Claude Code session to see usage',
    }),
  );
  await expect(text(page)).toHaveText('Usage: –');
  await item(page).hover();
  await expect(page.locator('[data-testid="claude-usage-tooltip"]')).toContainText(
    'Start a Claude Code session to see usage',
  );
});

test('shows unavailable when the read fails', async ({ relaunch }) => {
  const { window: page } = await openPlan(relaunch, [
    { channel: IPC.claudeUsageGet, error: { code: 'internal', message: 'boom' } },
  ]);
  await expect(text(page)).toHaveText('Usage unavailable');
});

test('a pushed snapshot replaces the shown values', async ({ relaunch }) => {
  const { window: page } = await openPlan(relaunch, usageControl(snapshot(10, 20)));
  await expect(text(page)).toHaveText('5h 10% · wk 20%');
  await emitWailsEvent(page, IPC.claudeUsage, snapshot(30, 40));
  await expect(text(page)).toHaveText('5h 30% · wk 40%');
});

test('hidden while the setting is off', async ({ relaunch }) => {
  const { window: page } = await openPlan(relaunch, [
    ...usageControl(snapshot(23, 41)),
    {
      channel: IPC.settingsGetAll,
      response: {
        ...defaultSettings,
        claudeCode: { ...defaultSettings.claudeCode, usageEnabled: false },
      },
    },
  ]);
  await expect(page.locator('[data-testid="ade-plan"]')).toBeVisible();
  await expect(item(page)).toHaveCount(0);
});

test('the Settings switch saves claudeCode.usageEnabled', async ({ relaunch }) => {
  const { window: page, control } = await relaunch();
  await emitWailsEvent(page, IPC.openSettings, undefined);
  await page.locator('[data-testid="settings-section-Claude Code"]').click();
  const sw = page.locator('[data-testid="settings-claude-code-usage"]');
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  await sw.click();
  await page.locator('[data-testid="settings-save"]').click();
  await expect
    .poll(() => control.log().find((e) => e.channel === IPC.settingsSet)?.args)
    .toEqual({ patch: { claudeCode: { usageEnabled: false } } });
});
