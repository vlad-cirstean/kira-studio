import type { QueuePanel } from './useQueue';
import type { AdeWorkType } from './wire';

export const WORK_TYPE_LABEL: Record<AdeWorkType, string> = {
  work: 'Mine: to work',
  investigate: 'Mine: to investigate',
  review: 'To review',
  test: 'To test',
};

export interface WorkTypeOption {
  value: AdeWorkType;
  label: string;
  disabled: boolean;
  tip: string;
}

const NEW_WORK_TYPES: readonly AdeWorkType[] = ['work', 'investigate'];
const BRANCH_TYPES: readonly AdeWorkType[] = ['work', 'investigate', 'review', 'test'];

/** New work offers two kinds. A branch offers four; review and test stay disabled while a
 *  dependency blocks it (Go refuses the same write with `ErrWorkTypeBlocked`). */
export function workTypeOptions(
  panel: Pick<QueuePanel, 'isNewWork' | 'blockers'>,
): WorkTypeOption[] {
  const blocked = panel.blockers.length > 0;
  return (panel.isNewWork ? NEW_WORK_TYPES : BRANCH_TYPES).map((value) => {
    const disabled = blocked && (value === 'review' || value === 'test');
    return {
      value,
      label: WORK_TYPE_LABEL[value],
      disabled,
      tip: disabled ? 'Unlink its dependencies first' : '',
    };
  });
}
