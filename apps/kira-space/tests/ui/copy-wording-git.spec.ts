import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import {
  openPortGraph,
  openRefsPopover,
  PICKER_RESULTS,
  rootRow,
  SHA_A,
  singleRowChunks,
} from './support/gitUiPortFixtures';

// P265 Stream C: pins the unified wording of the git surfaces.

const tid = (page: Page, id: string) => page.locator(`[data-testid="${id}"]`);
const featureRow = (page: Page) => page.locator('[data-row-id="branch:refs/heads/feature-auth"]');

test('branch row menu labels', async ({ relaunch }) => {
  const page = await openRefsPopover(relaunch);

  await featureRow(page).getByRole('button', { name: 'More actions' }).click();
  await expect(tid(page, 'context-menu')).toBeVisible();
  await expect(tid(page, 'menu-item-checkoutRef')).toHaveText('Check out');
  // Deviation: the plan listed `Rename…`; the shared label is `Rename` and the field is inline.
  await expect(tid(page, 'menu-item-renameRef')).toHaveText('Rename');
  await expect(tid(page, 'menu-item-deleteRef')).toHaveText('Delete');
});

test('commit row menu offers New branch', async ({ relaunch }) => {
  const page = await openPortGraph(relaunch, {
    chunks: singleRowChunks([rootRow(SHA_A, 'A commit')]),
    results: PICKER_RESULTS,
  });
  const row = page.locator('[data-testid="commit-grid"] .slick-row[data-row="0"]');
  await expect(row).toBeVisible();

  await row.click({ button: 'right' });
  await expect(tid(page, 'menu-item-createBranchHere')).toHaveText('New branch…');
});

// The app has no delete branch dialog; an unmerged branch raises the force delete prompt.
test('deleting an unmerged branch asks to force delete', async ({ relaunch }) => {
  const page = await openPortGraph(relaunch, {
    chunks: singleRowChunks([rootRow(SHA_A, 'A commit')]),
    results: {
      ...PICKER_RESULTS,
      'op.run': {
        ok: false,
        error: { kind: 'NotFullyMerged', message: 'not fully merged' },
        undo: null,
        head: { kind: 'branch', name: 'main' },
        inProgress: null,
      },
    },
  });
  await expect(page.locator('[data-testid="commit-grid"] .slick-row[data-row="0"]')).toBeVisible();
  await tid(page, 'branch-trigger').click();
  await expect(page.getByRole('dialog')).toBeVisible();

  await featureRow(page).getByRole('button', { name: 'More actions' }).click();
  await tid(page, 'menu-item-deleteRef').click();

  await expect(page.getByText('“feature-auth” is not fully merged.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Force delete' })).toBeVisible();
});

test('empty stash list', async ({ relaunch }) => {
  const page = await openPortGraph(relaunch, {
    chunks: singleRowChunks([rootRow(SHA_A, 'A commit')]),
    results: { ...PICKER_RESULTS, 'stash.list': { entries: [] } },
  });
  await expect(page.locator('[data-testid="commit-grid"] .slick-row[data-row="0"]')).toBeVisible();
  await tid(page, 'branch-trigger').click();
  await page.getByRole('button', { name: /^Stashes/ }).click();

  await expect(page.locator('[data-testid="branch-section"][aria-label="Stashes"]')).toContainText(
    'No stashes yet',
  );
});

// `app.init` answering null makes the boot throw, which raises the load failure panel.
test('repository load failure names the error and offers Retry', async ({ relaunch }) => {
  const page = await openPortGraph(relaunch, {
    chunks: singleRowChunks([rootRow(SHA_A, 'A commit')]),
    results: { 'app.init': null },
  });

  await expect(tid(page, 'boot-error')).toContainText('Couldn’t load the repository: ');
  await expect(tid(page, 'boot-retry')).toHaveText('Retry');
});
