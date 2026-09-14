import type { PageSize } from '@shared/domain/tabs';
import { findKeyValueTab, patchKeyValueTabState } from '../../../state/tabs';

// P63 §2.2: the seam that lets views/shared/keyvalue/ (state.ts, mutations.ts, KeyValuePane.vue)
// address either a real KeyValue tab or the browse split's preview pane through one shape, instead
// of reaching into state/tabs.ts's tab-only findKeyValueTab/patchKeyValueTabState directly. A real
// tab never registers explicitly — resolveTabHost below is keyValueHost's own fallback, so every
// existing KeyValue tab keeps behaving exactly as it did before this seam existed. Only a
// non-tab viewKey (BrowseView.vue's own `${tab.id}::preview`) registers one explicitly, backed by
// its own runtime fields (browse/state.ts).
export interface KeyValueHost {
  connectionId: string | null;
  path: string;
  pageIndex: number;
  pageSize: PageSize;
  patch(p: { pageIndex?: number; pageSize?: PageSize }): void;
}

const registry = new Map<string, () => KeyValueHost | null>();

export function registerKeyValueHost(viewKey: string, host: () => KeyValueHost | null): void {
  registry.set(viewKey, host);
}

export function unregisterKeyValueHost(viewKey: string): void {
  registry.delete(viewKey);
}

// The tab-backed fallback: any viewKey that resolves to a real KeyValueTabRecord (viewKey === the
// tab's own id, the common case) is served from that tab's own state, with no explicit
// registration required — "registered once, centrally" (§2.2 point 3) means this function, not a
// per-tab call into registerKeyValueHost.
function resolveTabHost(viewKey: string): KeyValueHost | null {
  const tab = findKeyValueTab(viewKey);
  if (!tab) return null;
  return {
    connectionId: tab.connectionId,
    path: tab.path,
    pageIndex: tab.state.pageIndex,
    pageSize: tab.state.pageSize,
    patch: (p) => patchKeyValueTabState(viewKey, p),
  };
}

export function keyValueHost(viewKey: string): KeyValueHost | null {
  return registry.get(viewKey)?.() ?? resolveTabHost(viewKey);
}
