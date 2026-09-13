import { defaultRepoFileTabState } from '@shared/domain/tabs';
import { repoWorkspaceKey } from '@shared/domain/workspace';
import { tabsForWorkspace } from './mode';
import {
  activateTab,
  createPinnedRepoGraphTab,
  type OpenTabResult,
  openTab,
  patchRepoFileTabState,
} from './tabs';

export interface OpenRepoFileOpts {
  preview: boolean;
  reveal?: { line: number };
}

// C5 §5.2: the repo workspace's own file-open entry point — every tree row click and future
// search/quick-open match (§12) routes through this, never openTab directly, so the preview/pin
// rules stay in exactly one place (openTab itself, §15.1's own unit-tested mechanism).
export function openRepoFileTab(
  repoId: string,
  path: string,
  opts: OpenRepoFileOpts,
): OpenTabResult {
  const revealLine = opts.reveal?.line ?? null;
  const result = openTab('repo-file', null, path, () => defaultRepoFileTabState(revealLine), {
    reuse: true,
    workspaceId: repoWorkspaceKey(repoId),
    preview: opts.preview,
  });
  // §5.2 rule 1: "Apply reveal either way" — a fresh tab's makeState() already carries it, so this
  // only does real work for a reused tab (and is a same-value no-op, via skipUnchanged, otherwise).
  if (revealLine !== null) patchRepoFileTabState(result.id, { revealLine });
  return result;
}

// C5 §6.1: creates repoId's own pinned graph tab if it has none, and activates it only when the
// workspace currently has no active tab at all — called by openRepoWorkspace (state/workspace.ts)
// and once per restored repo after hydrateTabs (main.ts's own bootstrap), never from inside
// hydrateTabs itself (state/tabs.ts already depends on this module for closeWorkspaceTabs's own
// call graph; hydrateTabs calling back in here would add a third link to that cycle for no need).
export function ensureWorkspaceShell(repoId: string): void {
  const key = repoWorkspaceKey(repoId);
  const tabs = tabsForWorkspace(key);
  if (!tabs.some((t) => t.kind === 'repo-graph')) {
    createPinnedRepoGraphTab(key);
  }
  if (!tabs.some((t) => t.active)) {
    const graph = tabsForWorkspace(key).find((t) => t.kind === 'repo-graph');
    if (graph) activateTab(graph.id);
  }
}
