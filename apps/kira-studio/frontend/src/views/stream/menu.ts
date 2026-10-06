import type { MenuItem } from '@workbench/state/contextMenu';
import { copyOrReportError } from '@workbench/util/clipboard';

// Read-only view (P10's D13) — copy-only per-row menu, no edit/delete rows anywhere. Mirrors
// keyvalue/menu.ts; key/body only (no body for a tombstone) (headers/attrs/timestamp are visible inline but rarely
// what someone wants to paste elsewhere).
export function rowMenu(
  key: string | null,
  body: string | null,
  onError: (message: string) => void,
): MenuItem[] {
  const items: MenuItem[] = [];
  if (key !== null) {
    items.push({
      type: 'item',
      id: 'copy-key',
      label: 'Copy key',
      icon: 'copy',
      run: () => copyOrReportError(key, onError),
    });
  }
  if (body !== null) {
    items.push({
      type: 'item',
      id: 'copy-body',
      label: 'Copy body',
      icon: 'copy',
      run: () => copyOrReportError(body, onError),
    });
  }
  return items;
}
