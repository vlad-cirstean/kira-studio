import { registerOpsScenarios } from '@workbench/testing/ui/scenarios/automationsOps';
import { test } from './fixtures';
import { contract } from './support/contract';
import { IPC } from './support/ipcChannels';

// Automation runs in the Operations panel. Backend half: termflow TestScriptRunNonZeroExit.

registerOpsScenarios(
  { test, contract, ipc: IPC },
  {
    extraBase: [{ channel: IPC.windowsEnsure, response: { mode: 'git' } }],
    modeTab: (page) => page.locator('[data-testid="mode-tab"][data-mode="automations"]'),
  },
);
