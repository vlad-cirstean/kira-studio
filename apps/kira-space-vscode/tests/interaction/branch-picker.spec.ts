import { expect, test } from '@playwright/test';
import { buildFakeGraphHostInitScript } from './support/fakeGraphHost.ts';
import { type InteractionServer, startInteractionServer } from './support/server.ts';

/**
 * P77 §17.2: `BranchPicker.vue`'s five-tab fold, over `fakeGraphHost.ts`'s own `withPickerData`
 * seed (`main`/`feature-auth` branches, one `v1` tag, one stack-stash entry whose label is
 * `"auth work"`, one worktree, one stacked branch — `feature-auth`/`"auth work"` both matching a
 * `"auth"` query, for the cross-tab filter case below). There is no coverage of this component
 * anywhere today — confirmed by search, not assumed.
 */
test.describe('branch picker', () => {
  let server: InteractionServer;

  test.beforeAll(async () => {
    server = await startInteractionServer();
  });

  test.afterAll(async () => {
    await server.close();
  });

  async function openPicker(page: import('@playwright/test').Page): Promise<void> {
    await page.addInitScript(buildFakeGraphHostInitScript({ withPickerData: true }));
    await page.goto(`${server.url}/graph`);
    await expect(
      page.locator('[data-testid="commit-grid"] .slick-row[data-row="0"]'),
    ).toBeVisible();
    await page.locator('.kv-branch-trigger').click();
    await expect(page.getByRole('dialog')).toBeVisible();
  }

  test('renders five tabs whose badges match the seeded counts', async ({ page }) => {
    await openPicker(page);
    // branches: main + feature-auth; tags: v1; stashes: one stack entry; worktrees: one; stacks:
    // one stacked branch — in `tabOptions`' own order (Branches, Tags, Stashes, Worktrees, Stacks).
    await expect(page.locator('.kv-branch-tabs .kui-segmented-badge')).toHaveText([
      '2',
      '1',
      '1',
      '1',
      '1',
    ]);
  });

  test('clicking Stashes swaps the body and relabels the filter', async ({ page }) => {
    await openPicker(page);
    await page.getByRole('button', { name: /^Stashes/ }).click();
    await expect(page.locator('.kv-branch-section[aria-label="Stashes"]')).toBeVisible();
    await expect(page.locator('input[aria-label="Filter stashes"]')).toBeVisible();
  });

  test('a query typed on Branches puts a match badge on Stashes, and the switch keeps it', async ({
    page,
  }) => {
    await openPicker(page);
    await page.locator('input[aria-label="Filter branches"]').fill('auth');

    const stashesTab = page.getByRole('button', { name: /^Stashes/ });
    await expect(stashesTab).toHaveAttribute('aria-label', 'Stashes (1)');

    await stashesTab.click();
    await expect(page.locator('input[aria-label="Filter stashes"]')).toHaveValue('auth');
    await expect(
      page.locator('.kv-branch-section[aria-label="Stashes"] .kv-stash-message'),
    ).toHaveText('auth work');
  });

  // N6.
  test('opening the panel focuses the filter input', async ({ page }) => {
    await openPicker(page);
    await expect(page.locator('input[aria-label="Filter branches"]')).toBeFocused();
  });

  test('ArrowDown from the filter focuses the first row; ArrowUp returns to the filter', async ({
    page,
  }) => {
    await openPicker(page);
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('[data-row-id="branch:refs/heads/main"]')).toBeFocused();

    await page.keyboard.press('ArrowUp');
    await expect(page.locator('input[aria-label="Filter branches"]')).toBeFocused();
  });
});
