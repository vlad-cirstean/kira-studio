import { type MessageKey, t } from '@theme/i18n';

const PR_STATE_KEYS: Readonly<Record<string, MessageKey>> = {
  open: 'common.action.open.label',
  draft: 'common.draft.status',
  merged: 'common.merged.status',
  closed: 'common.closed.status',
};

/** Display word for a pull request state; an unknown state shows as given. */
export function prStateLabel(state: string): string {
  const key = PR_STATE_KEYS[state];
  return key === undefined ? state : t(key);
}
