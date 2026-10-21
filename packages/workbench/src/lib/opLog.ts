import type { OpLogRecord } from '@shared/domain/ops';
import { t } from '@theme/i18n';
import { copyAndAnnounce } from '../behaviour/clipboard';
import type { MenuItem } from '../state/contextMenu';

// OpLogPanel.vue's own column contract — `columns` is a plain prop array
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
  copy: (text: string, opts: { message: string }) => Promise<boolean> = (text, { message }) =>
    copyAndAnnounce(text, message),
): MenuItem[] {
  return [
    {
      type: 'item',
      id: 'copy-command',
      label: t('common.copyCommand.label'),
      icon: 'copy',
      disabled: !record.command,
      run: () =>
        void copy(record.command ?? '', { message: t('workbench.opLog.copiedCommand.announce') }),
    },
    {
      type: 'item',
      id: 'copy-error',
      label: t('workbench.opLog.copyError.label'),
      icon: 'copy',
      disabled: !record.error,
      run: () =>
        void copy(record.error ?? '', { message: t('workbench.opLog.copiedError.announce') }),
    },
    {
      type: 'item',
      id: 'cancel',
      label: t('common.action.cancel.label'),
      icon: 'debug-stop',
      disabled: record.status !== 'running' || !canCancel,
      run: cancel,
    },
  ];
}
