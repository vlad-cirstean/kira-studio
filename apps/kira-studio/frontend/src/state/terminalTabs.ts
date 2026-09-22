import type { AppMode } from '@shared/domain/mode';
import { createOpenTerminalTab } from '@workbench/state/createTerminalTabs';
import { useTabsStore } from './tabs';

// P91 §6: opens a terminal tab in `opts.workspaceId`, generic over any AppMode — in practice
// always 'terminal' (this app's own Terminal module, every caller). `codeRepoId` stays on the
// options shape (TerminalTabState's own field, @shared/domain/tabs) even though nothing in this
// app ever passes it any more — a plain string, not a live coderepos.ts reference, so it costs
// this app nothing to keep passing through unchanged.
export const openTerminalTab = createOpenTerminalTab<AppMode>(useTabsStore);
