import { copyText } from '../../clipboard';
import type { MenuItem } from '../../state/contextMenu';
import { activeTab } from '../../state/mode';
import { findDataTab, openDataTab } from '../../state/tabs';
import { dataQueryCommands } from '../../state/viewCommands';

// D9: the definition view's Columns section reuses the tree's former column-row menu items, but it
// already has the table's own path directly (`tab.path`) — no `pathParent()` needed the way the
// tree's former column rows required.
function targetTabForTable(connectionId: string, tablePath: string): string {
  const active = activeTab.value;
  // D9: this menu lives only in the Definition view's Columns section, so `active` here is
  // always that table's *definition* tab, never its data tab — matching on connectionId/path
  // alone would reuse the definition tab itself and silently no-op the projection/sort patch
  // (patchDataTabState only writes to a 'data'-kind record).
  if (
    active &&
    active.kind === 'data' &&
    active.connectionId === connectionId &&
    active.path === tablePath
  ) {
    return active.id;
  }
  return openDataTab(connectionId, tablePath).id;
}

// F1/P21 round 1: the pure half of "Add to projection". `currentProjection === null` means "every
// column shown" (ResolveProjection's own meaning for it) — the named column is already in it, so
// there is nothing to do; a `null` return here means exactly that ("no update needed"), never "set
// the projection to null" — the caller below never forwards it to setProjection. The old
// `current ? [...current, columnName] : [columnName]` treated a null projection the same as an
// empty one and replaced "everything" with just this one column, the exact opposite of what "Add"
// says and reading as data loss ("my grid lost all its columns").
export function nextProjectionAfterAddingColumn(
  currentProjection: string[] | null,
  columnName: string,
): string[] | null {
  if (currentProjection === null || currentProjection.includes(columnName)) return null;
  return [...currentProjection, columnName];
}

export function columnsSectionMenu(
  connectionId: string,
  tablePath: string,
  columnName: string,
): MenuItem[] {
  return [
    {
      type: 'item',
      id: 'copy-name',
      label: 'Copy name',
      icon: 'copy',
      run: () => copyText(columnName),
    },
    {
      type: 'item',
      id: 'add-to-projection',
      label: 'Add to projection',
      icon: 'list-selection',
      run: () => {
        const tabId = targetTabForTable(connectionId, tablePath);
        const tab = findDataTab(tabId);
        const next = nextProjectionAfterAddingColumn(tab?.state.projection ?? null, columnName);
        if (next === null) return;
        void dataQueryCommands().setProjection(tabId, next);
      },
    },
    {
      type: 'item',
      id: 'sort-by',
      label: 'Sort by',
      icon: 'sort-precedence',
      run: () => {
        const tabId = targetTabForTable(connectionId, tablePath);
        void dataQueryCommands().setSort(tabId, {
          kind: 'structured',
          terms: [{ column: columnName, direction: 'asc' }],
        });
      },
    },
  ];
}
