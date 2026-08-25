import { reactive } from 'vue';

// P39 F9: documents/keyvalue/stream each declared this same store byte-for-byte, differing only
// in the page type and the row accessor built on top of it. Replaces the three; views/grid/page.ts
// and views/console/resultPages.ts keep their own files — the grid's holds a two-level decode
// cache plus P29 D7's visible-window pruning and the console's holds a `Page` union and a
// `windowKey`, neither of which this factory has any notion of.
interface Entry<P> {
  page: P;
  decodeCache: Map<string, string>;
}

export interface PageStore<P extends { rowCount: number; byteSize: number }> {
  readonly pageVersion: { n: number };
  setPage(tabId: string, page: P): void;
  getPage(tabId: string): P | null;
  drop(tabId: string): void;
  totalRetainedBytes(): number;
  /** Decoded-text memo for one row's field, keyed `${field}:${row}` exactly as today. */
  cached(tabId: string, key: string, decode: (decoder: TextDecoder) => string): string | null;
}

export function createPageStore<P extends { rowCount: number; byteSize: number }>(opts?: {
  onSet?(tabId: string): void;
}): PageStore<P> {
  const pages = new Map<string, Entry<P>>();
  const decoder = new TextDecoder();
  const pageVersion = reactive({ n: 0 });

  return {
    pageVersion,

    setPage(tabId, page) {
      Object.freeze(page);
      pages.set(tabId, { page, decodeCache: new Map() });
      pageVersion.n++;
      opts?.onSet?.(tabId);
    },

    getPage(tabId) {
      return pages.get(tabId)?.page ?? null;
    },

    drop(tabId) {
      if (pages.delete(tabId)) pageVersion.n++;
    },

    totalRetainedBytes() {
      let total = 0;
      for (const entry of pages.values()) total += entry.page.byteSize;
      return total;
    },

    cached(tabId, key, decode) {
      const entry = pages.get(tabId);
      if (!entry) return null;
      let value = entry.decodeCache.get(key);
      if (value === undefined) {
        value = decode(decoder);
        entry.decodeCache.set(key, value);
      }
      return value;
    },
  };
}
