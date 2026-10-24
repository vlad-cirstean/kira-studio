import { logError } from '@workbench/bridge/log';
import { control } from '../bridge/control';
import { useModeStore } from './mode';
import { openLocalFileTab, openRepoFileTab } from './repoTabs';
import { GENERAL_WORKSPACE, useWorkspaceStore } from './workspace';

// Boot-time drain of the files Finder handed this window. Last target ends up active. A failure
// is logged; boot continues.
export async function openPendingFiles(): Promise<void> {
  try {
    const targets = await control.openedFilesPending();
    const workspace = useWorkspaceStore();
    for (const target of targets) {
      if (target.repoId) {
        workspace.openRepoWorkspace(target.repoId);
        openRepoFileTab(target.repoId, target.relPath, { preview: false });
      } else {
        openLocalFileTab(target.path);
        workspace.activateWorkspace(GENERAL_WORKSPACE);
        useModeStore().setMode('git');
      }
    }
  } catch (err) {
    logError('bootstrap', 'opening pending files failed', err);
  }
}
