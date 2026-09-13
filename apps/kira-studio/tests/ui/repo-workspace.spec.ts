import type { ControlSnapshot } from '../ipc/support/types';
import { expect, test } from './fixtures';
import { IPC } from './support/ipcChannels';

// C5 §15: the cheapest proof of this phase's one real claim a unit test can't reach — a repo
// workspace's own isolated, pinned-plus-preview tab strip, and that studio's own strip never shows
// a repo tab. "Import a fixture repository" here means seeding codeWorkspaceListRepos with one
// already-imported repo (the same shortcut mode-switch.spec.ts's own createAndConnect takes for a
// connection) — the import dialog itself is a thin pass-through CLAUDE.md's own bar gives nothing.

const REPO = {
  id: 'repo-1',
  name: 'demo-repo',
  root: '/tmp/demo-repo',
  repoId: '/tmp/demo-repo',
  sortOrder: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const FILE_LISTING = { paths: ['a.ts', 'b.ts'], status: {}, truncated: false };

function readFileSnap(path: string, text: string): ControlSnapshot {
  return {
    channel: IPC.codeWorkspaceReadFile,
    args: { id: REPO.id, path },
    response: {
      kind: 'found',
      text,
      bytes: text.length,
      limitBytes: 8 * 1024 * 1024,
      language: 'typescript',
    },
  };
}

const CONTROL: ControlSnapshot[] = [
  { channel: IPC.codeWorkspaceListRepos, response: [REPO] },
  { channel: IPC.codeWorkspaceListFiles, args: { id: REPO.id }, response: FILE_LISTING },
  readFileSnap('a.ts', 'export const a = 1;\n'),
  readFileSnap('b.ts', 'export const b = 2;\n'),
];

function repoRow(page: import('@playwright/test').Page) {
  return page.locator(`[data-testid="repo-row"][data-repo-id="${REPO.id}"]`);
}

function treeRow(page: import('@playwright/test').Page, path: string) {
  return page.locator(`[data-testid="repo-tree-row"][data-path="${path}"]`);
}

function tab(page: import('@playwright/test').Page, kind?: string) {
  return kind
    ? page.locator(`[data-testid="tab-strip-row"] [data-testid="tab"][data-tab-kind="${kind}"]`)
    : page.locator('[data-testid="tab-strip-row"] [data-testid="tab"]');
}

test('a repo workspace: pinned graph tab, preview-slot reuse, promotion, and studio isolation', async ({
  relaunch,
}) => {
  const { window: page } = await relaunch({ control: CONTROL });

  // Import a fixture repository (seeded above) — visible in the panel's Repositories section.
  await expect(repoRow(page)).toBeVisible();

  // Opening it (double-click, the tree's own select/open split) switches to its own workspace.
  await repoRow(page).dblclick();
  await expect(
    page.locator('[data-testid="workspace-repo-tab"][data-repo-id="repo-1"]'),
  ).toHaveClass(/is-active/);

  // The pinned graph tab exists, alone, and has no close button.
  await expect(tab(page)).toHaveCount(1);
  const graphTab = tab(page, 'repo-graph');
  await expect(graphTab).toHaveCount(1);
  await expect(graphTab.locator('[data-testid="tab-close"]')).toHaveCount(0);

  // Single click opens a preview tab (§5.2 rule 1/4) — the strip now shows two tabs: pinned +
  // one preview, italic.
  await expect(treeRow(page, 'a.ts')).toBeVisible();
  await treeRow(page, 'a.ts').click();
  await expect(tab(page)).toHaveCount(2);
  const previewTab = tab(page, 'repo-file');
  await expect(previewTab).toHaveCount(1);
  await expect(previewTab).toHaveAttribute('data-preview', 'true');

  // A second single click on a *different* file replaces the preview slot's own tab — still two
  // tabs, never three (§5.2 rule 3).
  await treeRow(page, 'b.ts').click();
  await expect(tab(page)).toHaveCount(2);
  await expect(tab(page, 'repo-file')).toHaveCount(1);
  await expect(tab(page, 'repo-file')).toHaveAttribute('data-preview', 'true');
  await expect(tab(page, 'repo-file')).toContainText('b.ts');

  // Double-click promotes the current preview tab to permanent (§5.2's own promotion trigger).
  await treeRow(page, 'b.ts').dblclick();
  await expect(tab(page, 'repo-file')).toHaveAttribute('data-preview', 'false');
  await expect(tab(page)).toHaveCount(2); // still pinned + the one (now permanent) file tab.

  // The Studio strip never shows a repo tab — switching back shows Studio's own (empty) strip.
  await page.locator('[data-testid="mode-tab"][data-mode="studio"]').click();
  await expect(page.locator('[data-testid="tab-strip-empty"]')).toBeVisible();
  await expect(page.locator('[data-testid="tab-strip-row"] [data-testid="tab"]')).toHaveCount(0);
});
