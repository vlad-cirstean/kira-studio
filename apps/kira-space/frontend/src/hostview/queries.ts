import { useMutation, useQuery } from '@tanstack/vue-query';
import type { MaybeRefOrGetter } from 'vue';
import { toValue } from 'vue';
import { control } from '../bridge/control';

export const hostViewTargetKey = (windowKey: string) => ['hostview', 'target', windowKey] as const;
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

/** Opens (or focuses) the PR view window for a change request URL. */
export function useOpenHostView() {
  return useMutation({ mutationFn: (url: string) => control.hostViewOpen(url) });
}
