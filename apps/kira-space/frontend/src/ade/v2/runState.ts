import { type MessageKey, t } from '@theme/i18n';

const RUN_STATE = {
  done: 'common.done.status',
  failed: 'common.state.failed.status',
  stuck: 'common.needsYou.status',
  back: 'space.ade.outcome.back.status',
  running: 'common.state.running.status',
  pending: 'space.common.pending.status',
  skipped: 'common.skipped.status',
} as const satisfies Record<string, MessageKey>;

/** A run's state as the user reads it; an unknown state shows as sent. */
export function runStateLabel(state: string): string {
  return state in RUN_STATE ? t(RUN_STATE[state as keyof typeof RUN_STATE]) : state;
}
