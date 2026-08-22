import type { SavedQuery } from '@shared/saved-query';
import { control } from '../../bridge/control';
import { countRows } from '../../bridge/port';
import { showStatusMessage } from './status';

// Saved filters / history access for a table (P2 D14). History and saved entries are the same rows
// distinguished by `name`; the storage module returns named-first. This module is the renderer-side
// read window plus a few helpers the menus and the filter toolbar share.

// Snapshot cache of named saved filters per (connection, path), for the tree's "Saved filters ▸"
// submenu (menus.ts) — populated by the FilterToolbar's history dropdown and on save.
const savedCache = new Map<string, SavedQuery[]>();
const cacheKey = (connectionId: string, path: string): string => `${connectionId}|${path}`;

export function cachedSavedFilters(connectionId: string, path: string): SavedQuery[] {
  return savedCache.get(cacheKey(connectionId, path)) ?? [];
}

export async function listSavedFilters(
  connectionId: string,
  path: string,
): Promise<SavedQuery[]> {
  const entries = await control.savedQueriesList({ connectionId, path, kind: 'filter' });
  savedCache.set(cacheKey(connectionId, path), entries);
  return entries;
}

export async function saveFilter(
  connectionId: string,
  path: string,
  name: string,
  body: { where: string; orderBy: string },
): Promise<SavedQuery> {
  const saved = await control.savedQueriesUpsert({ connectionId, path, name, kind: 'filter', body });
  // Refresh the cache so the tree submenu sees the new entry immediately.
  await listSavedFilters(connectionId, path);
  return saved;
}

export async function touchFilter(id: string): Promise<void> {
  await control.savedQueriesTouch({ id });
}

export async function deleteFilter(id: string): Promise<void> {
  await control.savedQueriesDelete({ id });
}

// Wired by the tab data module (Step 10+) so the tree's "Saved filters ▸" can re-read a tab after
// applying a filter. Set once at bootstrap; a no-op until then.
let _scheduleTabRead = (_tabId: string): void => {};
export function setTabReadScheduler(fn: (tabId: string) => void): void {
  _scheduleTabRead = fn;
}
export function scheduleTabRead(tabId: string): void {
  _scheduleTabRead(tabId);
}

// Count rows from the tree context menu (§8.10): runs an exact count and surfaces it without
// opening a tab. The status bar is the cheapest surface and needs no new UI (P2 open question 2).
export async function countRowsFor(connectionId: string, path: string): Promise<void> {
  const result = await countRows({
    connectionId,
    path,
    tabId: 'tree-count',
    where: '',
    mode: 'exact',
    refresh: true,
  });
  const name = path.split('/').at(-1)?.split(':').at(-1) ?? path;
  showStatusMessage(`${name}: ${result.value} rows`);
}
