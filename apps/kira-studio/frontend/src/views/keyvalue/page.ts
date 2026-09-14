import { cellText, isTruncated, type KeyValuePage } from '@shared/protocol/page';
import { registerTabRuntimeCleanup } from '../../state/tabRuntime';
import { createPageStore, type RetentionEntry, retentionEntries } from '../shared/page/store';

const store = createPageStore<KeyValuePage>();

export const pageVersion = store.pageVersion;
export const setPage = store.setPage;
export const getPage = store.getPage;
export const drop = store.drop;
export const totalRetainedBytes = store.totalRetainedBytes;
export const setVisibleWindow = store.setVisibleWindow;

// P63: tabKinds.ts's own dropResources (`drop`, this module's own export above) only fires for
// the CLOSING tab's own kind — a keyvalue tab drops its own page here. The browse split's preview
// pane keys its own page-store entry `${tabId}::preview`, which is not a real tab id and so never
// closes on its own kind's dropResources — this generic, every-tab-close hook drops it instead,
// when the browse tab that owns it closes. A no-op for every tab kind that never has one.
registerTabRuntimeCleanup((tabId) => drop(`${tabId}::preview`));
/** Playwright-only (main.ts's `window.__kiraRetention`, C1). */
export function pageStoreEntries(): RetentionEntry<KeyValuePage>[] {
  return retentionEntries(store);
}

export interface KeyValueRow {
  field: string;
  value: string;
  isTruncated: boolean;
}

export function keyValueRow(tabId: string, row: number): KeyValueRow | null {
  const page = getPage(tabId);
  if (!page || row < 0 || row >= page.rowCount) return null;
  // P2 R2 (task #99): see grid/page.ts's cell() for why this is wrapped in cachedView.
  return store.cachedView(tabId, row, 'row', () => ({
    field:
      store.cached(tabId, row, 'field', (decoder) => cellText(page.fields, row, decoder)) ?? '',
    value:
      store.cached(tabId, row, 'value', (decoder) => cellText(page.values, row, decoder)) ?? '',
    isTruncated: isTruncated(page.values, row),
  }));
}
