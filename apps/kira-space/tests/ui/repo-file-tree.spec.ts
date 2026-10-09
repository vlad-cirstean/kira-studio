import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { openCommitDetail } from './support/gitUiPortFixtures';

// Open gestures on the commit detail file tree: a click previews, a double click or Enter pins.
// Ported from the VS Code webview suite, where the host recorded each openDiff call; here the
// observable result is the diff tab Space opens.

const diffTabs = (p: Page) =>
  p.locator('[data-testid="tab-strip-wrapper"] [data-testid="tab"][data-tab-kind="repo-diff"]');

async function fileTreeRows(relaunch: Parameters<typeof openCommitDetail>[0]) {
  const page = await openCommitDetail(relaunch);
  const rows = page.locator('[data-testid="file-tree"] .kv-file-tree-row');
  const fileRow = rows.filter({ hasText: 'example.ts' });
  await expect(fileRow).toBeVisible();
  return { page, rows, fileRow };
}

test('a single click opens one preview diff tab', async ({ relaunch }) => {
  const { page, fileRow } = await fileTreeRows(relaunch);
  await expect(diffTabs(page)).toHaveCount(0);

  await fileRow.click();
  await expect(diffTabs(page)).toHaveCount(1);
  await expect(diffTabs(page)).toHaveAttribute('data-preview', 'true');
});

test('a double click event opens a pinned diff tab', async ({ relaunch }) => {
  const { page, fileRow } = await fileTreeRows(relaunch);

  // Space switches to the diff tab on the first open, so a real click-then-dblclick would hide the
  // tree before the second gesture lands; dispatch the dblclick alone.
  await fileRow.dispatchEvent('dblclick');
  await expect(diffTabs(page)).toHaveCount(1);
  await expect(diffTabs(page)).toHaveAttribute('data-preview', 'false');
});

test('the status letter is smaller than its row', async ({ relaunch }) => {
  const { fileRow } = await fileTreeRows(relaunch);

  const { status, row } = await fileRow.evaluate((el) => {
    const letter = el.querySelector('.kv-file-tree-status');
    if (!letter) throw new Error('.kv-file-tree-status not found');
    return {
      status: Number.parseFloat(getComputedStyle(letter).fontSize),
      row: Number.parseFloat(getComputedStyle(el).fontSize),
    };
  });
  expect(status).toBeLessThan(row);
});
