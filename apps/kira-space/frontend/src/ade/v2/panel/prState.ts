import { type MessageKey, t } from '@theme/i18n';
import type { Tone } from '../board/actions';

export const PR_TONE: Record<string, Tone> = {
  open: 'green',
  merged: 'purple',
  closed: 'red',
  draft: 'grey',
};

const PR_STATE = {
  open: 'common.action.open.label',
  merged: 'common.merged.status',
  closed: 'common.closed.status',
  draft: 'common.draft.status',
} as const satisfies Record<string, MessageKey>;

export const prStateLabel = (state: string): string =>
  state in PR_STATE ? t(PR_STATE[state as keyof typeof PR_STATE]) : state;
