import { cellText, isTruncated, type KeyValuePage } from '@shared/protocol/page';
import { createPageStore } from '../shared/page/store';

const store = createPageStore<KeyValuePage>();

export const pageVersion = store.pageVersion;
export const setPage = store.setPage;
export const getPage = store.getPage;
export const drop = store.drop;
export const totalRetainedBytes = store.totalRetainedBytes;

export interface KeyValueRow {
  field: string;
  value: string;
  isTruncated: boolean;
}

export function keyValueRow(tabId: string, row: number): KeyValueRow | null {
  const page = getPage(tabId);
  if (!page || row < 0 || row >= page.rowCount) return null;
  const field =
    store.cached(tabId, row, 'field', (decoder) => cellText(page.fields, row, decoder)) ?? '';
  const value =
    store.cached(tabId, row, 'value', (decoder) => cellText(page.values, row, decoder)) ?? '';
  return { field, value, isTruncated: isTruncated(page.values, row) };
}
