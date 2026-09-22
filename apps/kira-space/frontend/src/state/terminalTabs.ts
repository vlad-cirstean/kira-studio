import { createOpenTerminalTab, type TerminalLaunch } from '@workbench/state/createTerminalTabs';
import { useTabsStore } from './tabs';
import type { WorkspaceKey } from './workspace';

export type { TerminalLaunch };

// Opens a terminal tab in `opts.workspaceId` — in practice always a repo id (state/repoTabs.ts's
// openRepoTerminalTab) or GENERAL_WORKSPACE (an unscoped terminal launch, if this app ever grows
// one outside a repo workspace).
export const openTerminalTab = createOpenTerminalTab<WorkspaceKey>(useTabsStore);
