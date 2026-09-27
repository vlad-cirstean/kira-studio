import type { QueryClient } from '@tanstack/vue-query';
import { useMutation } from '@tanstack/vue-query';
import { queryClient } from '@workbench/state/queryClient';
import type { MaybeRefOrGetter } from 'vue';
import { toValue } from 'vue';
import { control } from '../bridge/control';
import { adeCandidatesKey, adePrsKey, adeSessionsKey, adeSnapshotKey } from './queries';
import type {
  AdeAddBranchArgs,
  AdeAddNewWorkArgs,
  AdeArchiveArgs,
  AdeArchiveRisk,
  AdeBindNewWorkArgs,
  AdeForcePushArgs,
  AdeForcePushResult,
  AdeLaunch,
  AdePrepareLaunchArgs,
  AdeRepoSnapshot,
  AdeSendArgs,
  AdeSetBranchMetaArgs,
  AdeSetPlanArgs,
  AdeSetQueuedAfterArgs,
  AdeUpdateNewWorkArgs,
} from './wire';

// P129 Part 4 §2.4: the TanStack layer over the six §2.3 control members, plus the archive-risk
// fetch. `mutationFn` wraps one raw RPC each (Part 3's own `useAdeRefresh` shape) — delivery
// *sequencing* (arming the turn watcher, per-root ordering, the draft's `UpdateNewWork`-before-
// launch step) is `dialogFlow.ts`'s own job, injected these mutations' `mutateAsync` as plain
// deps (`launch.ts`'s `LaunchDeps`, `dialogFlow.ts`'s `SendDialogDeps`) so it stays testable
// without Vue. Every mutation's key is prefixed `['ade','deliver',repo]` so the dialog's Send
// button can read one shared `useIsMutating` pending state across all of them (§2.4).

function adeArchiveRiskKey(codeRepoId: string, item: string) {
  return ['ade', 'archiveRisk', codeRepoId, item] as const;
}

/** Always fresh (`staleTime: 0`, §0.16 step 1) — a stale risk read could miss changes an agent just
 *  made. The key still lets Part 6's header read the same cache entry once it lands. */
export function fetchArchiveRisk(
  qc: QueryClient,
  codeRepoId: string,
  item: string,
): Promise<AdeArchiveRisk> {
  return qc.fetchQuery({
    queryKey: adeArchiveRiskKey(codeRepoId, item),
    queryFn: (): Promise<AdeArchiveRisk> => control.adeArchiveRisk({ codeRepoId, item }),
    staleTime: 0,
  });
}

/** `['ade','deliver',repo]`'s own shared prefix (§2.4) — every mutation below nests one more
 *  segment under it, so `useIsMutating({ mutationKey: ['ade','deliver',repo] })` (a fuzzy prefix
 *  match, TanStack's own default) catches every one of them for that repo. */
function deliverKey(codeRepoId: string, kind: string) {
  return ['ade', 'deliver', codeRepoId, kind] as const;
}

export function useAdeSend(codeRepoId: MaybeRefOrGetter<string>) {
  return useMutation(() => ({
    mutationKey: deliverKey(toValue(codeRepoId), 'send'),
    mutationFn: (args: AdeSendArgs): Promise<void> => control.adeSend(args),
  }));
}

/** PrepareLaunch only — `launch.ts`'s own `deliver()` calls `terminalsStore.openTerminalSession`
 *  itself right after, outside any mutation (a Pinia store action, not a cached RPC), so it can arm
 *  the turn watcher in the gap between the two (§0.15). */
export function useAdeLaunch(codeRepoId: MaybeRefOrGetter<string>) {
  return useMutation(() => ({
    mutationKey: deliverKey(toValue(codeRepoId), 'launch'),
    mutationFn: (args: AdePrepareLaunchArgs): Promise<AdeLaunch> => control.adePrepareLaunch(args),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: adeSessionsKey, exact: true });
    },
  }));
}

export function useAdeArchive(codeRepoId: MaybeRefOrGetter<string>) {
  return useMutation(() => ({
    mutationKey: deliverKey(toValue(codeRepoId), 'archive'),
    mutationFn: (args: AdeArchiveArgs): Promise<void> => control.adeArchive(args),
    onSettled: () => {
      const id = toValue(codeRepoId);
      void queryClient.invalidateQueries({ queryKey: adeSnapshotKey(id), exact: true });
      void queryClient.invalidateQueries({ queryKey: adePrsKey(id), exact: true });
    },
  }));
}

export function useAdeSetQueuedAfter(codeRepoId: MaybeRefOrGetter<string>) {
  return useMutation(() => ({
    mutationKey: deliverKey(toValue(codeRepoId), 'setQueuedAfter'),
    mutationFn: (args: AdeSetQueuedAfterArgs): Promise<void> => control.adeSetQueuedAfter(args),
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: adeSnapshotKey(toValue(codeRepoId)),
        exact: true,
      });
    },
  }));
}

export function useAdeUpdateNewWork(codeRepoId: MaybeRefOrGetter<string>) {
  return useMutation(() => ({
    mutationKey: deliverKey(toValue(codeRepoId), 'updateNewWork'),
    mutationFn: (args: AdeUpdateNewWorkArgs): Promise<void> => control.adeUpdateNewWork(args),
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: adeSnapshotKey(toValue(codeRepoId)),
        exact: true,
      });
    },
  }));
}

/** P129 Part 6 §0.12: the detail panel's own field writes for a real branch (`useItemMeta.ts`'s
 *  first caller) — review items only ever send `notes` (Go refuses the rest; the UI hides those
 *  inputs, so this mutation never needs to know the difference). */
export function useAdeSetBranchMeta(codeRepoId: MaybeRefOrGetter<string>) {
  return useMutation(() => ({
    mutationKey: deliverKey(toValue(codeRepoId), 'setBranchMeta'),
    mutationFn: (args: AdeSetBranchMetaArgs): Promise<void> => control.adeSetBranchMeta(args),
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: adeSnapshotKey(toValue(codeRepoId)),
        exact: true,
      });
    },
  }));
}

/** §0.15: the candidate picker's own resolution — binds an ambiguous draft to the branch Claude
 *  actually created, so both the snapshot (the item moves from new-work to branch) and the
 *  sessions list (the same session now reports that branch) need a fresh read. */
export function useAdeBindNewWork(codeRepoId: MaybeRefOrGetter<string>) {
  return useMutation(() => ({
    mutationKey: deliverKey(toValue(codeRepoId), 'bindNewWork'),
    mutationFn: (args: AdeBindNewWorkArgs): Promise<void> => control.adeBindNewWork(args),
    onSettled: () => {
      const id = toValue(codeRepoId);
      void queryClient.invalidateQueries({ queryKey: adeSnapshotKey(id), exact: true });
      void queryClient.invalidateQueries({ queryKey: adeSessionsKey, exact: true });
    },
  }));
}

/** P129 Part 5 §0.15: `SetPlan` is optimistic — a drop moves no DOM of its own (`timelineOps.ts` is
 *  pure), so without this the dropped box would sit at its old day until the refetch. TanStack's own
 *  documented optimistic-update shape: `onMutate` cancels the in-flight snapshot query, snapshots it,
 *  writes the merged `plan.day`/`plan.order`; `onError` restores it; `onSettled` invalidates last. */
export function useAdeSetPlan(codeRepoId: MaybeRefOrGetter<string>) {
  return useMutation(() => ({
    mutationKey: deliverKey(toValue(codeRepoId), 'setPlan'),
    mutationFn: (args: AdeSetPlanArgs): Promise<void> => control.adeSetPlan(args),
    onMutate: async (args: AdeSetPlanArgs) => {
      const key = adeSnapshotKey(toValue(codeRepoId));
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<AdeRepoSnapshot>(key);
      if (previous) {
        queryClient.setQueryData<AdeRepoSnapshot>(key, {
          ...previous,
          plan: {
            ...previous.plan,
            day: { ...previous.plan.day, ...args.days },
            order: args.order,
          },
        });
      }
      return { previous };
    },
    onError: (_err, _args, context) => {
      if (context?.previous) {
        queryClient.setQueryData(adeSnapshotKey(toValue(codeRepoId)), context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: adeSnapshotKey(toValue(codeRepoId)),
        exact: true,
      });
    },
  }));
}

/** §0.16: not optimistic — a force push's own outcome (ok/protected/other error) per branch is
 *  read straight off the result, and the confirm-and-retry loop lives in `adeActions.ts`. */
export function useAdeForcePush(codeRepoId: MaybeRefOrGetter<string>) {
  return useMutation(() => ({
    mutationKey: deliverKey(toValue(codeRepoId), 'forcePush'),
    mutationFn: (args: AdeForcePushArgs): Promise<AdeForcePushResult[]> =>
      control.adeForcePush(args),
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: adeSnapshotKey(toValue(codeRepoId)),
        exact: true,
      });
    },
  }));
}

/** §0.19: New-work tab's own "Add to Later" — invalidates the snapshot (the new row) and the
 *  candidates list (§0.19: a fresh draft has no branch yet, so it never appears there anyway, but
 *  invalidating both queue-writes identically keeps this mutation and `useAdeAddBranch` symmetric). */
export function useAdeAddNewWork(codeRepoId: MaybeRefOrGetter<string>) {
  return useMutation(() => ({
    mutationKey: deliverKey(toValue(codeRepoId), 'addNewWork'),
    mutationFn: (args: AdeAddNewWorkArgs): Promise<string> => control.adeAddNewWork(args),
    onSettled: () => {
      const id = toValue(codeRepoId);
      void queryClient.invalidateQueries({ queryKey: adeSnapshotKey(id), exact: true });
      void queryClient.invalidateQueries({ queryKey: adeCandidatesKey(id), exact: true });
    },
  }));
}

/** §0.19: Existing-branch tab's own pick — the queued branch must both appear in the snapshot and
 *  drop off the candidates list. */
export function useAdeAddBranch(codeRepoId: MaybeRefOrGetter<string>) {
  return useMutation(() => ({
    mutationKey: deliverKey(toValue(codeRepoId), 'addBranch'),
    mutationFn: (args: AdeAddBranchArgs): Promise<string> => control.adeAddBranch(args),
    onSettled: () => {
      const id = toValue(codeRepoId);
      void queryClient.invalidateQueries({ queryKey: adeSnapshotKey(id), exact: true });
      void queryClient.invalidateQueries({ queryKey: adeCandidatesKey(id), exact: true });
    },
  }));
}
