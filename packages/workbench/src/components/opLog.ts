import type { OpLogRecord } from '@shared/domain/ops';
import type { MenuItem } from '../state/contextMenu';
import { copyText } from '../util/clipboard';

// P132 Part 1 (§2.3): OpLogPanel.vue's own column contract — `columns` is a plain prop array
// rather than a slot-per-column scheme, so a consumer states its own column set (order + width)
// in one place and gets the header row for free. Kept out of the .vue file (a plain-object-typed
// default in a generic SFC's own defineProps has no factory to call it from) so it's importable
// from both OpLogPanel.vue and a Studio/Space wrapper's own .ts.
export interface OpLogColumn {
  id: string;
  label: string;
  /** A CSS grid-template-columns track, e.g. '90px' or '1fr'. */
  width: string;
}

export type OpLogStatusFilter = 'all' | 'running' | 'error';

// The default context-menu items every op-log row gets: Copy command, Copy error, Cancel — exactly
// today's OperationsPanel.vue (184-216) minus its two Studio-only items (Reveal originating tab,
// Re-run), which a wrapper adds itself by spreading this array in. `cancel` takes no id: every
// caller already has `record` closed over (the inline stop button and this function both do), so
// there's nothing for the id to disambiguate. `canCancel` false disables Cancel for a running row
// that cannot be cancelled (Space's push family).
export function opLogMenuItems<R extends OpLogRecord>(
  record: R,
  cancel: () => void,
  canCancel = true,
): MenuItem[] {
  return [
    {
      type: 'item',
      id: 'copy-command',
      label: 'Copy command',
      icon: 'copy',
      disabled: !record.command,
      run: () => copyText(record.command ?? ''),
    },
    {
      type: 'item',
      id: 'copy-error',
      label: 'Copy error',
      icon: 'copy',
      disabled: !record.error,
      run: () => copyText(record.error ?? ''),
    },
    {
      type: 'item',
      id: 'cancel',
      label: 'Cancel',
      icon: 'debug-stop',
      disabled: record.status !== 'running' || !canCancel,
      run: cancel,
    },
  ];
}
