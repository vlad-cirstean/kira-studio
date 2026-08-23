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
