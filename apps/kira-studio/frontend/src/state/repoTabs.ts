import { defaultRepoDiffTabState, defaultRepoFileTabState } from '@shared/domain/tabs';
import { repoWorkspaceKey } from '@shared/domain/workspace';
import { requestReveal } from '../views/repo/reveal';
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
  // C7 D12/§7.4: column/endColumn widen the reveal beyond repoFileTabStateSchema's own persisted
  // `revealLine` — a search result (or a go-to-definition match) carries a column worth restoring
  // a cursor to within this session, not across a restart.
  reveal?: { line: number; column?: number; endColumn?: number };
}

// C5 §5.2: the repo workspace's own file-open entry point — every tree row click and every
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
  // D12: requestReveal is what actually moves the cursor when the tab's editor is already mounted
  // and active (a reused tab this call didn't just create) — patchRepoFileTabState above only ever
  // updates persisted state, which RepoFileView.vue reads on mount, not on an existing mount.
  if (opts.reveal) requestReveal(result.id, opts.reveal);
  return result;
}

// C6 §8.1/D9: "Open changes" opens a permanent tab, never the preview slot — a single tree click
// already owns the preview slot for the file viewer, so this context-menu action behaves like the
// menu's existing "Open" (permanent). openTab's dedupe key is (workspaceId, kind, connectionId,
// path), so a diff tab and a file tab for the same path coexist, and a second "Open changes"
// activates the existing one rather than opening a duplicate.
export function openRepoDiffTab(repoId: string, path: string): OpenTabResult {
  return openTab('repo-diff', null, path, defaultRepoDiffTabState, {
    reuse: true,
    workspaceId: repoWorkspaceKey(repoId),
    preview: false,
  });
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
