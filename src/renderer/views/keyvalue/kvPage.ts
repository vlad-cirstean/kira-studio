import { cellText, isTruncated, type KeyValuePage } from '@shared/protocol/page';
import { reactive } from 'vue';

// Mirrors `views/documents/docPage.ts` exactly, but for one 'keyvalue' tab's KeyValuePage
// instead of a 'document' tab's DocumentPage — a key/value tab never holds a document page, so
// this stays a sibling store rather than widening the document one.
interface Entry {
  page: KeyValuePage;
  decodeCache: Map<string, string>;
}

const pages = new Map<string, Entry>();
const decoder = new TextDecoder();

export const pageVersion = reactive({ n: 0 });

export function setPage(tabId: string, page: KeyValuePage): void {
  Object.freeze(page);
  pages.set(tabId, { page, decodeCache: new Map() });
  pageVersion.n++;
}

export function getPage(tabId: string): KeyValuePage | null {
  return pages.get(tabId)?.page ?? null;
}

export function drop(tabId: string): void {
  if (pages.delete(tabId)) pageVersion.n++;
}

export function dropForTab(tabId: string): void {
  drop(tabId);
}

/** D5: mirrors `views/grid/page.ts`'s `totalRetainedBytes()` — feeds `window.__kiraRetainedBytes`. */
export function totalRetainedBytes(): number {
  let total = 0;
  for (const entry of pages.values()) total += entry.page.byteSize;
  return total;
}

export interface KeyValueRow {
  field: string;
  value: string;
  isTruncated: boolean;
}

export function keyValueRow(tabId: string, row: number): KeyValueRow | null {
  const entry = pages.get(tabId);
  if (!entry) return null;
  const page = entry.page;
  if (row < 0 || row >= page.rowCount) return null;

  const fieldKey = `field:${row}`;
  let field = entry.decodeCache.get(fieldKey);
  if (field === undefined) {
    field = cellText(page.fields, row, decoder);
    entry.decodeCache.set(fieldKey, field);
  }
  const valueKey = `value:${row}`;
  let value = entry.decodeCache.get(valueKey);
  if (value === undefined) {
    value = cellText(page.values, row, decoder);
    entry.decodeCache.set(valueKey, value);
  }
  return { field, value, isTruncated: isTruncated(page.values, row) };
}
