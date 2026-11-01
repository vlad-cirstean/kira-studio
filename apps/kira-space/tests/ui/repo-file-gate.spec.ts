// P433 F6/F7: a repo file or diff tab remounts without re-sending content. The backend half is
// repoflow's "ifStat and ifHeadOid skip unchanged sides"; the mock stands in for it here.
import { expect, test } from './fixtures';
import { calls } from './support/ipcCalls';
import { IPC } from './support/ipcChannels';
import { repoRowById, repoTab, treeRow } from './support/repoRows';
import type { ControlSnapshot } from './support/types';

const REPO = {
  id: 'repo-1',
  name: 'demo-repo',
  root: '/tmp/demo-repo',
  repoId: '/tmp/demo-repo',
  sortOrder: 1,
  color: 'none',
  createdAt: '2026-01-01T00:00:00.000Z',
};
const LIMIT = 8 * 1024 * 1024;
const A_STAT = { size: 22, mtimeNs: 111 };
const C_STAT = { size: 20, mtimeNs: 222 };

const CONTROL: ControlSnapshot[] = [
  { channel: IPC.codeWorkspaceListRepos, response: [REPO] },
  {
    channel: IPC.codeWorkspaceListFiles,
    args: { id: REPO.id },
    response: { paths: ['a.ts', 'b.ts', 'c.ts'], status: { 'c.ts': 'M' }, truncated: false },
  },
  {
    channel: IPC.codeWorkspaceReadFile,
    args: { id: REPO.id, path: 'a.ts' },
    response: {
      kind: 'found',
      text: 'export const a = 1;\n',
      bytes: 20,
      limitBytes: LIMIT,
      language: 'typescript',
      stat: A_STAT,
    },
  },
  {
    channel: IPC.codeWorkspaceReadFile,
    args: { id: REPO.id, path: 'a.ts', ifStat: A_STAT },
    response: { kind: 'unchanged', stat: A_STAT, text: '', bytes: 0, limitBytes: LIMIT },
  },
  {
    channel: IPC.codeWorkspaceReadFile,
    args: { id: REPO.id, path: 'b.ts' },
    response: {
      kind: 'found',
      text: 'export const b = 2;\n',
      bytes: 20,
      limitBytes: LIMIT,
      language: 'typescript',
    },
  },
  {
    channel: IPC.codeWorkspaceReadDiff,
    args: { id: REPO.id, path: 'c.ts' },
    response: {
      path: 'c.ts',
      language: 'typescript',
      head: {
        kind: 'found',
        text: 'export const c = 1;\n',
        bytes: 20,
        limitBytes: LIMIT,
        oid: 'h1',
      },
      worktree: {
        kind: 'found',
        text: 'export const c = 2;\n',
        bytes: 20,
        limitBytes: LIMIT,
        stat: C_STAT,
      },
    },
  },
  {
    channel: IPC.codeWorkspaceReadDiff,
    args: { id: REPO.id, path: 'c.ts', ifStat: C_STAT, ifHeadOid: 'h1' },
    response: {
      path: 'c.ts',
      language: 'typescript',
      head: { kind: 'unchanged', text: '', bytes: 0, limitBytes: LIMIT, oid: 'h1' },
      worktree: { kind: 'unchanged', text: '', bytes: 0, limitBytes: LIMIT, stat: C_STAT },
    },
  },
];

test('switching away from a file and a diff and back sends the previous stat and shows the same text', async ({
  relaunch,
}) => {
  const { window: page, control } = await relaunch({ control: CONTROL });
  await repoRowById(page, REPO.id).click();
  await page.locator('[data-testid="git-panel-tab-files"]').click();

  await treeRow(page, 'a.ts').dblclick();
  const editor = page.locator('[data-testid="repo-file-editor"] .view-lines');
  await expect(editor).toContainText('export const a = 1;');
  await treeRow(page, 'b.ts').dblclick();
  await expect(editor).toContainText('export const b = 2;');

  const readA = () =>
    calls(control, IPC.codeWorkspaceReadFile).filter(
      (c) => (c.args as { path: string }).path === 'a.ts',
    );
  expect(readA()).toHaveLength(1);

  // Back to a.ts: the second read carries the stat the first returned, and the text is unchanged.
  await repoTab(page, 'repo-file').first().click();
  await expect(editor).toContainText('export const a = 1;');
  await expect.poll(() => readA().length).toBe(2);
  expect((readA()[1].args as { ifStat?: unknown }).ifStat).toEqual(A_STAT);

  // The same for an uncommitted diff.
  await treeRow(page, 'c.ts').click({ button: 'right' });
  await page.click('[data-testid="menu-item-open-changes"]');
  const diff = page.locator('[data-testid="repo-diff-editor"]');
  await expect(diff).toContainText('export const c = 2;');
  const diffReads = () => calls(control, IPC.codeWorkspaceReadDiff);
  expect(diffReads()).toHaveLength(1);

  await repoTab(page, 'repo-file').first().click();
  await expect(editor).toContainText('export const a = 1;');
  await repoTab(page, 'repo-diff').click();
  await expect(diff).toContainText('export const c = 2;');
  await expect.poll(() => diffReads().length).toBe(2);
  expect(diffReads()[1].args).toMatchObject({ ifStat: C_STAT, ifHeadOid: 'h1' });
});
