import type { QueueItem } from './useQueue';

/** Row and its action-column cell share one height, so cells stay aligned. */
export function rowHeightClass(item: Pick<QueueItem, 'jira'> | undefined): 'h-14' | 'h-10' {
  return item?.jira ? 'h-14' : 'h-10';
}
