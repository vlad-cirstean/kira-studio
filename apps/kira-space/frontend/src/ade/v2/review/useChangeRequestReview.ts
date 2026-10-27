import type { ChangeRequestReviewEvent, ChangeRequestReviewState } from '@kira/git-ipc';
import { useMutation, useQuery } from '@tanstack/vue-query';
import { hostWords, t } from '@theme/i18n';
import { computed } from 'vue';
import { control } from '../../../bridge/control';
import { gitTransportFor } from '../../../repo/git/transport';
import { ensureRepoOpen } from '../../../state/repoOpenHold';
import type { ReviewWindowTarget } from '../wire';

type OkState = Extract<ChangeRequestReviewState, { kind: 'ok' }>;

const reviewStateKey = (gitRepoId: string, branch: string) =>
  ['changeRequestReviewState', gitRepoId, branch] as const;

export interface ReviewGate {
  enabled: boolean;
  reason: string;
}

/** Whether `event` can be submitted on the change request in `s`, and why not. */
export function reviewGate(s: OkState, event: ChangeRequestReviewEvent): ReviewGate {
  const words = hostWords(s.host);
  const vars = { short: words.changeRequestShort };
  if (s.state === 'merged')
    return { enabled: false, reason: t('space.ade.review.actions.merged.hint', vars) };
  if (s.state === 'closed')
    return { enabled: false, reason: t('space.ade.review.actions.closed.hint', vars) };
  if (s.own && event !== 'comment') {
    return { enabled: false, reason: t('space.ade.review.actions.own.hint', vars) };
  }
  return { enabled: true, reason: '' };
}

/** The review facts of the window's change request, the review and comment posts, and the open link. */
export function useChangeRequestReview(target: () => ReviewWindowTarget) {
  const key = computed(() => reviewStateKey(target().gitRepoId, target().branch));
  const transport = async () => {
    const tg = target();
    const tr = gitTransportFor(tg.codeRepoId);
    await ensureRepoOpen(tr, tg.gitRepoId);
    return tr;
  };
  const state = useQuery({
    queryKey: key,
    queryFn: async (): Promise<ChangeRequestReviewState> =>
      (await transport()).request('changeRequest.reviewState', {
        repoId: target().gitRepoId,
        branch: target().branch,
      }),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
  const submitReview = useMutation({
    mutationFn: async (a: {
      number: number;
      event: ChangeRequestReviewEvent;
      body: string;
      headSha: string;
    }) =>
      (await transport()).request('changeRequest.submitReview', {
        repoId: target().gitRepoId,
        ...a,
      }),
  });
  const comment = useMutation({
    mutationFn: async (a: { number: number; body: string }) =>
      (await transport()).request('changeRequest.comment', { repoId: target().gitRepoId, ...a }),
  });
  async function openChangeRequest(number: number): Promise<void> {
    const res = await (await transport()).request('changeRequest.browserUrl', {
      repoId: target().gitRepoId,
      number,
    });
    if (res.url !== null) await control.gitHostOpenChangeRequestUrl(res.url);
  }
  return { state, submitReview, comment, openChangeRequest };
}
