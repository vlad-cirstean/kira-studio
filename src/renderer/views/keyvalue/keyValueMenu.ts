import type { KeyValuePage } from '@shared/protocol/page';
import { copyText } from '../../clipboard';
import type { MenuItem } from '../../workbench/state/contextMenu';

// Copy is always available; Edit/Delete are appended only when the connection's caps say so
// (KeyValueView.vue's `caps.canUpdate`/`caps.canDelete`, mirroring DataToolbar's writability
// gating). Edit is further scoped to string-type keys in this version (see
// engine/adapters/redis/mutate.ts's `assertEditableType` for why) — shown but disabled, with a
// label that says so, for every other type rather than simply omitted, so the limit is visible
// rather than looking like a missing feature.
export function keyValueMenu(opts: {
  field: string;
  value: string;
  redisType: KeyValuePage['redisType'];
  canUpdate: boolean;
  canDelete: boolean;
  onEdit: () => void;
  onDelete: () => void;
}): MenuItem[] {
  const items: MenuItem[] = [
    {
      type: 'item',
      id: 'copy-field',
      label: 'Copy field',
      icon: 'copy',
      run: () => copyText(opts.field),
    },
    {
      type: 'item',
      id: 'copy-value',
      label: 'Copy value',
      icon: 'copy',
      run: () => copyText(opts.value),
    },
  ];

  if (!opts.canUpdate && !opts.canDelete) return items;
  items.push({ type: 'separator' });

  if (opts.canUpdate) {
    const editable = opts.redisType === 'string';
    items.push({
      type: 'item',
      id: 'edit-value',
      label: editable ? 'Edit value' : 'Edit value (string keys only)',
      icon: 'edit',
      disabled: !editable,
      run: opts.onEdit,
    });
  }

  if (opts.canDelete) {
    // DEL is type-agnostic and removes the whole key, not just the clicked field/row — the
    // label says "key", not "row", so a right-click on one hash field doesn't read as deleting
    // only that field.
    items.push({
      type: 'item',
      id: 'delete-key',
      label: 'Delete key',
      icon: 'trash',
      danger: true,
      run: opts.onDelete,
    });
  }

  return items;
}
