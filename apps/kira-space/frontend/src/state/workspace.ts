import { defineStore } from 'pinia';
import { reactive, toRefs } from 'vue';
import { control } from '../bridge/control';
import { disposeGitTransport } from '../repo/git/transport';
import { useFileTreeStore } from '../repo/state/fileTree';
import { useRepoSearchStore } from '../repo/state/search';
import { ensureWorkspaceShell } from './repoTabs';
import { closeWorkspaceTabs } from './tabs';

// P100 Part 2: Kira Studio's own state/workspace.ts (Pinia store), adapted for an app with exactly
// one workspace kind — a repository — instead of layering a repo key inside one of several
// AppModes. packages/shared/domain/workspace.ts's WorkspaceKey (`AppMode | \`repo:${string}\``) had
// no equivalent to port: here a WorkspaceKey **is** a bare code_repos id, so the prefix/parse pair
// it defined (repoWorkspaceKey/repoIdOfWorkspace) collapses to identity — kept below only so the
// ported files that already call them (written against the old prefixed type) compile unchanged.
export type WorkspaceKey = string;

// The one non-repo slot: an unscoped terminal tab (state/terminalTabs.ts's own default, no repo in
// scope) and the moment before any repository has ever been opened. Never a real code_repos id
// (crypto.randomUUID() never produces this literal), so it can never collide with one.
export const GENERAL_WORKSPACE = '__general__';

/** Identity — every WorkspaceKey here already is a repo id (or GENERAL_WORKSPACE). Kept as a named
 *  function so call sites written against the old `repo:${id}`-prefixed type need no edit. */
export function repoWorkspaceKey(repoId: string): WorkspaceKey {
  return repoId;
}

/** Identity, GENERAL_WORKSPACE aside — mirrors the old parser's `null` for "not a repo workspace". */
export function repoIdOfWorkspace(key: WorkspaceKey): string | null {
  return key === GENERAL_WORKSPACE ? null : key;
}

/** `repoIdOfWorkspace` applied to a tab's own `workspaceId` — every repo view's own mount() rebuilt
 *  this exact `tab.workspaceId ? repoIdOfWorkspace(tab.workspaceId as WorkspaceKey) : null` ternary
 *  (P115 H9). `null` for a tab with no workspace at all, same as `repoIdOfWorkspace`. */
export function repoIdOfTab(tab: { workspaceId: string | null }): string | null {
  return tab.workspaceId ? repoIdOfWorkspace(tab.workspaceId as WorkspaceKey) : null;
}

/** The message every repo view's own "no repository" error/empty state showed, hand-copied ×4
 *  (P115 H9) — moved beside `repoIdOfTab` since it always accompanies a null result from it. */
export const NO_REPOSITORY_MESSAGE = 'This tab has no repository.';

// The active workspace, the Git panel's repo switcher (`openRepos`), and which repo was last
// active (`lastRepoKey`, session-only) — Kira Studio's own useWorkspaceStore (state/workspace.ts),
// minus the AppMode dimension (moduleOfWorkspace/useModeStore/setModule all had no work left to do
// once this app dropped every non-repo module).
export const useWorkspaceStore = defineStore('workspace', () => {
  const state = reactive({
    active: GENERAL_WORKSPACE as WorkspaceKey,
    openRepos: [] as string[], // code_repos.id, in switcher order
    lastRepoKey: null as WorkspaceKey | null,
  });

  function activateWorkspace(key: WorkspaceKey): void {
    state.active = key;
    if (key !== GENERAL_WORKSPACE) state.lastRepoKey = key;
  }

  // Opens repoId's own workspace — adds it to the switcher (a no-op if already open), ensures its
  // pinned graph tab exists, starts its index (fire-and-forget: a failed index start must never
  // block opening a workspace whose tree and viewer work regardless), then activates it.
  function openRepoWorkspace(repoId: string): void {
    if (!state.openRepos.includes(repoId)) {
      state.openRepos = [...state.openRepos, repoId];
    }
    ensureWorkspaceShell(repoId);
    void control.codeWorkspaceOpenWorkspace(repoId).catch(() => {});
    activateWorkspace(repoId);
  }

  // Closes every one of repoId's own tabs (its pinned graph tab included — closeWorkspaceTabs is
  // the one path that bypasses the pin guard, tearing down the whole workspace being a different
  // act from closing one of its tabs), drops it from the switcher, stops its index/watcher, and
  // drops its file-tree/search caches (previously wired only to removeCodeRepo's own explicit
  // calls, state/coderepos.ts — closing a workspace without deleting the repo never freed either
  // otherwise). dropQuickOpen is NOT called directly here — repo/state/quickOpen.ts imports this
  // module and watches `openRepos` itself, evicting on the same transition, to keep the import
  // direction one-way.
  function closeRepoWorkspace(repoId: string): void {
    closeWorkspaceTabs(repoId);
    state.openRepos = state.openRepos.filter((id) => id !== repoId);
    void control.codeWorkspaceCloseWorkspace(repoId).catch(() => {});
    // The pinned graph tab's own transport is cached per repo workspace, independent of the tab's
    // own mount/unmount (a tab switch alone must not tear it down) — closing the workspace itself
    // is the one event that actually ends it. A no-op when the graph tab was never mounted.
    disposeGitTransport(repoId);
    useFileTreeStore().dropRepoTree(repoId);
    useRepoSearchStore().dropRepoSearch(repoId);
    if (state.lastRepoKey === repoId) state.lastRepoKey = null;
    if (state.active === repoId) activateWorkspace(GENERAL_WORKSPACE);
  }

  return { ...toRefs(state), activateWorkspace, openRepoWorkspace, closeRepoWorkspace };
});
