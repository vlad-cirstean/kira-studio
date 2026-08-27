import { reactive } from 'vue';

// P39 F9, grown by P48 F19: one factory behind all five page modules. grid/page.ts (P29 D7) and
// console/resultPages.ts (P43 F2/D3) each grew the same two things separately — a two-level
// decode cache (row -> subKey -> text) and visible-window pruning — while documents/keyvalue/
// stream never got either. Both are folded in here: the three views that never call
// setVisibleWindow simply never prune, which is today's behaviour for them unchanged.
interface Entry<P> {
  page: P;
  decodeCache: Map<number, Map<string, string>>;
  windowStart: number;
  windowEnd: number;
}

export interface PageStore<P extends { rowCount: number; byteSize: number }> {
  readonly pageVersion: { n: number };
  /** state.ts's setActiveResult (P40 D9) raises "the page this scope resolves to changed"
   *  without a page of its own to setPage/drop. */
  bumpPageVersion(): void;
  setPage(scope: string, page: P): void;
  getPage(scope: string): P | null;
  drop(scope: string): void;
  /** console/resultPages.ts's own dropForTab: every scope equal to, or prefixed by, `${prefix}:`. */
  dropForPrefix(prefix: string): void;
  totalRetainedBytes(): number;
  /** row -> subKey -> decoded text, memoized. `subKey` is what was decoded *within* a row: a
   *  tabular cell's column index (as a string), or one of 'id'/'body'/'field'/'value'/etc. */
  cached(
    scope: string,
    row: number,
    subKey: string,
    decode: (decoder: TextDecoder) => string,
  ): string;
  /** Prunes the decode cache to the visible row window (P29 D7) instead of clearing it outright,
   *  so a fling doesn't re-decode a window that mostly overlaps the last one. A no-op for a scope
   *  that never calls this — the cache simply never prunes. */
  setVisibleWindow(scope: string, startRow: number, endRow: number): void;
}

export function createPageStore<P extends { rowCount: number; byteSize: number }>(opts?: {
  onSet?(scope: string): void;
}): PageStore<P> {
  const pages = new Map<string, Entry<P>>();
  const decoder = new TextDecoder();
  const pageVersion = reactive({ n: 0 });

  return {
    pageVersion,

    bumpPageVersion() {
      pageVersion.n++;
    },

    setPage(scope, page) {
      // A tripwire: any code that tries to mutate this fails loudly in dev instead of silently
      // diverging from `byteSize`.
      Object.freeze(page);
      pages.set(scope, { page, decodeCache: new Map(), windowStart: 0, windowEnd: 0 });
      pageVersion.n++;
      opts?.onSet?.(scope);
    },

    getPage(scope) {
      return pages.get(scope)?.page ?? null;
    },

    drop(scope) {
      if (pages.delete(scope)) pageVersion.n++;
    },

    dropForPrefix(prefix) {
      let changed = false;
      const withColon = `${prefix}:`;
      for (const scope of pages.keys()) {
        if (scope === prefix || scope.startsWith(withColon)) {
          pages.delete(scope);
          changed = true;
        }
      }
      if (changed) pageVersion.n++;
    },

    totalRetainedBytes() {
      let total = 0;
      for (const entry of pages.values()) total += entry.page.byteSize;
      return total;
    },

    cached(scope, row, subKey, decode) {
      const entry = pages.get(scope);
      if (!entry) return decode(decoder);
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
    },

    setVisibleWindow(scope, startRow, endRow) {
      const entry = pages.get(scope);
      if (!entry) return;
      if (entry.windowStart === startRow && entry.windowEnd === endRow) return;
      for (const row of entry.decodeCache.keys()) {
        if (row < startRow || row >= endRow) entry.decodeCache.delete(row);
      }
      entry.windowStart = startRow;
      entry.windowEnd = endRow;
    },
  };
}
