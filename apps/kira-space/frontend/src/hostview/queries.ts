import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { t } from '@theme/i18n';
import { optimisticUpdate } from '@workbench/behaviour/optimistic';
import type { MaybeRefOrGetter } from 'vue';
import { toValue } from 'vue';
import { control } from '../bridge/control';
import type { HostViewChangeRequest, HostViewIssue, HostViewPosted } from './wire';

export const hostViewTargetKey = (windowKey: string) => ['hostview', 'target', windowKey] as const;
export const issueKey = (ref: string) => ['hostview', 'issue', ref] as const;
export const changeRequestKey = (url: string) => ['hostview', 'changeRequest', url] as const;

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

/** A post the host did not take: the result kind and its reason (a status reason or a reason word). */
export class PostRejected extends Error {
  constructor(
    readonly kind: HostViewPosted['kind'],
    readonly reason: string,
  ) {
    super(reason);
  }
}

export interface PostVars {
  body: string;
  replyTo: string;
}

type Cached = HostViewChangeRequest | HostViewIssue | undefined;

let pendingSeq = 0;

function withPending(old: Cached, kind: 'changeRequest' | 'issue', vars: PostVars): Cached {
  if (old?.kind !== 'ok' || !old.detail) return old;
  const id = `pending-${++pendingSeq}`;
  const createdAt = Date.now();
  const you = t('common.picker.you.label');
  if (kind === 'issue') {
    const detail = old.detail as NonNullable<HostViewIssue['detail']>;
    const comment = {
      id,
      author: { id: '', name: you },
      body: vars.body,
      createdAt,
      pending: true,
    };
    return {
      ...old,
      detail: { ...detail, comments: [...detail.comments, comment] },
    } as HostViewIssue;
  }
  const detail = old.detail as NonNullable<HostViewChangeRequest['detail']>;
  const comment = { id, author: { login: you }, body: vars.body, createdAt, pending: true };
  const threads = vars.replyTo
    ? detail.threads.map((th) =>
        th.id === vars.replyTo ? { ...th, comments: [...th.comments, comment] } : th,
      )
    : [...detail.threads, { id, kind: 'comment' as const, comments: [comment] }];
  return { ...old, detail: { ...detail, threads } } as HostViewChangeRequest;
}

/**
 * Posts a comment to this window's change request or issue. The comment shows at once, muted and
 * pending; a failure rolls the cache back and the composer keeps the text. The host's own copy
 * arrives with the refetch.
 */
export function usePostComment(opts: {
  windowKey: string;
  kind: 'changeRequest' | 'issue';
  queryKey: () => readonly unknown[];
}) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: PostVars) => {
      const res = await control.hostViewPostComment({ windowKey: opts.windowKey, ...vars });
      if (res.kind !== 'ok')
        throw new PostRejected(res.kind, res.status?.reason ?? res.reason ?? '');
      return res;
    },
    ...optimisticUpdate<Cached, PostVars>(
      qc,
      opts.queryKey(),
      (old, vars) => withPending(old, opts.kind, vars),
      { invalidate: 'settled' },
    ),
  });
}
