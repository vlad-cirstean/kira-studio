import { cellText, isNull, isTruncated, type TabularPage } from '@shared/protocol/page';
import { reactive } from 'vue';

interface Entry {
  page: TabularPage;
  /** row -> col -> decoded text. Pruned, not cleared, whenever the visible window moves (P29 D7)
   *  — only rows that actually left the window are evicted, and the window already includes the
   *  overscan on both sides, so the entries thrown away are the ones about to be needed again. */
  decodeCache: Map<number, Map<number, string>>;
  windowStart: number;
  windowEnd: number;
}

// Plain module state, NOT reactive — a Proxy around 600 000 cells is the frame budget (§2.1).
const pages = new Map<string, Entry>();
const decoder = new TextDecoder();

/** Bumped whenever a tab's page is replaced. Components watch this, not the page (§8a). */
export const pageVersion = reactive({ n: 0 });

export function setPage(tabId: string, page: TabularPage): void {
  // A tripwire: any code that tries to mutate this fails loudly in dev instead of silently
  // diverging from `byteSize`.
  Object.freeze(page);
  pages.set(tabId, { page, decodeCache: new Map(), windowStart: 0, windowEnd: 0 });
  pageVersion.n++;
}

export function getPage(tabId: string): TabularPage | null {
  return pages.get(tabId)?.page ?? null;
}

export function drop(tabId: string): void {
  if (pages.delete(tabId)) pageVersion.n++;
}

export function dropForTab(tabId: string): void {
  drop(tabId);
}

export function totalRetainedBytes(): number {
  let total = 0;
  for (const entry of pages.values()) total += entry.page.byteSize;
  return total;
}

/**
 * Called by the grid on scroll: prunes the decoded-string cache to the visible row window
 * (P29 D7) — evicting only the rows that left it, rather than clearing the whole cache on every
 * boundary crossed, so a fling doesn't re-decode a window that mostly overlaps the last one.
 */
export function setVisibleWindow(tabId: string, startRow: number, endRow: number): void {
  const entry = pages.get(tabId);
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

export function cell(tabId: string, row: number, col: number): CellView {
  const entry = pages.get(tabId);
  if (!entry) return { text: '', isNull: true, truncated: false };
  const chunk = entry.page.chunks[col];
  if (!chunk) return { text: '', isNull: true, truncated: false };
  if (isNull(chunk, row)) return { text: '', isNull: true, truncated: false };

  let rowCache = entry.decodeCache.get(row);
  let text = rowCache?.get(col);
  if (text === undefined) {
    text = cellText(chunk, row, decoder);
    if (!rowCache) {
      rowCache = new Map();
      entry.decodeCache.set(row, rowCache);
    }
    rowCache.set(col, text);
  }
  return { text, isNull: false, truncated: isTruncated(chunk, row) };
}
