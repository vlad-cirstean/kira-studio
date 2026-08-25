import { createHash } from 'node:crypto';
import type { SortSpec } from '@shared/domain/queries';
import type { ReadRequestWire } from '@shared/protocol/data-ops';
import type { Page } from '@shared/protocol/page';
import { ByteLru } from './lru';

const DEFAULT_BUDGET_BYTES = 64 * 1024 * 1024; // matches defaultSettings.cache.l2BudgetMb

function canonicalSort(sort: SortSpec | null): string | null {
  if (!sort) return null;
  if (sort.kind === 'text') return `text:${sort.text}`;
  return `structured:${sort.terms.map((t) => `${t.column}:${t.direction}`).join(',')}`;
}

// D12: normalisation is what turns "the user re-picked the same three columns in a different
// order" into a cache hit. `cursor` is included — each page/cursor pair is its own entry.
function normalizedRequest(req: ReadRequestWire) {
  return {
    connectionId: req.connectionId,
    path: req.path,
    projection: req.projection ? [...req.projection].sort() : null,
    filter: req.filter && req.filter.trim() !== '' ? req.filter.trim() : null,
    sort: canonicalSort(req.sort),
    pageSize: req.pageSize,
    cursor: req.cursor,
  };
}

export function pageCacheKey(req: ReadRequestWire): { key: string; label: string } {
  const label = JSON.stringify(normalizedRequest(req));
  const key = createHash('sha1').update(label).digest('hex');
  return { key, label };
}

let hits = 0;
let misses = 0;
const store = new ByteLru<Page>(DEFAULT_BUDGET_BYTES);

export function configurePageBudget(bytes: number): void {
  store.setBudget(bytes);
}

export function getPage(key: string): Page | undefined {
  const page = store.get(key);
  if (page) hits++;
  else misses++;
  return page;
}

export function putPage(key: string, label: string, req: ReadRequestWire, page: Page): void {
  store.set(key, page, page.byteSize, { connectionId: req.connectionId, path: req.path, label });
}

export function dropTarget(connectionId: string, path: string): number {
  return store.deleteWhere((meta) => meta.connectionId === connectionId && meta.path === path);
}

export function dropConnection(connectionId: string): number {
  return store.deleteWhere((meta) => meta.connectionId === connectionId);
}

export function clearPages(): void {
  store.clear();
  // Hit rate is read as "since last clear" in two user-facing places (StatusBar, Settings →
  // Cache) — a rate spanning a cache the user just emptied would be a stale, misleading number.
  hits = 0;
  misses = 0;
}

export function pageStats(): {
  bytes: number;
  budgetBytes: number;
  entries: number;
  hits: number;
  misses: number;
} {
  return { bytes: store.bytes, budgetBytes: store.budgetBytes, entries: store.size, hits, misses };
}
