import { expect, test } from './fixtures';
import { contract } from './support/contract';
import { IPC } from './support/ipcChannels';

// Same scenario as flows/windowflow TestOpenedFilesNewWindow: a window opened for Finder files
// drains them at boot; a file outside every repository opens as a read-only local-file tab.

const pending = contract('opened-files', 'OpenedFilesService.Pending') as Array<{
  path: string;
  repoId: string;
}>;
const outside = pending.find((t) => t.repoId === '');
const read = contract('opened-files', 'OpenedFilesService.Read');

test('contract: pending files open as tabs', async ({ relaunch }) => {
  if (!outside) throw new Error('contract has no outside-repo target');
  const { window: page } = await relaunch({
    control: [
      { channel: IPC.openedFilesPending, response: [outside] },
      { channel: IPC.openedFilesRead, args: { path: outside.path }, response: read },
    ],
  });
  const tab = page.locator('[data-testid="tab"][data-tab-kind="local-file"]');
  await expect(tab).toHaveCount(1);
  await expect(tab).toHaveAttribute('data-active', 'true');
  await expect(tab).toContainText('b.json');
  await expect(page.locator('[data-testid="local-file-editor"]')).toBeVisible();
});
