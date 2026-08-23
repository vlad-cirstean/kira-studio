import { copyText } from '../../clipboard';
import type { MenuItem } from '../../workbench/state/contextMenu';

// Read-only view (P9's D2) — copy-only per-row menu, no edit/delete rows anywhere.
export function keyValueMenu(field: string, value: string): MenuItem[] {
  return [
    {
      type: 'item',
      id: 'copy-field',
      label: 'Copy field',
      icon: 'copy',
      run: () => copyText(field),
    },
    {
      type: 'item',
      id: 'copy-value',
      label: 'Copy value',
      icon: 'copy',
      run: () => copyText(value),
    },
  ];
}
