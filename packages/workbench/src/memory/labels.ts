import type { MemoryAuthor, MemoryEvent } from '@shared/domain/memory';
import { type MessageKey, t } from '@theme/i18n';

export const AUTHOR_LABEL = {
  user: 'memory.common.author.user.label',
  agent: 'memory.common.author.agent.label',
} as const satisfies Record<MemoryAuthor, MessageKey>;

const ACTION_LABEL = {
  noop: 'memory.start.event.action.reconfirmed.status',
  add: 'memory.add.outcome.added.status',
  update: 'memory.start.event.action.updated.status',
} as const satisfies Record<MemoryEvent['action'], MessageKey>;

const SOURCE_LABEL = {
  mcp: 'memory.start.event.source.mcp.label',
  ui: 'memory.start.event.source.ui.label',
  import: 'memory.start.event.source.import.label',
} as const satisfies Record<MemoryEvent['source'], MessageKey>;

/** One line of a version's trail: what happened, by whom, through which door, and why. */
export function eventText(event: MemoryEvent): string {
  const params = {
    action: t(ACTION_LABEL[event.action]),
    author: t(AUTHOR_LABEL[event.author]),
    source: t(SOURCE_LABEL[event.source]),
    label: event.sourceLabel ?? event.sourceRef ?? '',
    rationale: event.rationale,
  };
  const labelled = event.source === 'import';
  if (labelled && event.rationale) return t('memory.start.event.withBoth.label', params);
  if (labelled) return t('memory.start.event.withLabel.label', params);
  if (event.rationale) return t('memory.start.event.withRationale.label', params);
  return t('memory.start.event.plain.label', params);
}
