import {
  isRepoWorkspace,
  moduleOfWorkspace,
  repoWorkspaceKey,
  type WorkspaceKey,
} from '@shared/domain/workspace';
import { reactive } from 'vue';
import { control } from '../bridge/control';
import { disposeGitTransport } from '../repo/git/transport';
import { dropRepoTree } from '../repo/state/fileTree';
import { dropRepoSearch } from '../repo/state/search';
import { useModeStore } from './mode';
import { ensureWorkspaceShell } from './repoTabs';
import { closeWorkspaceTabs } from './tabs';

// P67b §4.2: the active workspace, the Git panel's repo switcher (`openRepos`), and which repo
// workspace was last active inside Git (`lastRepoKey`, session-only — see activateWorkspace).
// Nothing here is persisted beyond what already is (tabs.workspace_id, via tabsState.tabs):
// hydrateTabs derives openRepos from the distinct workspace ids among restored tabs, and `active`
// starts at the window's own persisted module (hydrateMode) — a repo workspace is never the thing
// a window reopens into on its own (§13: only `windows.mode`'s third value, 'git', is persisted).
export const workspaceState = reactive({
  active: 'studio' as WorkspaceKey,
  openRepos: [] as string[], // code_repos.id, in switcher order
  lastRepoKey: null as WorkspaceKey | null,
});

// P67b §4.2: workspaceState.active is the single source of truth; modeState.active is its
// persisted mirror (setModule, persistence only — never a second write path). Activating a repo
// workspace now also brings the Git module forward (setModule('git')), which is what makes
// clicking a repo file tab from Quick Open while in Studio bring Git's tab active, and what makes
// `lastRepoKey` track "which repository was I last in" so returning to Git lands back on it.
export function activateWorkspace(key: WorkspaceKey): void {
  const mode = moduleOfWorkspace(key);
  useModeStore().setModule(mode);
  workspaceState.active = key;
  if (mode === 'git' && isRepoWorkspace(key)) workspaceState.lastRepoKey = key;
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
// same act as closing one of its tabs) and drops it from the switcher. Falls back to the Git
// module's own empty state when the closed workspace was the active one (P67b §4.2). C6 §8.5: also
// stops repoId's own index/watcher.
//
// C13-3: also drops repoId's own file-tree/search caches (previously wired only to
// removeCodeRepo's own explicit calls, state/coderepos.ts) — measured ~55 MB per 50k-file repo
// retained forever otherwise, since closing a workspace without deleting the repo never freed
// either cache. dropQuickOpen is NOT called directly here — repo/state/quickOpen.ts imports this
// module (workspaceState) and its own doc comment already establishes that import direction as
// one-way; it instead watches `openRepos` itself and evicts on the same transition.
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
  dropRepoTree(repoId);
  dropRepoSearch(repoId);
  if (workspaceState.lastRepoKey === key) workspaceState.lastRepoKey = null;
  // P67b §4.2: falls back to the Git module's own empty state (GitStart.vue), not to Studio — a
  // repo workspace closing is a Git-module event, and Studio has no reason to steal focus for it.
  if (workspaceState.active === key) activateWorkspace('git');
}
