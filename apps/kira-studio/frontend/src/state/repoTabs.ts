import type { PaletteColor } from '@shared/domain/color';
import {
  asRepoDiffTab,
  asRepoFileTab,
  defaultRepoDiffTabState,
  defaultRepoFileTabState,
} from '@shared/domain/tabs';
import { repoWorkspaceKey } from '@shared/domain/workspace';
import { requestReveal } from '../views/repo/reveal';
import { canonicalPath } from './coderepos';
import { tabsForWorkspace } from './mode';
import {
  activateTab,
  createPinnedRepoGraphTab,
  evictPreviewCohort,
  type OpenTabResult,
  openTab,
  patchRepoFileTabState,
  removeFromPreviewCohort,
  tabsState,
} from './tabs';
import { openRepoWorkspace } from './workspace';

export interface OpenRepoFileOpts {
  preview: boolean;
  // C7 D12/§7.4: column/endColumn widen the reveal beyond repoFileTabStateSchema's own persisted
  // `revealLine` — a search result (or a go-to-definition match) carries a column worth restoring
  // a cursor to within this session, not across a restart.
  reveal?: { line: number; column?: number; endColumn?: number };
  /** P74 §7.3: non-null opens `path` read-only at that revision instead of the worktree file —
   *  part of this tab's own identity (below), so two different revisions of the same path are two
   *  different tabs, never one silently replacing the other. `undefined`/`null` both mean the
   *  worktree file, every caller from before this phase included. */
  rev?: string | null;
}

// C5 §5.2: the repo workspace's own file-open entry point — every tree row click and every
// search/quick-open match (§12) routes through this, never openTab directly, so the preview/pin
// rules stay in exactly one place (openTab itself, §15.1's own unit-tested mechanism).
//
// P74 §7.3: does its own existing-tab lookup rather than opening through `openTab`'s `reuse: true`
// branch — `openTab`'s own dedupe key is (workspaceId, kind, connectionId, path), which has no
// room for `rev`; without this, opening the same path at two different revisions would collide
// into one tab (the identical gap `openRepoCommitDiffTab`'s own doc comment names, one kind over).
export function openRepoFileTab(
  repoId: string,
  path: string,
  opts: OpenRepoFileOpts,
): OpenTabResult {
  const revealLine = opts.reveal?.line ?? null;
  const rev = opts.rev ?? null;
  const workspaceId = repoWorkspaceKey(repoId);
  const existing = tabsState.tabs.find((t) => {
    if ((t.workspaceId ?? null) !== workspaceId || t.path !== path) return false;
    const file = asRepoFileTab(t);
    return file !== null && file.state.rev === rev;
  });
  let result: OpenTabResult;
  if (existing) {
    activateTab(existing.id);
    // §5.2 rule 1's own "a permanent open promotes the workspace's current preview tab" —
    // `openTab`'s own reuse branch does this; this wrapper's own reuse path needs the identical
    // rule since it never reaches openTab's (same reasoning as openRepoCommitDiffTab's own).
    if (!opts.preview) removeFromPreviewCohort(workspaceId, existing.id);
    result = { id: existing.id, reused: true };
  } else {
    result = openTab('repo-file', null, path, () => defaultRepoFileTabState(revealLine, rev), {
      reuse: false,
      workspaceId,
      preview: opts.preview,
    });
  }
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

// C10 §6.1 (S15): a *commit* diff — two revisions of one path, neither of which is the worktree.
// openTab's own dedupe key is (workspaceId, kind, connectionId, path) alone (openRepoDiffTab
// above relies on exactly that), which would collide two different commits' diffs of the same
// file into one tab. This wrapper does its own lookup over the revision pair as well, then
// delegates with reuse:false so openTab's own key stays exactly what C5 defined — a second commit
// diff of the same file is a second tab, never a silent replacement of the first.
//
// C11 §7.5: the lookup also requires `review === null` — without it, a single-commit branch whose
// merge base equals the commit's own parent would have the identical (left, right) pair as its
// review diff and this function would silently reuse that tab, rendering no review layer at all.
export function openRepoCommitDiffTab(
  repoId: string,
  path: string,
  left: string,
  right: string,
  labels: { left: string; right: string },
  pinned: boolean,
  // P74 §5.2: set only by a bulk caller ("Open all changes") — every file after the first in that
  // same loop, so the cohort it started is joined rather than each file evicting the last.
  previewCohort?: boolean,
): OpenTabResult {
  const workspaceId = repoWorkspaceKey(repoId);
  const existing = tabsState.tabs.find((t) => {
    if ((t.workspaceId ?? null) !== workspaceId || t.path !== path) return false;
    const diff = asRepoDiffTab(t);
    return (
      diff !== null &&
      diff.state.review === null &&
      diff.state.left === left &&
      diff.state.right === right
    );
  });
  if (existing) {
    if (pinned) {
      // §5.2 rule 1's own "a permanent open promotes the workspace's current preview tab" —
      // openTab's own reuse branch does this; this wrapper's own reuse path needs the identical
      // rule since it never reaches openTab's.
      removeFromPreviewCohort(workspaceId, existing.id);
    } else if (!previewCohort) {
      // P79 review fix (Functional, LOW): this reuse path short-circuits past openTab entirely,
      // so a preview-type open (not a cohort-joining one) never reached openTab's own §5.2 rule 3
      // eviction — "Open all changes" reusing file 0's own already-open (permanent) tab left
      // whatever preview cohort/slot preceded it (an unrelated previewed tab) untouched instead
      // of being replaced. Mirrors openTab's own `previewIdsByWorkspace[key] = [id]` outcome for a
      // freshly created preview tab: `existing.id` becomes the sole surviving cohort member,
      // exactly as it would if a fresh tab had been created here instead of reused. Ordered before
      // activateTab below so its own saveNow() call persists the eviction too, not a later,
      // unrelated save.
      evictPreviewCohort(workspaceId, existing.id);
    }
    activateTab(existing.id);
    return { id: existing.id, reused: true };
  }
  return openTab(
    'repo-diff',
    null,
    path,
    () =>
      defaultRepoDiffTabState({
        left,
        right,
        leftLabel: labels.left,
        rightLabel: labels.right,
      }),
    { reuse: false, workspaceId, preview: !pinned, previewCohort },
  );
}

// C11 §7.5/§7.4 (S8): the review-diff counterpart to openRepoCommitDiffTab above — same shape, one
// correction to the dedupe predicate (`review !== null`, this function's own mirror of that
// function's added `review === null`) so the two tab kinds can never collide into one. `review`
// turns on `reviewDecorations.ts`'s comment/mark layer (§7.4) over the same left/right pair; `left`
// is the merge base or `reviewedAtSha` (§7.2's two diff modes), `right` is always `review.branchTip`.
export function openRepoReviewDiffTab(
  repoId: string,
  path: string,
  left: string,
  right: string,
  labels: { left: string; right: string },
  review: { branch: string; branchTip: string; leftLabel: string },
  pinned: boolean,
  // P74 §5.2: mirrors openRepoCommitDiffTab's own trailing param — see its doc comment.
  previewCohort?: boolean,
): OpenTabResult {
  const workspaceId = repoWorkspaceKey(repoId);
  const existing = tabsState.tabs.find((t) => {
    if ((t.workspaceId ?? null) !== workspaceId || t.path !== path) return false;
    const diff = asRepoDiffTab(t);
    return (
      diff !== null &&
      diff.state.review !== null &&
      diff.state.review.branch === review.branch &&
      diff.state.left === left &&
      diff.state.right === right
    );
  });
  if (existing) {
    activateTab(existing.id);
    if (pinned) removeFromPreviewCohort(workspaceId, existing.id);
    return { id: existing.id, reused: true };
  }
  return openTab(
    'repo-diff',
    null,
    path,
    () =>
      defaultRepoDiffTabState(
        { left, right, leftLabel: labels.left, rightLabel: labels.right },
        review,
      ),
    { reuse: false, workspaceId, preview: !pinned, previewCohort },
  );
}

// P85 §5.3: what a non-plain launch (Claude Code, or a custom script) seeds a terminal tab with.
export interface TerminalLaunch {
  command: string;
  label: string;
  color: PaletteColor;
}

// P83 §10.3: opens a terminal tab in codeRepoId's own workspace, rooted at `cwd` — the tab-strip
// "+" (active workspace's root) and both GitPanel.vue row menus (a repo's root or a worktree's own
// path) all funnel through this. `reuse: false` — a terminal is a session, not a document
// (openConsoleTab's own reasoning, state/tabs.ts). openRepoWorkspace runs first: a tab must belong
// to a workspace whose strip is on screen, and right-clicking a closed repository's row would
// otherwise open an invisible tab. `launch`, when given (P85 §5.3), seeds the session's initial
// command/title/rail colour — omitted, this is P83's own plain terminal, unchanged.
export function openRepoTerminalTab(
  codeRepoId: string,
  cwd: string,
  launch?: TerminalLaunch,
): OpenTabResult {
  openRepoWorkspace(codeRepoId);
  return openTab(
    'terminal',
    null,
    cwd,
    () => ({
      cwd: canonicalPath(cwd),
      codeRepoId,
      command: launch?.command ?? '',
      label: launch?.label ?? '',
      color: launch?.color ?? 'none',
    }),
    { reuse: false, workspaceId: repoWorkspaceKey(codeRepoId) },
  );
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
