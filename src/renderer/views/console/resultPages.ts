import { cellText, isNull, isTruncated, type Page } from '@shared/protocol/page';
import { reactive } from 'vue';

// The console's own page store (P5.5), widened in P8 to hold either page kind — a console
// result can be tabular (SQL) or document (Mongo shell), unlike `views/grid/page.ts`'s store,
// which stays tabular-only because a 'data' tab is never anything else. Kept as a sibling file
// rather than widening grid/page.ts's `cell()`/DataGrid.vue's call sites, which assume tabular
// throughout.
interface Entry {
  page: Page;
  /** row -> subKey -> decoded text, mirroring `views/grid/page.ts`'s own two-level cache exactly
   *  (P43 F2/D3) — `subKey` is what was decoded *within* a row: a tabular cell's column index (as
   *  a string), or one of 'id'/'body'/'field'/'value'. Pruned, not cleared, whenever the visible
   *  window moves — only rows that actually left the window are evicted. */
  decodeCache: Map<number, Map<string, string>>;
  windowStart: number;
  windowEnd: number;
}

const pages = new Map<string, Entry>();
const decoder = new TextDecoder();

/** The decode-then-cache body cell()/documentRow()/keyValueRow() each wrote out five times
 *  (P39 iter3 F11/D12) — the same one-line memo views/shared/page/store.ts's own `cached()` runs
 *  for the other three stores. Not built on that factory: this store keys by `${tabId}:${...}`
 *  rather than `tabId`, and holds a `Page` union. */
function cached(
  entry: Entry,
  row: number,
  subKey: string,
  decode: (decoder: TextDecoder) => string,
): string {
  let rowCache = entry.decodeCache.get(row);
  if (!rowCache) {
    rowCache = new Map();
    entry.decodeCache.set(row, rowCache);
  }
  let value = rowCache.get(subKey);
  if (value === undefined) {
    value = decode(decoder);
    rowCache.set(subKey, value);
  }
  return value;
}

export const pageVersion = reactive({ n: 0 });

/** The `pageVersion.n++` setPage/drop/dropForTab each already do inline, named — so state.ts's
 *  setActiveResult (P40 D9) can raise the same "the page this scope resolves to changed" signal
 *  without reaching into the counter directly. */
export function bumpPageVersion(): void {
  pageVersion.n++;
}

export function setPage(key: string, page: Page): void {
  Object.freeze(page);
  pages.set(key, { page, decodeCache: new Map(), windowStart: 0, windowEnd: 0 });
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

/** D5: mirrors `views/grid/page.ts`'s `totalRetainedBytes()` — feeds `window.__kiraRetainedBytes`. */
export function totalRetainedBytes(): number {
  let total = 0;
  for (const entry of pages.values()) total += entry.page.byteSize;
  return total;
}

/** Called by ConsoleResultGrid.vue on scroll (from the same bounds its own search-priority report
 *  already computes, P42 D39 — see `visibleRows.ts`'s own handoff note): prunes the decoded-string
 *  cache to the visible row window (P29 D7 precedent) instead of clearing it outright, so a fling
 *  doesn't re-decode a window that mostly overlaps the last one. */
export function setVisibleWindow(key: string, startRow: number, endRow: number): void {
  const entry = pages.get(key);
  if (!entry) return;
  if (entry.windowStart === startRow && entry.windowEnd === endRow) return;
  for (const row of entry.decodeCache.keys()) {
    if (row < startRow || row >= endRow) entry.decodeCache.delete(row);
  }
  entry.windowStart = startRow;
  entry.windowEnd = endRow;
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

  const text = cached(entry, row, String(col), (d) => cellText(chunk, row, d));
  return { text, isNull: false, truncated: isTruncated(chunk, row) };
}

/** Document-only: one document's id/body text, decoded from a DocumentPage's chunks. Mirrors
 *  views/documents/page.ts's own documentRow() (P43 iter2 D28) — the divergence (this one
 *  hard-coded `isTruncated: false`) meant the console's own cell-editor publish could never know
 *  a Mongo console document's body was cut, unlike the data-tab equivalent. */
export function documentRow(
  key: string,
  row: number,
): { id: string; body: string; isTruncated: boolean } | null {
  const entry = pages.get(key);
  if (entry?.page.kind !== 'document') return null;
  const page = entry.page;
  const id = cached(entry, row, 'id', (d) => cellText(page.ids, row, d));
  const body = cached(entry, row, 'body', (d) => cellText(page.bodies, row, d));
  return { id, body, isTruncated: isTruncated(page.bodies, row) };
}

/** Key/value-only: one field/value pair, decoded from a KeyValuePage's chunks. */
export function keyValueRow(key: string, row: number): { field: string; value: string } | null {
  const entry = pages.get(key);
  if (entry?.page.kind !== 'keyvalue') return null;
  const page = entry.page;
  const field = cached(entry, row, 'field', (d) => cellText(page.fields, row, d));
  const value = cached(entry, row, 'value', (d) => cellText(page.values, row, d));
  return { field, value };
}
