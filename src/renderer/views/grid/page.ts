import { cellText, isNull, isTruncated, type TabularPage } from '@shared/protocol/page';
import { reactive } from 'vue';

interface Entry {
  page: TabularPage;
  /** Keyed `${row}:${col}`, cleared whenever the visible window moves or the page is replaced. */
  decodeCache: Map<string, string>;
  windowKey: string;
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
  pages.set(tabId, { page, decodeCache: new Map(), windowKey: '' });
  pageVersion.n++;
}

export function getPage(tabId: string): TabularPage | null {
  return pages.get(tabId)?.page ?? null;
}

export function drop(tabId: string): void {
  if (pages.delete(tabId)) pageVersion.n++;
}

export function totalRetainedBytes(): number {
  let total = 0;
  for (const entry of pages.values()) total += entry.page.byteSize;
  return total;
}

/**
 * Called by the grid on scroll: clears the decoded-string cache whenever the visible row
 * window moves off it, so only visible cells are ever decoded (§8a) rather than the whole page
 * up front, which would rebuild exactly the per-row JS objects D3 exists to avoid.
 */
export function setVisibleWindow(tabId: string, startRow: number, endRow: number): void {
  const entry = pages.get(tabId);
  if (!entry) return;
  const key = `${startRow}:${endRow}`;
  if (entry.windowKey !== key) {
    entry.windowKey = key;
    entry.decodeCache.clear();
  }
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

  const key = `${row}:${col}`;
  let text = entry.decodeCache.get(key);
  if (text === undefined) {
    text = cellText(chunk, row, decoder);
    entry.decodeCache.set(key, text);
  }
  return { text, isNull: false, truncated: isTruncated(chunk, row) };
}
