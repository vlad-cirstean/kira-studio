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
        const current = tab?.state.projection ?? null;
        if (current?.includes(columnName)) return;
        void dataQueryCommands().setProjection(
          tabId,
          current ? [...current, columnName] : [columnName],
        );
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
