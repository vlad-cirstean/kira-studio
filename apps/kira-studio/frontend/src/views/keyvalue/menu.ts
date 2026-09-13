import type { KeyValuePage } from '@shared/protocol/page';
import { copyText } from '../../clipboard';
import type { MenuItem } from '../../state/contextMenu';

// Copy is always available; Download/Edit/Delete are appended only when the connection's caps say
// so (KeyValueView.vue's `caps.fileTransfer`/`canUpdate`/`canDelete`, mirroring DataToolbar's
// writability gating). Edit's `editable`/`editUnavailableLabel` pair is the caller's own gate
// result — Redis scopes edit to string-type keys (see engine/adapters/redis/mutate.ts's
// `assertEditableType`); S3 scopes it by size/truncation/UTF-8-validity (P33 D6/D7,
// KeyValueView.vue's `objectEditGate`) — shown but disabled, with a label that says why, rather
// than simply omitted, so the limit is visible rather than looking like a missing feature.
export function rowMenu(opts: {
  field: string;
  value: string;
  redisType: KeyValuePage['redisType'];
  canUpdate: boolean;
  canDelete: boolean;
  canDownload: boolean;
  editable: boolean;
  editUnavailableLabel: string;
  onEdit: () => void;
  onDelete: () => void;
  onDownload: () => void;
}): MenuItem[] {
  const isObject = opts.redisType === 'object';
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

  if (opts.canDownload) {
    items.push({ type: 'separator' });
    items.push({
      type: 'item',
      id: 'download-object',
      label: 'Download…',
      icon: 'cloud-download',
      run: opts.onDownload,
    });
  }

  if (!opts.canUpdate && !opts.canDelete) return items;
  items.push({ type: 'separator' });

  if (opts.canUpdate) {
    items.push({
      type: 'item',
      id: 'edit-value',
      label: opts.editable ? 'Edit value' : opts.editUnavailableLabel,
      icon: 'edit',
      disabled: !opts.editable,
      run: opts.onEdit,
    });
  }

  if (opts.canDelete) {
    // DEL/DeleteObject are type-agnostic and remove the whole item, not just the clicked
    // field/row — the label says "key"/"object", not "row", so a right-click on one hash field
    // or one object metadata row doesn't read as deleting only that field.
    items.push({
      type: 'item',
      id: 'delete-key',
      label: isObject ? 'Delete object' : 'Delete key',
      icon: 'trash',
      danger: true,
      run: opts.onDelete,
    });
  }

  return items;
}
