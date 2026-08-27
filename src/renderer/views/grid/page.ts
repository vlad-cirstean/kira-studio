import { cellText, isNull, isTruncated, type TabularPage } from '@shared/protocol/page';
import { createPageStore } from '../shared/page/store';

// P48 F19: rebuilt on the shared factory — the two-level decode cache and P29 D7's visible-window
// pruning this file grew on its own now live in views/shared/page/store.ts, shared with
// console/resultPages.ts's own copy of both.
const store = createPageStore<TabularPage>();

export const pageVersion = store.pageVersion;
export const setPage = store.setPage;
export const getPage = store.getPage;
export const drop = store.drop;
export const totalRetainedBytes = store.totalRetainedBytes;
export const setVisibleWindow = store.setVisibleWindow;

export interface CellView {
  text: string;
  isNull: boolean;
  truncated: boolean;
}

export function cell(tabId: string, row: number, col: number): CellView {
  const page = getPage(tabId);
  if (!page) return { text: '', isNull: true, truncated: false };
  const chunk = page.chunks[col];
  if (!chunk) return { text: '', isNull: true, truncated: false };
  if (isNull(chunk, row)) return { text: '', isNull: true, truncated: false };

  const text = store.cached(tabId, row, String(col), (decoder) => cellText(chunk, row, decoder));
  return { text, isNull: false, truncated: isTruncated(chunk, row) };
}
