import type { Page } from '@playwright/test';
import { defaultSettings } from '@shared/domain/settings';
import { expect, test } from './fixtures';
import { IPC } from './support/ipcChannels';

// P17: the settings dialog stages every control into a local draft and only reaches
// SettingsService.Set on Save — see docs/v1.1/plans/P17-settings-apply-on-save.md §6.1 for the
// five scenarios below. A settings change is observable without opening a grid via the CSS
// custom property applyAppearance() writes (state/settings.ts): --kira-row-height reads 28px at
// the comfortable default and 22px for compact.

async function openSettings(page: Page): Promise<void> {
  await page.click('[data-testid="open-settings"]');
  await expect(page.locator('[data-testid="settings-dialog"]')).toBeVisible();
}

function dialog(page: Page) {
  return page.locator('[data-testid="settings-dialog"]');
}

// The row-density segmented control has no data-testid of its own (a design-system button pair,
// not a form control tests elsewhere key off) — first is Compact, second Comfortable.
function densityButton(page: Page, density: 'compact' | 'comfortable') {
  return dialog(page)
    .locator('.segmented button')
    .nth(density === 'compact' ? 0 : 1);
}

function rowHeightVar(page: Page): Promise<string> {
  return page.evaluate(() => document.documentElement.style.getPropertyValue('--kira-row-height'));
}

function settingsSetCalls(control: { log(): { channel: string; args: unknown }[] }) {
  return control.log().filter((e) => e.channel === IPC.settingsSet);
}

test('staged changes reach nothing until Save', async ({ relaunch }) => {
  const { window: page, control } = await relaunch();
  await openSettings(page);

  await densityButton(page, 'compact').click();
  await page.click('[data-testid="settings-word-wrap"]');
  await page.click('[data-testid="settings-row-coloring"]');

  expect(settingsSetCalls(control)).toHaveLength(0);
  expect(await rowHeightVar(page)).toBe('28px');
});

test('Save commits once, carrying only the leaves that changed', async ({ relaunch }) => {
  const flipped = {
    ...defaultSettings,
    appearance: { ...defaultSettings.appearance, rowDensity: 'compact' as const, wordWrap: false },
  };
  const { window: page, control } = await relaunch({
    control: [{ channel: IPC.settingsSet, response: flipped }],
  });
  await openSettings(page);

  await densityButton(page, 'compact').click();
  await page.click('[data-testid="settings-word-wrap"]');
  await page.click('[data-testid="settings-save"]');

  await expect(dialog(page)).toHaveCount(0);
  const calls = settingsSetCalls(control);
  expect(calls).toHaveLength(1);
  expect(calls[0].args).toEqual({
    patch: { appearance: { rowDensity: 'compact', wordWrap: false } },
  });
  expect(await rowHeightVar(page)).toBe('22px');
});

test('Cancel and Escape both discard the draft', async ({ relaunch }) => {
  const { window: page, control } = await relaunch();

  await openSettings(page);
  await densityButton(page, 'compact').click();
  await page.click('[data-testid="settings-cancel"]');
  await expect(dialog(page)).toHaveCount(0);
  expect(settingsSetCalls(control)).toHaveLength(0);
  expect(await rowHeightVar(page)).toBe('28px');

  await openSettings(page);
  await densityButton(page, 'compact').click();
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);
  expect(settingsSetCalls(control)).toHaveLength(0);
  expect(await rowHeightVar(page)).toBe('28px');

  // The draft did not survive either close — reopening shows the stored (default) value again.
  await openSettings(page);
  await expect(densityButton(page, 'comfortable')).toHaveClass(/active/);
  await densityButton(page, 'compact').click();
  await page.click('[data-testid="settings-cancel"]');
});

test('Revert to Defaults stages every section; Save is what commits it', async ({ relaunch }) => {
  const nonDefault = {
    ...defaultSettings,
    appearance: { ...defaultSettings.appearance, rowDensity: 'compact' as const, wordWrap: false },
    cache: { l2BudgetMb: 512 },
    advanced: { opLogRetentionDays: 7 },
  };
  const { window: page, control } = await relaunch({
    control: [{ channel: IPC.settingsGetAll, response: nonDefault }],
  });

  await openSettings(page);
  await page.click('[data-testid="settings-revert-defaults"]');

  await expect(densityButton(page, 'comfortable')).toHaveClass(/active/);
  await expect(page.locator('[data-testid="settings-word-wrap"]')).toBeChecked();
  await page.click('[data-testid="settings-section-Cache"]');
  await expect(page.locator('[data-testid="settings-cache-budget"]')).toHaveValue('64');
  expect(settingsSetCalls(control)).toHaveLength(0);

  await page.click('[data-testid="settings-save"]');
  await expect(dialog(page)).toHaveCount(0);
  const calls = settingsSetCalls(control);
  expect(calls).toHaveLength(1);
  expect(calls[0].args).toEqual({
    patch: {
      appearance: { rowDensity: 'comfortable', wordWrap: true },
      cache: { l2BudgetMb: 64 },
      advanced: { opLogRetentionDays: 30 },
    },
  });
});

// P12 round 1 finding #9: patchSettings used to apply the patch to settingsState (and re-render
// --kira-row-height) *before* awaiting control.settingsSet — a rejected Save left the change live
// in this window with no broadcast to any other window or the database, correctly showing an
// error and staying open, but silently divergent from the truth until relaunch.
test('a rejected Save leaves the live value alone and shows the error', async ({ relaunch }) => {
  const { window: page, control } = await relaunch({
    control: [
      {
        channel: IPC.settingsSet,
        error: { code: 'E_QUERY', message: 'settings write failed' },
      },
    ],
  });
  await openSettings(page);

  await densityButton(page, 'compact').click();
  await page.click('[data-testid="settings-save"]');

  await expect(dialog(page).locator('[data-testid="settings-save-error"]')).toContainText(
    'settings write failed',
  );
  await expect(dialog(page)).toBeVisible(); // stays open on a rejection (P17 D7)
  expect(settingsSetCalls(control)).toHaveLength(1);
  // The whole point: no live change from an unconfirmed patch, in this window or any other.
  expect(await rowHeightVar(page)).toBe('28px');
});

test('an out-of-range value blocks Save until corrected', async ({ relaunch }) => {
  const { window: page, control } = await relaunch();
  await openSettings(page);
  await page.click('[data-testid="settings-section-Cache"]');

  await page.fill('[data-testid="settings-cache-budget"]', '5000');
  await expect(page.locator('[data-testid="settings-save"]')).toBeDisabled();
  await expect(page.locator('[data-testid="settings-cache-budget-error"]')).toBeVisible();
  expect(settingsSetCalls(control)).toHaveLength(0);

  await page.fill('[data-testid="settings-cache-budget"]', '128');
  await expect(page.locator('[data-testid="settings-save"]')).toBeEnabled();
  await expect(page.locator('[data-testid="settings-cache-budget-error"]')).toHaveCount(0);
});
