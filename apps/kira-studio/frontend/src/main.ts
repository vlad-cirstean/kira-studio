import type { CacheStats, CountRequestWire, CountResponse } from '@shared/protocol/data-ops';
import { pageChunks } from '@shared/protocol/page';
import { createApp } from 'vue';
import App from './App.vue';
import { control } from './bridge/control';
import { data } from './bridge/data';
import { knownConnectionIds } from './project/state/tree';
import { initAppMetrics } from './state/appMetrics';
import { initCacheStats } from './state/cacheStats';
import { hydrateConnections } from './state/connections';
import { hydrateOps } from './state/ops';
import { hydrateTabs } from './state/tabs';
import './theme/base.css';
import { hydrateLayout } from './state/layout';
import { hydrateSettings } from './state/settings';
import { planCount as consolePlanCount } from './views/console/explainResults';
import {
  pageStoreEntries as consolePageStoreEntries,
  totalRetainedBytes as consoleRetainedBytes,
} from './views/console/resultPages';
import { searchState as consoleSearchState } from './views/console/search';
import {
  pageStoreEntries as documentPageStoreEntries,
  totalRetainedBytes as documentRetainedBytes,
} from './views/documents/page';
import { searchState as documentSearchState } from './views/documents/search';
import { pageStoreEntries as gridPageStoreEntries, totalRetainedBytes } from './views/grid/page';
import {
  type ScrollTraceResult,
  start as startScrollTrace,
  stop as stopScrollTrace,
} from './views/grid/scrollTrace';
import { searchState as gridSearchState } from './views/grid/search';
import {
  pageStoreEntries as keyValuePageStoreEntries,
  totalRetainedBytes as keyValueRetainedBytes,
} from './views/keyvalue/page';
import { searchState as keyValueSearchState } from './views/keyvalue/search';
import { retentionSnapshot as documentRowsRetention } from './views/shared/document/rows';
import {
  pageStoreEntries as streamPageStoreEntries,
  totalRetainedBytes as streamRetainedBytes,
} from './views/stream/page';
import { searchState as streamSearchState } from './views/stream/search';
import { vTooltip } from './workbench/state/tooltip';

/** P5 C1: what `window.__kiraRetention` reports for one of the five page stores — the decode/view
 *  caches `__kiraRetainedBytes` cannot see, since that sums `page.byteSize` only (F2). */
interface KiraRetentionStoreStats {
  entries: number;
  pageBytes: number;
  decodeCacheRows: number;
  decodeCacheChars: number;
  viewCacheRows: number;
}

interface KiraRetentionSnapshot {
  stores: {
    grid: KiraRetentionStoreStats;
    documents: KiraRetentionStoreStats;
    keyvalue: KiraRetentionStoreStats;
    stream: KiraRetentionStoreStats;
    console: KiraRetentionStoreStats;
  };
  documentRows: { tabScopes: number; parseCacheRows: number; docNodeCount: number };
  searchMatches: {
    grid: number;
    documents: number;
    keyvalue: number;
    console: number;
    stream: number;
  };
  /** F8/C7: distinct `chunk.data.buffer` identities across every page every store holds, and
   *  their summed byte length — the one figure `totalRetainedBytes()` structurally cannot see,
   *  since a multi-page ExecuteResponse frame shares one ArrayBuffer across every page it carried. */
  frameBuffers: { count: number; bytes: number };
  /** explainResults.ts's own module-level plan store (P12 round 1 finding #10) — entirely
   *  separate from `stores.console` above, which only covers resultPages.ts's page store. */
  explainPlans: number;
}

function storeStats<P extends { byteSize: number }>(
  entries: readonly {
    page: P;
    decodeCacheRows: number;
    decodeCacheChars: number;
    viewCacheRows: number;
  }[],
): KiraRetentionStoreStats {
  let pageBytes = 0;
  let decodeCacheRows = 0;
  let decodeCacheChars = 0;
  let viewCacheRows = 0;
  for (const e of entries) {
    pageBytes += e.page.byteSize;
    decodeCacheRows += e.decodeCacheRows;
    decodeCacheChars += e.decodeCacheChars;
    viewCacheRows += e.viewCacheRows;
  }
  return { entries: entries.length, pageBytes, decodeCacheRows, decodeCacheChars, viewCacheRows };
}

function sumMatches(state: Record<string, { matches: readonly unknown[] }>): number {
  let n = 0;
  for (const entry of Object.values(state)) n += entry.matches.length;
  return n;
}

function frameBufferStats(allEntries: readonly { page: Parameters<typeof pageChunks>[0] }[]): {
  count: number;
  bytes: number;
} {
  const seen = new Set<ArrayBufferLike>();
  let bytes = 0;
  for (const { page } of allEntries) {
    for (const chunk of pageChunks(page)) {
      const buf = chunk.data.buffer;
      if (!seen.has(buf)) {
        seen.add(buf);
        bytes += buf.byteLength;
      }
    }
  }
  return { count: seen.size, bytes };
}

declare global {
  interface Window {
    /**
     * Playwright-only hook (tests/e2e/perf.spec.ts) — the exact §2.2 retained-bytes figure, so
     * "closing a tab frees its page immediately" can be asserted deterministically instead of
     * read off a flaky RSS sample. Grid-only, kept as-is so that assertion's meaning is unchanged.
     */
    __kiraGridRetainedBytes?: () => number;
    /** D5: the sum across all five page stores — what §2.2's symmetry assertion should see. */
    __kiraRetainedBytes?: () => number;
    /**
     * Playwright-only hooks (tests/e2e/leaks.spec.ts) — the same `data` bridge and tree-state
     * accessor the app itself uses, exposed so a leak regression test can drive many distinct
     * count() requests and read L3's entry count / the tree's live connection ids directly,
     * instead of round-tripping every one of them through real UI clicks.
     */
    __kiraCount?: (req: CountRequestWire) => Promise<CountResponse>;
    __kiraCacheStats?: () => Promise<CacheStats>;
    __kiraTreeConnectionIds?: () => string[];
    /**
     * Playwright-only hook (tests/e2e/budgets.spec.ts) — DataGrid.vue calls this, if a test has set
     * it, at the start of its scroll-driven work (inside its own coalescing rAF callback, after the
     * browser's native scroll-event-dispatch and rAF scheduling have both already resolved), so a
     * scroll-response budget can measure the app's actual work independent of display refresh rate.
     */
    __kiraGridScrollWorkStart?: (t: number) => void;
    /**
     * Playwright-only hook (P5 C1, tests/ui/leaks.spec.ts) — the renderer-retention probe: the
     * decode/view caches, the document parse cache, per-tab search matches and distinct retained
     * frame buffers that `__kiraRetainedBytes` cannot see (F2's own finding — that hook sums
     * `page.byteSize` only). Deterministic, engine-independent (no heap API) accounting for
     * structures §2's findings (F4-F8) are about.
     */
    __kiraRetention?: () => KiraRetentionSnapshot;
    /**
     * P22 iter2 D2: a real-fling scroll trace a human drives from DevTools on real hardware (a dev
     * build — View → Open DevTools, internal/shell/menutemplate.go) — NOT a Playwright hook, and
     * not gated in CI. See views/grid/scrollTrace.ts's own header comment and
     * docs/v1.1/plans/P22-webview-scroll-performance-iter2-rendering.md §7.3 for the protocol.
     */
    __kiraScrollTrace?: { start: () => void; stop: () => ScrollTraceResult | null };
  }
}
window.__kiraScrollTrace = { start: startScrollTrace, stop: stopScrollTrace };
window.__kiraGridRetainedBytes = totalRetainedBytes;
window.__kiraRetainedBytes = () =>
  totalRetainedBytes() +
  consoleRetainedBytes() +
  documentRetainedBytes() +
  keyValueRetainedBytes() +
  streamRetainedBytes();
window.__kiraRetention = () => {
  const gridEntries = gridPageStoreEntries();
  const documentEntries = documentPageStoreEntries();
  const keyValueEntries = keyValuePageStoreEntries();
  const streamEntries = streamPageStoreEntries();
  const consoleEntries = consolePageStoreEntries();
  return {
    stores: {
      grid: storeStats(gridEntries),
      documents: storeStats(documentEntries),
      keyvalue: storeStats(keyValueEntries),
      stream: storeStats(streamEntries),
      console: storeStats(consoleEntries),
    },
    documentRows: documentRowsRetention(),
    searchMatches: {
      grid: sumMatches(gridSearchState),
      documents: sumMatches(documentSearchState),
      keyvalue: sumMatches(keyValueSearchState),
      console: sumMatches(consoleSearchState),
      stream: sumMatches(streamSearchState),
    },
    frameBuffers: frameBufferStats([
      ...gridEntries,
      ...documentEntries,
      ...keyValueEntries,
      ...streamEntries,
      ...consoleEntries,
    ]),
    explainPlans: consolePlanCount(),
  };
};
window.__kiraCount = data.count;
window.__kiraCacheStats = data.cacheStats;
window.__kiraTreeConnectionIds = () => Array.from(knownConnectionIds());

async function bootstrap(): Promise<void> {
  initCacheStats();
  initAppMetrics();
  // Must complete before anything window-scoped below (hydrateTabs, in particular) — P8 D2:
  // always a no-op on the native shell, the only registration a `-tags server` browser tab ever
  // gets otherwise.
  await control.windowsEnsure();
  await Promise.all([
    hydrateLayout(),
    hydrateSettings(),
    hydrateConnections(),
    hydrateOps(),
    hydrateTabs(),
  ]);
  createApp(App).directive('tooltip', vTooltip).mount('#app');
}

void bootstrap();
