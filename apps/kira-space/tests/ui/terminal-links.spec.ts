import { registerTerminalLinkScenarios } from '@workbench/testing/ui/scenarios/terminalLinks';
import { test } from './fixtures';
import { contract } from './support/contract';
import { IPC } from './support/ipcChannels';
import { repoRowById } from './support/repoRows';

// Cmd/Ctrl-click opens a terminal link. Backend half: appflow TestTerminalLinkOpen.

const REPO = {
  id: 'repo-1',
  name: 'demo-repo',
  root: '/tmp/demo-repo',
  repoId: '/tmp/demo-repo',
  sortOrder: 1,
  color: 'none',
  createdAt: '2026-01-01T00:00:00.000Z',
};

registerTerminalLinkScenarios(
  { test, contract, ipc: IPC },
  {
    extraBase: [
      { channel: IPC.codeWorkspaceListRepos, response: [REPO] },
      { channel: IPC.codeWorkspaceListFiles, args: { id: REPO.id }, response: [] },
    ],
    openTerminal: async (page) => {
      await repoRowById(page, REPO.id).click();
      await page.locator('[data-testid="tab-strip-new"]').click();
    },
  },
);
