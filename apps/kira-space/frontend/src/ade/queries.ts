import type { QueryClient } from '@tanstack/vue-query';
import { useMutation, useQuery } from '@tanstack/vue-query';
import { queryClient } from '@workbench/state/queryClient';
import type { MaybeRefOrGetter } from 'vue';
import { toValue } from 'vue';
import { control } from '../bridge/control';
import { useCodeReposStore } from '../state/coderepos';
import { useGitCredentialStore } from '../state/gitCredential';
import { useAdeUiStore } from './state/adeUi';
import type { AdeRefreshResult, AdeRepoPrs, AdeRepoSnapshot, AdeSessionsResult } from './wire';

// P129 Part 3 §0.11/§2.4: query keys follow queryClient.ts's flat `[domain, ...ids]` convention,
// every one `staleTime: Infinity` — the client already has `retry: false`/
// `refetchOnWindowFocus: false`, and freshness here is entirely push-driven (installAdeSignals
// below): a missing invalidation should surface as a bug, not hide behind remount churn, and a
// snapshot read is real git work per repo tab switch (§0.11's own reasoning).

export const adeSessionsKey = ['ade', 'sessions'] as const;

export function adeSnapshotKey(codeRepoId: string) {
  return ['ade', 'snapshot', codeRepoId] as const;
}

export function adePrsKey(codeRepoId: string) {
  return ['ade', 'prs', codeRepoId] as const;
}

export function adeRefreshKey(codeRepoId: string) {
  return ['ade', 'refresh', codeRepoId] as const;
}

export function useAdeSessions() {
  return useQuery({
    queryKey: adeSessionsKey,
    queryFn: (): Promise<AdeSessionsResult> => control.adeSessions(),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useAdeSnapshot(codeRepoId: MaybeRefOrGetter<string>) {
  return useQuery(() => ({
    queryKey: adeSnapshotKey(toValue(codeRepoId)),
    queryFn: (): Promise<AdeRepoSnapshot> => control.adeRepoSnapshot(toValue(codeRepoId)),
    staleTime: Number.POSITIVE_INFINITY,
    enabled: toValue(codeRepoId) !== '',
  }));
}

export function useAdePrs(codeRepoId: MaybeRefOrGetter<string>) {
  return useQuery(() => ({
    queryKey: adePrsKey(toValue(codeRepoId)),
    queryFn: (): Promise<AdeRepoPrs> => control.adeRepoPrs(toValue(codeRepoId)),
    staleTime: Number.POSITIVE_INFINITY,
    enabled: toValue(codeRepoId) !== '',
  }));
}

/** §2.4: pending state is read via `useIsMutating({ mutationKey })` at the call site (not this
 *  mutation's own `isPending`), so the "Refreshing…" state survives a repo-tab remount — the
 *  mutation object itself is torn down with whatever component created it, but the mutation cache
 *  entry (and its key) is not. */
export function useAdeRefresh(codeRepoId: MaybeRefOrGetter<string>) {
  const adeUiStore = useAdeUiStore();
  return useMutation(() => ({
    mutationKey: adeRefreshKey(toValue(codeRepoId)),
    mutationFn: (): Promise<AdeRefreshResult> => control.adeRefresh(toValue(codeRepoId)),
    onSettled: (result, error) => {
      const id = toValue(codeRepoId);
      if (error) {
        adeUiStore.recordRefresh(id, {
          kind: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
      } else if (result) {
        adeUiStore.recordRefresh(id, {
          kind: 'ok',
          refsChanged: result.refsChanged,
          newlyMerged: result.newlyMerged,
        });
      }
      void queryClient.invalidateQueries({ queryKey: adeSnapshotKey(id), exact: true });
      void queryClient.invalidateQueries({ queryKey: adePrsKey(id), exact: true });
    },
  }));
}

/** §0.14: `kira:ade:credential`'s `repoId` maps through `codeReposStore` (every window hydrates it
 *  at boot), not the snapshot cache — the focused window may never have loaded that repo's
 *  snapshot at all. An unmapped `repoId` still enqueues with `codeRepoId: ''` (no repo label, but
 *  still answerable) rather than dropping the prompt. */
function installAdeCredentialSignal(): () => void {
  return control.onAdeCredential((request) => {
    const codeRepoId =
      useCodeReposStore().records.find((r) => r.repoId === request.repoId)?.id ?? '';
    useGitCredentialStore().enqueueCredentialRequest({
      codeRepoId,
      prompt: request.prompt,
      masked: request.masked,
      answer: (secret: string | null) => {
        void control.adeProvideCredential(request.requestId, secret).catch(() => {
          /* the broker's own 120s bound already ended the wait — nothing to log or recover
           * (repo/git/transport.ts's own identical precedent). */
        });
      },
    });
  });
}

/** Called once from `main.ts`, app lifetime — no teardown, the window is the lifetime (§2.4). The
 *  three §0.11 push subscriptions plus the §0.14 credential handler; every invalidation targets an
 *  exact key so an unrelated repo's cached snapshot/prs is left alone. */
export function installAdeSignals(queryClient: QueryClient): void {
  control.onAdeSessions(() => {
    void queryClient.invalidateQueries({ queryKey: adeSessionsKey, exact: true });
  });

  control.onAdeRepo((event) => {
    void queryClient.invalidateQueries({ queryKey: adeSnapshotKey(event.codeRepoId), exact: true });
    void queryClient.invalidateQueries({ queryKey: adePrsKey(event.codeRepoId), exact: true });
  });

  // §0.11: a session's own `Stop` invalidates its repo's snapshot (Part 2's own obligation for the
  // linked-worktree dirty state Claude's edits leave behind) — the repo is looked up in the cached
  // `['ade','sessions']` data, never a second round trip.
  control.onAgentEvent((event) => {
    if (event.event !== 'Stop') return;
    const sessions = queryClient.getQueryData<AdeSessionsResult>(adeSessionsKey)?.sessions ?? [];
    const session = sessions.find((s) => s.terminalId === event.terminalId);
    if (!session) return;
    void queryClient.invalidateQueries({
      queryKey: adeSnapshotKey(session.codeRepoId),
      exact: true,
    });
  });

  installAdeCredentialSignal();
}
