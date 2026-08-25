import { copyText } from '../../clipboard';
import type { MenuItem } from '../../state/contextMenu';

// Read-only view (P10's D13) — copy-only per-row menu, no edit/delete rows anywhere. Mirrors
// keyvalue/keyValueMenu.ts; key/body only (headers/attrs/timestamp are visible inline but rarely
// what someone wants to paste elsewhere).
export function streamMenu(key: string | null, body: string): MenuItem[] {
  const items: MenuItem[] = [];
  if (key !== null) {
    items.push({
      type: 'item',
      id: 'copy-key',
      label: 'Copy key',
      icon: 'copy',
      run: () => copyText(key),
    });
  }
  items.push({
    type: 'item',
    id: 'copy-body',
    label: 'Copy body',
    icon: 'copy',
    run: () => copyText(body),
  });
  return items;
}
