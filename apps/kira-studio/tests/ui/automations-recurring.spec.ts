import { registerRecurringScenarios } from '@workbench/testing/ui/scenarios/automationsRecurring';
import { test } from './fixtures';
import { contract } from './support/contract';
import { IPC } from './support/ipcChannels';

// P242 Part 4: recurring scripts on the mocked bridge: the editor's schedule, rows, the confirm popup.

registerRecurringScenarios(
  { test, contract, ipc: IPC },
  { product: 'Kira Studio', extraBase: [], scheduleWhere: false },
);
