import { type MessageKey, t } from '@theme/i18n';

const PR_STATE_KEYS: Readonly<Record<string, MessageKey>> = {
  open: 'common.action.open.label',
  draft: 'git.pr.draft.status',
  merged: 'git.pr.merged.status',
  closed: 'git.pr.closed.status',
};

/** Display word for a pull request state; an unknown state shows as given. */
export function prStateLabel(state: string): string {
  const key = PR_STATE_KEYS[state];
  return key === undefined ? state : t(key);
}
