import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { IPC } from './support/ipcChannels';
import type { ControlSnapshot } from './support/types';

// Relaunch activates the repo that was active last, not the first restored one.

const repo = (n: number) => ({
  id: `repo-last-${n}`,
  name: `last-${n}`,
  root: `/tmp/last-${n}`,
  repoId: `/tmp/last-${n}`,
  sortOrder: n,
  color: 'none',
  createdAt: '2026-01-01T00:00:00.000Z',
});
const X = repo(1);
const Y = repo(2);

const graphTab = (r: { id: string }, order: number) => ({
  id: `restored-${r.id}`,
  kind: 'repo-graph',
  connectionId: null,
  path: '',
  order,
  active: true,
  workspaceId: r.id,
  state: { viewState: null, reviewSession: null },
});

const CONTROL: ControlSnapshot[] = [
  { channel: IPC.codeWorkspaceListRepos, response: [X, Y] },
  { channel: IPC.tabsList, response: [graphTab(X, 0), graphTab(Y, 1)] },
];

const row = (page: Page, r: { id: string }) =>
  page.locator(`[data-testid="repo-row"][data-repo-id="${r.id}"]`);

test('reload reopens on the last active repo', async ({ relaunch }) => {
  const { window: page } = await relaunch({ control: CONTROL });
  await page.locator('[data-testid="git-panel-tab-repos"]').click();
  await expect(row(page, X)).toHaveClass(/active/);

  await row(page, Y).click();
  await page.locator('[data-testid="git-panel-tab-repos"]').click();
  await expect(row(page, Y)).toHaveClass(/active/);

  await page.reload();
  await page.locator('[data-testid="git-panel-tab-repos"]').click();
  await expect(row(page, Y)).toHaveClass(/active/);
  await expect(row(page, X)).not.toHaveClass(/active/);
});
