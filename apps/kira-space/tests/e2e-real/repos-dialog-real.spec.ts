import { join } from 'node:path';
import { expect, type KiraSpaceApp, test } from './fixtures';
import { createRepo } from './support/gitRepo';

// Add a repo through the Repositories dialog (the native folder picker answered by a route),
// then rename and colour it from its row menu, browse its files, open one, and find a search hit.

interface Rec {
  id: string;
  name: string;
  color: string;
}

/** Creates a repo and imports it through the dialog's Import button. */
async function addViaDialog(kira: KiraSpaceApp) {
  const repo = join(kira.work, 'tools');
  await createRepo(repo, [
    {
      subject: 'init',
      files: {
        'README.md': '# tools\n',
        'src/util.ts': 'export const needleValue = 42;\n',
        'src/deep/other.ts': 'export const other = 1;\n',
      },
    },
  ]);
  const page = kira.window;

  // The server build has no native dialog; answer the picker with the repo path.
  await page.route('**/wails/runtime', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}') as {
      args?: { methodName?: string };
    };
    if ((body.args?.methodName ?? '').endsWith('FilesService.ChooseFolder')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ canceled: false, path: repo }),
      });
      return;
    }
    await route.fallback();
  });

  await page.locator('[data-testid="manage-repos"]').click();
  const dialog = page.locator('[data-testid="repos-dialog"]');
  await expect(dialog).toBeVisible();
  await dialog.locator('[data-testid="repos-dialog-import"]').click();
  await expect(dialog.locator('[data-testid="repos-dialog-repo"]')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  const list = () => kira.call<Rec[]>('CodeWorkspaceService', 'ListRepos');
  const [rec] = await list();
  expect(rec?.name).toBe('tools');
  const row = page.locator(`[data-testid="repo-row"][data-repo-id="${rec?.id}"]`);
  await expect(row).toBeVisible();
  return { page, row, list };
}

test('adds a repo through the dialog, renames and colours it, browses and opens a file', async ({
  kira,
}) => {
  const { page, row, list } = await addViaDialog(kira);

  await row.click({ button: 'right' });
  await page.locator('[data-testid="menu-item-rename"]').click();
  await page.locator('[data-testid="text-prompt-input"]').fill('toolbox');
  await page.locator('[data-testid="text-prompt-ok"]').click();
  await expect.poll(async () => (await list())[0]?.name).toBe('toolbox');
  await expect(row).toContainText('toolbox');

  await row.click({ button: 'right' });
  await page.locator('[data-testid="menu-item-color"]').hover();
  await page.locator('[data-testid="menu-item-color-red"]').click();
  await expect.poll(async () => (await list())[0]?.color).toBe('red');

  await row.click();
  await page.locator('[data-testid="git-panel-tab-files"]').click();
  const src = page.locator('[data-testid="repo-tree-row"][data-path="src"]');
  await expect(src).toBeVisible();
  if ((await src.getAttribute('aria-expanded')) !== 'true') await src.click();
  await expect(src).toHaveAttribute('aria-expanded', 'true');
  await page.locator('[data-testid="repo-tree-row"][data-path="src/util.ts"]').click();
  await expect(page.locator('[data-testid="repo-file-editor"] .view-lines')).toContainText(
    'needleValue',
  );
});

test.fixme('P231 finding A3: code search results never reach a server-build window', async ({
  kira,
}) => {
  const { page, row } = await addViaDialog(kira);
  await row.click();
  await page.locator('[data-testid="git-panel-tab-files"]').click();
  await page.locator('[data-testid="repo-view-search"]').click();
  const query = page.locator('[data-testid="repo-search-query"]');
  await query.fill('needleValue');
  await query.press('Enter');
  await expect(
    page.locator('[data-testid="repo-search-file-row"][data-path="src/util.ts"]'),
  ).toBeVisible();
  await expect(page.locator('[data-testid="repo-search-status"]')).toContainText('1 result');
});
