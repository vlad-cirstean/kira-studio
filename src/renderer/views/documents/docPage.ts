import { cellText, type DocumentPage, isNull, isTruncated } from '@shared/protocol/page';
import { reactive } from 'vue';

// Mirrors `views/grid/page.ts` exactly, but for one 'document' tab's DocumentPage instead of a
// 'data' tab's TabularPage — a document tab never holds a tabular page, so this stays a sibling
// store rather than widening the grid's own.
interface Entry {
  page: DocumentPage;
  decodeCache: Map<string, string>;
}

const pages = new Map<string, Entry>();
const decoder = new TextDecoder();

export const pageVersion = reactive({ n: 0 });

export function setPage(tabId: string, page: DocumentPage): void {
  Object.freeze(page);
  pages.set(tabId, { page, decodeCache: new Map() });
  pageVersion.n++;
}

export function getPage(tabId: string): DocumentPage | null {
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

export interface DocumentRow {
  id: string;
  body: string;
  isTruncated: boolean;
}

export function documentRow(tabId: string, row: number): DocumentRow | null {
  const entry = pages.get(tabId);
  if (!entry) return null;
  const page = entry.page;
  if (row < 0 || row >= page.rowCount) return null;

  const idKey = `id:${row}`;
  let id = entry.decodeCache.get(idKey);
  if (id === undefined) {
    id = cellText(page.ids, row, decoder);
    entry.decodeCache.set(idKey, id);
  }
  const bodyKey = `body:${row}`;
  let body = entry.decodeCache.get(bodyKey);
  if (body === undefined) {
    body = cellText(page.bodies, row, decoder);
    entry.decodeCache.set(bodyKey, body);
  }
  return { id, body, isTruncated: isTruncated(page.bodies, row) };
}

export function isIdNull(tabId: string, row: number): boolean {
  const entry = pages.get(tabId);
  if (!entry) return true;
  return isNull(entry.page.ids, row);
}

// The projection picker's candidate list (ProjectionMenu.vue) and its toolbar badge
// (DocumentView.vue) both need "every top-level field name seen on the loaded page" — a document
// collection has no catalog to read a field list from (§0 note: "Documents' 'columns' are dynamic
// per-document fields"), so this is the closest equivalent, shared so the two call sites can't
// drift on how they parse a body into field names. `_id` is left out: it is always returned
// regardless of projection (mongo/read.ts's own comment) and already has its own column, so it is
// never a real projection choice. A body that fails to parse (truncated, or genuinely not a JSON
// object) just contributes no names — never throws into a computed.
export function fieldNamesOnPage(tabId: string): string[] {
  const entry = pages.get(tabId);
  if (!entry) return [];
  const names = new Set<string>();
  for (let row = 0; row < entry.page.rowCount; row++) {
    const body = documentRow(tabId, row)?.body;
    if (body === undefined) continue;
    try {
      const parsed = JSON.parse(body) as unknown;
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) continue;
      for (const key of Object.keys(parsed as Record<string, unknown>)) {
        if (key !== '_id') names.add(key);
      }
    } catch {
      // Not valid JSON (e.g. cut mid-token by MAX_CELL_BYTES truncation) — contributes no names.
    }
  }
  return [...names].sort();
}
