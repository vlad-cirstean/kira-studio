import type { AppMode } from '@shared/domain/mode';
import { repoWorkspaceKey, type WorkspaceKey } from '@shared/domain/workspace';
import { reactive } from 'vue';
import { control } from '../bridge/control';
import { disposeGitTransport } from '../repo/git/transport';
import { setMode } from './mode';
import { ensureWorkspaceShell } from './repoTabs';
import { closeWorkspaceTabs } from './tabs';

// C5 §4.2: the active workspace and the switcher's own repo list — TitleBar.vue renders Studio,
// Api, then one entry per `openRepos` member. Nothing here is persisted beyond what already is
// (tabs.workspace_id, via tabsState.tabs): hydrateTabs derives openRepos from the distinct
// workspace ids among restored tabs, and `active` starts at the window's own persisted mode
// (hydrateMode) — a repo workspace is never the thing a window reopens into.
export const workspaceState = reactive({
  active: 'studio' as WorkspaceKey,
  openRepos: [] as string[], // code_repos.id, in switcher order
});

// C5 §4.2: switching to a repo workspace leaves modeState.active untouched (setMode is only ever
// called for the two AppMode members) — leaving the repo later returns to whichever module you
// were in, and the two-value `windows.mode` column needs no new member and no migration.
export function activateWorkspace(key: WorkspaceKey): void {
  if (key === 'studio' || key === 'api') {
    setMode(key as AppMode);
    return;
  }
  workspaceState.active = key;
}

// C5 §4.2/C6 §8.5: opens repoId's own workspace — adds it to the switcher (a no-op if already
// open), ensures its pinned graph tab exists (§6.1), starts its index (fire-and-forget: a failed
// index start must never block opening a workspace whose tree and viewer work regardless), then
// activates it.
export function openRepoWorkspace(repoId: string): void {
  if (!workspaceState.openRepos.includes(repoId)) {
    workspaceState.openRepos = [...workspaceState.openRepos, repoId];
  }
  ensureWorkspaceShell(repoId);
  void control.codeWorkspaceOpenWorkspace(repoId).catch(() => {});
  activateWorkspace(repoWorkspaceKey(repoId));
}

// C5 §4.2: closes every one of repoId's own tabs (its pinned graph tab included — closeWorkspaceTabs
// is the one path that bypasses the pin guard, since tearing down the whole workspace is not the
// same act as closing one of its tabs) and drops it from the switcher. Falls back to Studio when
// the closed workspace was the active one. C6 §8.5: also stops repoId's own index/watcher.
export function closeRepoWorkspace(repoId: string): void {
  const key = repoWorkspaceKey(repoId);
  closeWorkspaceTabs(key);
  workspaceState.openRepos = workspaceState.openRepos.filter((id) => id !== repoId);
  void control.codeWorkspaceCloseWorkspace(repoId).catch(() => {});
  // C10 §8/S17: the pinned graph tab's own transport is cached per repo workspace, independent of
  // the tab's own mount/unmount (a tab switch alone must not tear it down — RepoGraphView.vue's
  // own doc comment) — closing the workspace itself is the one event that actually ends it. A
  // no-op when the graph tab was never mounted (no transport was ever created).
  disposeGitTransport(repoId);
  if (workspaceState.active === key) activateWorkspace('studio');
}
