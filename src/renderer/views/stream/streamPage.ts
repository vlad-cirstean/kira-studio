import { cellText, isNull, isTruncated, type StreamPage } from '@shared/protocol/page';
import { reactive } from 'vue';

// Mirrors `views/keyvalue/kvPage.ts` exactly, but for one 'stream' tab's StreamPage instead of a
// 'keyvalue' tab's KeyValuePage — a stream tab never holds a key/value page, so this stays a
// sibling store rather than widening that one.
interface Entry {
  page: StreamPage;
  decodeCache: Map<string, string>;
}

const pages = new Map<string, Entry>();
const decoder = new TextDecoder();

export const pageVersion = reactive({ n: 0 });

export function setPage(tabId: string, page: StreamPage): void {
  Object.freeze(page);
  pages.set(tabId, { page, decodeCache: new Map() });
  pageVersion.n++;
}

export function getPage(tabId: string): StreamPage | null {
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

export interface StreamRow {
  key: string | null;
  headers: string;
  attrs: string;
  timestamp: string | null;
  body: string;
  isTruncated: boolean;
}

function cached(
  entry: Entry,
  cacheKey: string,
  chunk: Parameters<typeof cellText>[0],
  row: number,
): string {
  let value = entry.decodeCache.get(cacheKey);
  if (value === undefined) {
    value = cellText(chunk, row, decoder);
    entry.decodeCache.set(cacheKey, value);
  }
  return value;
}

export function streamRow(tabId: string, row: number): StreamRow | null {
  const entry = pages.get(tabId);
  if (!entry) return null;
  const page = entry.page;
  if (row < 0 || row >= page.rowCount) return null;

  return {
    key: isNull(page.keys, row) ? null : cached(entry, `key:${row}`, page.keys, row),
    headers: cached(entry, `headers:${row}`, page.headers, row),
    attrs: cached(entry, `attrs:${row}`, page.attrs, row),
    timestamp: isNull(page.timestamps, row)
      ? null
      : cached(entry, `timestamp:${row}`, page.timestamps, row),
    body: cached(entry, `body:${row}`, page.bodies, row),
    isTruncated: isTruncated(page.bodies, row),
  };
}
