import { ByteLru } from './lru';

const TTL_MS = 5 * 60 * 1000;
const DROP_MS = 30 * 60 * 1000;

// Nominal, not measured (P13 D19): an entry is four scalars plus a key, the variance between
// entries is noise, and a fixed cost keeps L3 the same `ByteLru` shape as L2 instead of a
// separate accounting scheme. ~2 000 entries before eviction — well past any realistic browsing
// session, while still a real bound (was an unbounded `Map`, docs/v1/PERF.md §4 item 1).
const COUNT_ENTRY_BYTES = 128;
const L3_BUDGET_BYTES = 256 * 1024;

export interface CountEntry {
  value: number;
  exact: boolean;
  at: number;
  stale: boolean;
}

interface StoredCount {
  value: number;
  exact: boolean;
  at: number;
  stale: boolean;
}

const store = new ByteLru<StoredCount>(L3_BUDGET_BYTES);

// '\0' can't appear in a connectionId (uuid) or an encoded path, so it's a safe separator.
function keyFor(connectionId: string, path: string, filter: string | null): string {
  return `${connectionId}\0${path}\0${filter ?? ''}`;
}

export function getCount(
  connectionId: string,
  path: string,
  filter: string | null,
): CountEntry | undefined {
  const key = keyFor(connectionId, path, filter);
  const entry = store.get(key);
  if (!entry) return undefined;
  const age = Date.now() - entry.at;
  if (age > DROP_MS) {
    store.delete(key);
    return undefined;
  }
  // Past the TTL, or explicitly marked stale by a local mutation (§7, D18), the entry is
  // returned stale — kept, not blanked: the pager greys the total and offers a refresh rather
  // than losing the number outright.
  return {
    value: entry.value,
    exact: entry.exact,
    at: entry.at,
    stale: entry.stale || age > TTL_MS,
  };
}

export function putCount(
  connectionId: string,
  path: string,
  filter: string | null,
  value: number,
  exact: boolean,
): void {
  store.set(
    keyFor(connectionId, path, filter),
    { value, exact, at: Date.now(), stale: false },
    COUNT_ENTRY_BYTES,
    { connectionId, path, label: filter ?? '' },
  );
}

/**
 * §7: a local mutation marks a target's counts stale instead of dropping them — the pager keeps
 * showing the last known total, greyed, with a refresh affordance, rather than going blank.
 */
export function markCountTargetStale(connectionId: string, path: string): number {
  let marked = 0;
  for (const entry of store.entries()) {
    if (entry.meta.connectionId !== connectionId || entry.meta.path !== path) continue;
    const current = store.get(entry.key);
    if (!current || current.stale) continue;
    store.set(entry.key, { ...current, stale: true }, COUNT_ENTRY_BYTES, entry.meta);
    marked++;
  }
  return marked;
}

export function dropCountTarget(connectionId: string, path: string): number {
  return store.deleteWhere((meta) => meta.connectionId === connectionId && meta.path === path);
}

export function dropCountConnection(connectionId: string): number {
  return store.deleteWhere((meta) => meta.connectionId === connectionId);
}

export function clearCounts(): void {
  store.clear();
}

export function countEntryCount(): number {
  return store.size;
}
