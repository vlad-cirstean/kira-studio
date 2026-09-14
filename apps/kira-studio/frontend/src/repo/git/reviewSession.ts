/**
 * C11 §8.3 (S6) — session persistence through the pinned repo-graph tab's own state, the native
 * counterpart to the extension's `context.workspaceState`-backed `ReviewSessionStore`. The review
 * panel itself is not a tab (§5.3), so it has no tab record of its own to persist through, and
 * `repo/state/search.ts` shows the native panel-state precedent is in-memory only (no
 * `control.*` persistence call) — which would lose exactly the resume point G19 D11b built this
 * for. The pinned `repo-graph` tab is the right host instead: created once per repo workspace
 * (`ensureWorkspaceShell`), never closed, and already carrying one opaque git-ui-owned blob
 * (`repoGraphTabStateSchema.viewState`, C10 S13) — `reviewSession` is a second field of the same
 * shape, and this module mirrors `viewStateStore.ts` line for line over it.
 *
 * The value stays opaque to this host, same discipline as `viewState`: `ReviewView.vue`/
 * `state/review.ts` define and validate their own `ReviewSessionSnapshot` shape (`@kira/git-ipc`'s
 * own type) — this module only stores and retrieves it, never parses it.
 */
import { asRepoGraphTab } from '@shared/domain/tabs';
import { repoWorkspaceKey } from '@shared/domain/workspace';
import { tabsForWorkspace } from '../../state/mode';
import { patchRepoGraphTabState, tabsState } from '../../state/tabs';

function pinnedGraphTabId(codeRepoId: string): string | null {
  const key = repoWorkspaceKey(codeRepoId);
  return tabsForWorkspace(key).find((t) => t.kind === 'repo-graph')?.id ?? null;
}

/** `review.session.load`'s native answer (§8.2). `null` covers both "never saved" and "the pinned
 *  graph tab does not exist yet" (a workspace whose graph was never mounted) — the same "nothing
 *  to resume" outcome either way. */
export function loadReviewSession(codeRepoId: string): unknown | null {
  const tabId = pinnedGraphTabId(codeRepoId);
  if (!tabId) return null;
  const tab = asRepoGraphTab(tabsState.tabs.find((t) => t.id === tabId));
  return tab?.state.reviewSession ?? null;
}

/** `review.session.save`'s native answer. `session: null` clears the stored resume point — the
 *  same "back to branch selection" gesture `clearTarget()` sends today. A no-op when the pinned
 *  tab does not exist yet, the same posture `loadReviewSession` takes (nothing to persist through,
 *  and nothing worth creating a tab just to hold). */
export function saveReviewSession(codeRepoId: string, session: unknown | null): void {
  const tabId = pinnedGraphTabId(codeRepoId);
  if (!tabId) return;
  patchRepoGraphTabState(tabId, { reviewSession: session });
}
