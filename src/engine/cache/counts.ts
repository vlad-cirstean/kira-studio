const TTL_MS = 5 * 60 * 1000;
const DROP_MS = 30 * 60 * 1000;

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
}

const store = new Map<string, StoredCount>();

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
  // Past the TTL the entry is returned stale — kept, not blanked (§7): the pager greys the
  // total and offers a refresh rather than losing the number outright.
  return { value: entry.value, exact: entry.exact, at: entry.at, stale: age > TTL_MS };
}

export function putCount(
  connectionId: string,
  path: string,
  filter: string | null,
  value: number,
  exact: boolean,
): void {
  store.set(keyFor(connectionId, path, filter), { value, exact, at: Date.now() });
}

export function dropCountTarget(connectionId: string, path: string): number {
  const prefix = `${connectionId}\0${path}\0`;
  let removed = 0;
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) {
      store.delete(key);
      removed++;
    }
  }
  return removed;
}

export function dropCountConnection(connectionId: string): number {
  const prefix = `${connectionId}\0`;
  let removed = 0;
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) {
      store.delete(key);
      removed++;
    }
  }
  return removed;
}

export function clearCounts(): void {
  store.clear();
}

export function countEntryCount(): number {
  return store.size;
}
