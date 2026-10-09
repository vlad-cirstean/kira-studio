import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, type KiraSpaceApp, test } from './fixtures';
import { createRepo, git } from './support/gitRepo';

// Review a real branch against main, add a comment on a changed line, reload the page: the
// comment is stored by the server and comes back.

/** Imports a repo with a `feature` branch, reviews it and comments on the added line. */
async function reviewWithComment(kira: KiraSpaceApp) {
  const repo = join(kira.work, 'review');
  await createRepo(repo, [
    { subject: 'base', files: { 'src/app.ts': 'export const a = 1;\nexport const b = 2;\n' } },
  ]);
  git(repo, 'checkout', '-q', '-b', 'feature');
  await writeFile(
    join(repo, 'src/app.ts'),
    'export const a = 1;\nexport const b = 2;\nexport const c = 3;\n',
  );
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'add c');

  const rec = await kira.call<{ id: string }>('CodeWorkspaceService', 'ImportRepo', { path: repo });
  await kira.reload();
  const page = kira.window;
  await page.locator(`[data-testid="repo-row"][data-repo-id="${rec.id}"]`).click();
  await expect(page.getByText('add c').first()).toBeVisible();

  await page.locator('[data-testid="git-panel-tab-review"]').click();
  const host = page.locator('[data-testid="repo-review-host"]');
  await host
    .locator('[data-testid="review-no-branch"]')
    .getByRole('button', { name: 'feature', exact: true })
    .click();
  await host.getByRole('button', { name: /^Files \(1\)/ }).click();
  await host.getByText('app.ts').first().click();
  const diff = page.locator('[data-testid="repo-diff-editor"]');
  await expect(diff).toBeVisible();
  const added = diff.locator('.modified .view-line', { hasText: 'const c' }).first();
  await expect(added).toBeVisible();

  // Monaco's context menu ignores a pointer click on its item here; keyboard activation works.
  await added.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Add Review Comment' }).hover();
  await page.keyboard.press('Enter');
  await page.locator('[data-testid="review-thread-input"]').fill('why not a const enum?');
  await page.locator('[data-testid="review-thread"] button', { hasText: 'Comment' }).click();
  await expect(host.getByRole('button', { name: 'Comments (1)' })).toBeVisible();
  return { page, host };
}

test('a review comment persists across a page reload', async ({ kira }) => {
  const { page } = await reviewWithComment(kira);
  await kira.reload();
  const host = page.locator('[data-testid="repo-review-host"]');
  await expect(host.getByRole('button', { name: 'Comments (1)' })).toBeVisible();
  await host.getByRole('button', { name: 'Comments (1)' }).click();
  await expect(host.getByText('why not a const enum?')).toBeVisible();
});

test('a reloaded Review pane compares without the graph tab being opened first', async ({
  kira,
}) => {
  const { page } = await reviewWithComment(kira);
  await kira.reload();
  const host = page.locator('[data-testid="repo-review-host"]');
  await expect(host.getByRole('button', { name: /^Comments/ })).toBeVisible();
  await expect(page.getByText('repository is not open on this connection')).toHaveCount(0);
});
