import type { CountRequest, ReadRequest } from '../shared/data';
import type { TabularPage } from '../shared/page';
import { cursorKey } from '../shared/page';
import type { CacheStats } from '../shared/port';

// L2 (result pages) + L3 (counts) cache, both in the engine (P2 D10). L1 metadata stays in main's
// SQLite; main holds no page bytes. L2 is a byte-budgeted LRU (eviction pops from the insertion
// front — a Map is insertion-ordered, so `delete`+`set` on hit = LRU). L3 is TTL'd per §7. The
// keys are exactly §7's `{connectionId, path, filter, projection, sort, pageSize, pageToken}`.

export interface CacheConfig {
  l2BudgetBytes: number;
  l3TtlMs: number;
}

const defaultConfig: CacheConfig = {
  l2BudgetBytes: 64 * 1024 * 1024,
  l3TtlMs: 300_000,
};

let config: CacheConfig = { ...defaultConfig };

const l2 = new Map<string, TabularPage>();
let l2Bytes = 0;

const l3 = new Map<string, { value: number; exact: boolean; at: number }>();

const hits = { l2: 0, l3: 0 };
const misses = { l2: 0, l3: 0 };

let loggedOversize = false;

function connOfKey(key: string): string {
  return key.split('|')[0];
}

function connPathOfKey(key: string): { connectionId: string; path: string } {
  // key layout: connectionId|path|where|projection|orderBy|pageSize|cursorKey (path contains no '|').
  const [connectionId, path, ..._rest] = key.split('|');
  return { connectionId, path };
}

export function l2Key(req: ReadRequest): string {
  return [
    req.connectionId,
    req.path,
    req.where,
    JSON.stringify(req.projection),
    req.orderBy,
    req.pageSize,
    cursorKey(req.cursor),
  ].join('|');
}

export function l3Key(req: CountRequest): string {
  return [req.connectionId, req.path, req.where, req.mode].join('|');
}

export function l2Get(key: string): TabularPage | undefined {
  const page = l2.get(key);
  if (page) {
    hits.l2 += 1;
    // LRU: move to the back of the insertion order.
    l2.delete(key);
    l2.set(key, page);
  } else {
    misses.l2 += 1;
  }
  return page;
}

export function l2Put(key: string, page: TabularPage): void {
  if (page.bytes > config.l2BudgetBytes) {
    // A single page larger than the whole budget is not cached — and must not evict everything.
    if (!loggedOversize) {
      loggedOversize = true;
      console.error(
        `[engine:cache] page of ${page.bytes} bytes exceeds L2 budget of ${config.l2BudgetBytes}; not cached`,
      );
    }
    return;
  }
  const existing = l2.get(key);
  if (existing) {
    l2Bytes -= existing.bytes;
    l2.delete(key);
  }
  l2.set(key, page);
  l2Bytes += page.bytes;
  evict();
}

function evict(): void {
  for (const [k, page] of l2) {
    if (l2Bytes <= config.l2BudgetBytes) break;
    l2Bytes -= page.bytes;
    l2.delete(k);
  }
}

export function l3Get(key: string): { value: number; exact: boolean; at: number } | undefined {
  const entry = l3.get(key);
  if (!entry) {
    misses.l3 += 1;
    return undefined;
  }
  if (Date.now() - entry.at > config.l3TtlMs) {
    l3.delete(key);
    misses.l3 += 1;
    return undefined;
  }
  hits.l3 += 1;
  return entry;
}

export function l3Put(key: string, v: { value: number; exact: boolean }): void {
  l3.set(key, { ...v, at: Date.now() });
}

export function dropConnection(connectionId: string): void {
  for (const key of l2.keys()) {
    if (connOfKey(key) === connectionId) {
      l2Bytes -= l2.get(key)?.bytes ?? 0;
      l2.delete(key);
    }
  }
  for (const key of l3.keys()) {
    if (connOfKey(key) === connectionId) l3.delete(key);
  }
}

/** Prefix match on (connectionId, path), both tiers — used by refreshing describe/children. */
export function dropPath(connectionId: string, path: string): void {
  const prefix = `${connectionId}|${path}`;
  for (const key of l2.keys()) {
    if (key.startsWith(prefix)) {
      l2Bytes -= l2.get(key)?.bytes ?? 0;
      l2.delete(key);
    }
  }
  for (const key of l3.keys()) {
    if (key.startsWith(prefix)) l3.delete(key);
  }
}

export function clearAll(): void {
  l2.clear();
  l2Bytes = 0;
  l3.clear();
}

export function stats(): CacheStats {
  return {
    l2Bytes,
    l2Entries: l2.size,
    l2Budget: config.l2BudgetBytes,
    l2Hits: hits.l2,
    l2Misses: misses.l2,
    l3Entries: l3.size,
    l3Hits: hits.l3,
    l3Misses: misses.l3,
  };
}

export function configure(cfg: Partial<CacheConfig>): void {
  if (cfg.l2BudgetBytes !== undefined) {
    config.l2BudgetBytes = cfg.l2BudgetBytes;
    evict();
  }
  if (cfg.l3TtlMs !== undefined) config.l3TtlMs = cfg.l3TtlMs;
}

export function cacheKeyParts(key: string): { connectionId: string; path: string } {
  return connPathOfKey(key);
}
