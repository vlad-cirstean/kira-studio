import { registerRestoreScenarios } from '@workbench/testing/ui/scenarios/automationsRestore';
import { test } from './fixtures';
import { contract } from './support/contract';
import { IPC } from './support/ipcChannels';

// P441: the Runs restore banner and the shared restore dialog, on the mocked bridge.

registerRestoreScenarios(
  { test, contract, ipc: IPC },
  {
    extraBase: [{ channel: IPC.windowsEnsure, response: { mode: 'git' } }],
    modeTab: (page) => page.locator('[data-testid="mode-tab"][data-mode="automations"]'),
  },
);
