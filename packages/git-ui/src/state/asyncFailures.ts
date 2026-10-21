import type { MessageKey } from '@theme/i18n';

/** Fire-and-forget calls whose rejection reaches the live region (`error`, with the backend
 *  detail) and the failure banner (`title`). */
export interface AsyncFailure {
  readonly title: MessageKey;
  readonly error: MessageKey;
}

export const ASYNC_FAILURES = {
  reloadGraph: { title: 'git.async.reloadGraph.title', error: 'git.async.reloadGraph.error' },
  scrollToSelected: {
    title: 'git.async.scrollToSelected.title',
    error: 'git.async.scrollToSelected.error',
  },
  revealSelected: {
    title: 'git.async.revealSelected.title',
    error: 'git.async.revealSelected.error',
  },
  loadMoreHistory: {
    title: 'git.async.loadMoreHistory.title',
    error: 'git.async.loadMoreHistory.error',
  },
  refresh: { title: 'git.async.refresh.title', error: 'git.async.refresh.error' },
  revealCommit: { title: 'git.async.revealCommit.title', error: 'git.async.revealCommit.error' },
  openChangeRequest: {
    title: 'git.async.openChangeRequest.title',
    error: 'git.async.openChangeRequest.error',
  },
} as const satisfies Record<string, AsyncFailure>;
