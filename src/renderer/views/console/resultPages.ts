import { cellText, isNull, isTruncated, type Page } from '@shared/protocol/page';
import { reactive } from 'vue';

// The console's own page store (P5.5), widened in P8 to hold either page kind — a console
// result can be tabular (SQL) or document (Mongo shell), unlike `views/grid/page.ts`'s store,
// which stays tabular-only because a 'data' tab is never anything else. Kept as a sibling file
// rather than widening grid/page.ts's `cell()`/DataGrid.vue's call sites, which assume tabular
// throughout.
interface Entry {
  page: Page;
  decodeCache: Map<string, string>;
  windowKey: string;
}

const pages = new Map<string, Entry>();
const decoder = new TextDecoder();

export const pageVersion = reactive({ n: 0 });

export function setPage(key: string, page: Page): void {
  Object.freeze(page);
  pages.set(key, { page, decodeCache: new Map(), windowKey: '' });
  pageVersion.n++;
}

export function getPage(key: string): Page | null {
  return pages.get(key)?.page ?? null;
}

export function drop(key: string): void {
  if (pages.delete(key)) pageVersion.n++;
}

export function dropForTab(tabId: string): void {
  let changed = false;
  const prefix = `${tabId}:`;
  for (const key of pages.keys()) {
    if (key === tabId || key.startsWith(prefix)) {
      pages.delete(key);
      changed = true;
    }
  }
  if (changed) pageVersion.n++;
}

export function setVisibleWindow(key: string, startRow: number, endRow: number): void {
  const entry = pages.get(key);
  if (!entry) return;
  const windowKey = `${startRow}:${endRow}`;
  if (entry.windowKey !== windowKey) {
    entry.windowKey = windowKey;
    entry.decodeCache.clear();
  }
}

export interface CellView {
  text: string;
  isNull: boolean;
  truncated: boolean;
}

/** Tabular-only, same contract as `views/grid/page.ts`'s `cell()`. */
export function cell(key: string, row: number, col: number): CellView {
  const entry = pages.get(key);
  if (entry?.page.kind !== 'tabular') return { text: '', isNull: true, truncated: false };
  const chunk = entry.page.chunks[col];
  if (!chunk) return { text: '', isNull: true, truncated: false };
  if (isNull(chunk, row)) return { text: '', isNull: true, truncated: false };

  const cacheKey = `${row}:${col}`;
  let text = entry.decodeCache.get(cacheKey);
  if (text === undefined) {
    text = cellText(chunk, row, decoder);
    entry.decodeCache.set(cacheKey, text);
  }
  return { text, isNull: false, truncated: isTruncated(chunk, row) };
}

/** Document-only: one document's id/body text, decoded from a DocumentPage's chunks. */
export function documentRow(key: string, row: number): { id: string; body: string } | null {
  const entry = pages.get(key);
  if (entry?.page.kind !== 'document') return null;
  const page = entry.page;
  const idCacheKey = `id:${row}`;
  const bodyCacheKey = `body:${row}`;
  let id = entry.decodeCache.get(idCacheKey);
  if (id === undefined) {
    id = cellText(page.ids, row, decoder);
    entry.decodeCache.set(idCacheKey, id);
  }
  let body = entry.decodeCache.get(bodyCacheKey);
  if (body === undefined) {
    body = cellText(page.bodies, row, decoder);
    entry.decodeCache.set(bodyCacheKey, body);
  }
  return { id, body };
}

/** Key/value-only: one field/value pair, decoded from a KeyValuePage's chunks. */
export function keyValueRow(key: string, row: number): { field: string; value: string } | null {
  const entry = pages.get(key);
  if (entry?.page.kind !== 'keyvalue') return null;
  const page = entry.page;
  const fieldCacheKey = `field:${row}`;
  const valueCacheKey = `value:${row}`;
  let field = entry.decodeCache.get(fieldCacheKey);
  if (field === undefined) {
    field = cellText(page.fields, row, decoder);
    entry.decodeCache.set(fieldCacheKey, field);
  }
  let value = entry.decodeCache.get(valueCacheKey);
  if (value === undefined) {
    value = cellText(page.values, row, decoder);
    entry.decodeCache.set(valueCacheKey, value);
  }
  return { field, value };
}
