import type { KeyValueTabState, PageSize } from '@shared/domain/tabs';
import { findKeyValueTab, patchKeyValueTabState } from '../../state/tabs';

// P63 §2.2: the seam that widens keyvalue/state.ts's `tabId` (a real KeyValueTabRecord id) into
// `viewKey` (any string identifying a place that renders a key/value page) — the browse split's
// value pane is the first caller with no backing tab at all (BrowseView.vue registers one keyed
// `${browseTabId}::preview`, §5). Everything state.ts/mutations.ts/page.ts need from "the tab" is
// exactly this shape.
export interface KeyValueHost {
  connectionId: string | null;
  path: string;
  pageIndex: number;
  pageSize: PageSize;
  patch(p: { pageIndex?: number; pageSize?: PageSize }): void;
}

const hosts = new Map<string, () => KeyValueHost | null>();

/** Registers a synthetic (non-tab) host for `viewKey` — only the browse split's own
 *  `${tabId}::preview` key needs this; every ordinary KeyValue tab is served by the tab-backed
 *  fallback below with no registration call anywhere. */
export function registerKeyValueHost(viewKey: string, host: () => KeyValueHost | null): void {
  hosts.set(viewKey, host);
}

export function unregisterKeyValueHost(viewKey: string): void {
  hosts.delete(viewKey);
}

function patchForTab(id: string, p: Partial<KeyValueTabState>): void {
  patchKeyValueTabState(id, p);
}

/** §2.2 step 3: "a tab-backed host is registered once, centrally" — here, as the fallback every
 *  `keyValueHost` lookup falls through to when `viewKey` has no explicit registration. Treating
 *  `viewKey` itself as a real tab id this way covers every existing KeyValue tab (opened via
 *  openTab, duplicated, or restored by hydrateTabs) without a single register call anywhere in
 *  state/tabs.ts's several tab-creation paths — only a genuinely synthetic viewKey needs
 *  `registerKeyValueHost` at all. */
export function keyValueHost(viewKey: string): KeyValueHost | null {
  const explicit = hosts.get(viewKey);
  if (explicit) return explicit();
  const tab = findKeyValueTab(viewKey);
  if (!tab) return null;
  return {
    connectionId: tab.connectionId,
    path: tab.path,
    pageIndex: tab.state.pageIndex,
    pageSize: tab.state.pageSize,
    patch: (p) => patchForTab(viewKey, p),
  };
}
