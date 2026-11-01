import { useMutation, useQuery } from '@tanstack/vue-query';
import type { MaybeRefOrGetter } from 'vue';
import { toValue } from 'vue';
import { control } from '../bridge/control';

export const hostViewTargetKey = (windowKey: string) => ['hostview', 'target', windowKey] as const;
const issueKey = (ref: string) => ['hostview', 'issue', ref] as const;
const changeRequestKey = (url: string) => ['hostview', 'changeRequest', url] as const;

/**
 * One change request's detail. A host failure arrives as data (kind unavailable or gone), not as a
 * query error, so Retry and Refresh are both a refetch. The client defaults never refetch on focus:
 * the window refreshes on demand only.
 */
export function useChangeRequestDetail(url: MaybeRefOrGetter<string>) {
  return useQuery(() => ({
    queryKey: changeRequestKey(toValue(url)),
    queryFn: () => control.hostViewChangeRequest({ url: toValue(url) }),
  }));
}

/** One issue's detail, by key or link. A tracker failure is data, like a host failure above. */
export function useIssueDetail(ref: MaybeRefOrGetter<string>) {
  return useQuery(() => ({
    queryKey: issueKey(toValue(ref)),
    queryFn: () => control.hostViewIssue({ ref: toValue(ref) }),
  }));
}

/** Opens (or focuses) the view window for a change request URL or an issue key or link. */
export function useOpenHostView() {
  return useMutation({ mutationFn: (urlOrKey: string) => control.hostViewOpen(urlOrKey) });
}
