import type { MutationRowOp } from '@shared/domain/mutations';
import { data } from '../../bridge/data';
import { reloadTabsForTarget } from '../../state/viewCommands';

// P48 F18: the nine-call-site body behind documents/keyvalue/stream's mutations.ts (P8's ground
// rules — mutate immediately, no pendingChanges.ts-style staged plan, no preview step): resolve
// the tab, one data.mutate, reload the tab's own page, then tell every sibling tab open on the
// same target. `after` covers the one optional tail two of those nine call sites add
// (deleteKey's browseInvalidate) — addKey is not built on this at all, since it opens a new tab
// instead of reloading the current one.
export function createImmediateMutator<
  T extends { connectionId: string | null; path: string },
>(opts: {
  findTab(tabId: string): T | null;
  reload(tabId: string): Promise<void>;
}): (
  tabId: string,
  ops: MutationRowOp[],
  after?: (tab: T & { connectionId: string }) => void | Promise<void>,
) => Promise<void> {
  return async (tabId, ops, after) => {
    const tab = opts.findTab(tabId);
    if (!tab?.connectionId) return;
    await data.mutate({
      opId: crypto.randomUUID(),
      tabId,
      connectionId: tab.connectionId,
      path: tab.path,
      ops,
    });
    await opts.reload(tabId);
    reloadTabsForTarget(tab.connectionId, tab.path, tabId);
    await after?.(tab as T & { connectionId: string });
  };
}
