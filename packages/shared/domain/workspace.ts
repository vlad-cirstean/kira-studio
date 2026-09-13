import type { AppMode } from './mode';

// C5 D2/§4.1: tab isolation is a new orthogonal *workspace* dimension, not a new AppMode and not a
// per-kind mapping — TAB_KIND_MODE is `kind -> mode`, a total function, which structurally cannot
// express "this file tab belongs to repository X" (two repos share the same kinds). A WorkspaceKey
// is either one of the two shared modes, or one specific repository's own workspace.
export type WorkspaceKey = AppMode | `repo:${string}`;

const REPO_WORKSPACE_PREFIX = 'repo:';

export function repoWorkspaceKey(repoId: string): WorkspaceKey {
  return `${REPO_WORKSPACE_PREFIX}${repoId}`;
}

/** The repo id inside a `repo:<id>` workspace key, or null for 'studio'/'api'. */
export function repoIdOfWorkspace(key: WorkspaceKey): string | null {
  return key.startsWith(REPO_WORKSPACE_PREFIX) ? key.slice(REPO_WORKSPACE_PREFIX.length) : null;
}

export function isRepoWorkspace(key: WorkspaceKey): boolean {
  return key.startsWith(REPO_WORKSPACE_PREFIX);
}
