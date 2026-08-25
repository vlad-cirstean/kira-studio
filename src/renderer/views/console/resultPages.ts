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

/** The decode-then-cache body cell()/documentRow()/keyValueRow() each wrote out five times
 *  (P39 iter3 F11/D12) — the same one-line memo views/shared/page/store.ts's own `cached()` runs
 *  for the other three stores. Not built on that factory: this store keys by `${tabId}:${...}`
 *  rather than `tabId`, holds a `Page` union, and clears its whole cache on a window change
 *  instead of pruning (iteration 1 D7). */
function cached(entry: Entry, key: string, decode: (decoder: TextDecoder) => string): string {
  let value = entry.decodeCache.get(key);
  if (value === undefined) {
    value = decode(decoder);
    entry.decodeCache.set(key, value);
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

/** D5: mirrors `views/grid/page.ts`'s `totalRetainedBytes()` — feeds `window.__kiraRetainedBytes`. */
export function totalRetainedBytes(): number {
  let total = 0;
  for (const entry of pages.values()) total += entry.page.byteSize;
  return total;
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

  const text = cached(entry, `${row}:${col}`, (d) => cellText(chunk, row, d));
  return { text, isNull: false, truncated: isTruncated(chunk, row) };
}

/** Document-only: one document's id/body text, decoded from a DocumentPage's chunks. */
export function documentRow(key: string, row: number): { id: string; body: string } | null {
  const entry = pages.get(key);
  if (entry?.page.kind !== 'document') return null;
  const page = entry.page;
  const id = cached(entry, `id:${row}`, (d) => cellText(page.ids, row, d));
  const body = cached(entry, `body:${row}`, (d) => cellText(page.bodies, row, d));
  return { id, body };
}

/** Key/value-only: one field/value pair, decoded from a KeyValuePage's chunks. */
export function keyValueRow(key: string, row: number): { field: string; value: string } | null {
  const entry = pages.get(key);
  if (entry?.page.kind !== 'keyvalue') return null;
  const page = entry.page;
  const field = cached(entry, `field:${row}`, (d) => cellText(page.fields, row, d));
  const value = cached(entry, `value:${row}`, (d) => cellText(page.values, row, d));
  return { field, value };
}
