// L1 (metadata) is deliberately not here — it lives in main's SQLite so the project panel
// renders while disconnected (P1 D10); moving it into the engine would tie tree rendering to a
// live utility process, which P1 designed away. This module is L2 (result pages) and L3
// (counts) only (D11). §11's "engine/cache/ holds L1/L2/L3" is superseded by that decision.
import type { CacheStats, ReadRequestWire } from '@shared/protocol/data-ops';
import type { Page } from '@shared/protocol/page';
import * as counts from './counts';
import * as pages from './pages';

export type { CountEntry } from './counts';
export { pageCacheKey } from './pages';

type StatsListener = (stats: CacheStats) => void;
const listeners = new Set<StatsListener>();
let lastEmitted: CacheStats | null = null;
let throttleTimer: ReturnType<typeof setTimeout> | null = null;

function currentStats(): CacheStats {
  const p = pages.pageStats();
  return {
    l2Bytes: p.bytes,
    l2BudgetBytes: p.budgetBytes,
    l2Entries: p.entries,
    l2Hits: p.hits,
    l2Misses: p.misses,
    l3Entries: counts.countEntryCount(),
  };
}

function statsChanged(next: CacheStats, prev: CacheStats | null): boolean {
  if (!prev) return true;
  return (Object.keys(next) as (keyof CacheStats)[]).some((k) => next[k] !== prev[k]);
}

// Throttled to at most 1 Hz (D16): an idle app posts nothing, and a burst of reads collapses
// into one emission carrying the latest numbers rather than one per read.
function scheduleEmit(): void {
  if (throttleTimer) return;
  throttleTimer = setTimeout(() => {
    throttleTimer = null;
    const stats = currentStats();
    if (statsChanged(stats, lastEmitted)) {
      lastEmitted = stats;
      for (const cb of listeners) cb(stats);
    }
  }, 1000);
}

export const cache = {
  configure(l2BudgetBytes: number): void {
    pages.configurePageBudget(l2BudgetBytes);
    scheduleEmit();
  },
  readPage(key: string): Page | undefined {
    const page = pages.getPage(key);
    scheduleEmit();
    return page;
  },
  storePage(key: string, label: string, req: ReadRequestWire, page: Page): void {
    pages.putPage(key, label, req, page);
    scheduleEmit();
  },
  count(connectionId: string, path: string, filter: string | null) {
    return counts.getCount(connectionId, path, filter);
  },
  storeCount(
    connectionId: string,
    path: string,
    filter: string | null,
    value: number,
    exact: boolean,
  ): void {
    counts.putCount(connectionId, path, filter, value, exact);
    scheduleEmit();
  },
  /** Explicit ↻ Refresh (DATA_OP.invalidate, scope 'all'): drops its pages and its counts hard. */
  dropTarget(connectionId: string, path: string): void {
    pages.dropTarget(connectionId, path);
    counts.dropCountTarget(connectionId, path);
    scheduleEmit();
  },
  /**
   * §7: a local mutation drops the target's pages (they may now be wrong) but only marks its
   * counts stale — the pager keeps the last known total, greyed, until the user asks to refresh.
   */
  invalidateAfterMutation(connectionId: string, path: string): void {
    pages.dropTarget(connectionId, path);
    counts.markCountTargetStale(connectionId, path);
    scheduleEmit();
  },
  /** DATA_OP.invalidate scope 'pages' — the post-mutation reload; leaves the stale count intact. */
  dropPagesOnly(connectionId: string, path: string): void {
    pages.dropTarget(connectionId, path);
    scheduleEmit();
  },
  /** Disconnect and connection-delete (§2.2: disconnecting releases all its cached pages). */
  dropConnection(connectionId: string): void {
    pages.dropConnection(connectionId);
    counts.dropCountConnection(connectionId);
    scheduleEmit();
  },
  clear(): void {
    pages.clearPages();
    counts.clearCounts();
    scheduleEmit();
  },
  stats(): CacheStats {
    return currentStats();
  },
  onStatsChanged(cb: StatsListener): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
};
