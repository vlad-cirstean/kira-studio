import type { AgentEvent } from '@shared/domain/agent';
import { queryOptions, useMutation, useQuery } from '@tanstack/vue-query';
import { tryOnScopeDispose, useDebounceFn, useWindowFocus } from '@vueuse/core';
import { TIMING } from '@workbench/behaviour/timing';
import { queryClient } from '@workbench/state/queryClient';
import { type MaybeRefOrGetter, toValue, watch } from 'vue';
import { control } from '../../../bridge/control';
import type { ReviewWindowTarget, ReviewWorkingMarkArgs } from '../wire';

// The uncommitted files of a review window's branch worktree, and each file's diff. List and diffs
// share one key prefix so a single invalidation re-reads them all.
const reviewWorkingPrefix = ['adetask', 'reviewWorking'] as const;

const reviewWorkingKey = (branchId: string) => [...reviewWorkingPrefix, branchId] as const;

/** Re-reads the uncommitted list and every open diff; a refused write calls it to show the disk. */
export function invalidateReviewWorking(): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: reviewWorkingPrefix });
}

export function reviewWorkingDiffOptions(branchId: string, path: string) {
  return queryOptions({
    queryKey: [...reviewWorkingKey(branchId), 'diff', path] as const,
    queryFn: () => control.adeTaskReviewWorkingDiff({ branchId, path }),
    staleTime: 0,
  });
}

export function useReviewWorking(branchId: MaybeRefOrGetter<string>) {
  return useQuery({
    queryKey: [...reviewWorkingPrefix, branchId] as const,
    queryFn: () => control.adeTaskReviewWorking({ branchId: toValue(branchId) }),
  });
}

export function useReviewWorkingDiff(
  branchId: MaybeRefOrGetter<string>,
  path: MaybeRefOrGetter<string>,
) {
  return useQuery({
    queryKey: [...reviewWorkingPrefix, branchId, 'diff', path] as const,
    queryFn: () =>
      control.adeTaskReviewWorkingDiff({ branchId: toValue(branchId), path: toValue(path) }),
    enabled: () => toValue(branchId) !== '',
  });
}

/** Marks uncommitted files reviewed or not; the list and every diff re-read afterwards. */
export function useReviewWorkingMark() {
  return useMutation({
    mutationFn: (args: ReviewWorkingMarkArgs) => control.adeTaskReviewWorkingMark(args),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: reviewWorkingPrefix }),
  });
}

/** Agent hook events that follow a file write or the end of a turn. */
const SETTLE_EVENTS = new Set(['PostToolUse', 'Stop']);

function isInside(cwd: string, root: string): boolean {
  return root !== '' && (cwd === root || cwd.startsWith(`${root}/`));
}

/** Keeps the uncommitted queries fresh: a board push (commit, stage, checkout), window focus, and
 *  agent activity inside the worktree. There is no polling; an edit made elsewhere shows on refocus. */
export function useReviewWorkingSync(target: () => ReviewWindowTarget | null): void {
  const invalidate = (): void => {
    void invalidateReviewWorking();
  };
  const invalidateSoon = useDebounceFn(invalidate, TIMING.fileSettle);
  const focused = useWindowFocus();
  watch(focused, (now, was) => {
    if (now && !was) invalidate();
  });
  const stops = [
    control.onAdeTaskBoard(invalidate),
    control.onAgentEvent((event: AgentEvent) => {
      const root = target()?.worktree ?? '';
      if (SETTLE_EVENTS.has(event.event) && isInside(event.cwd, root)) void invalidateSoon();
    }),
  ];
  tryOnScopeDispose(() => {
    for (const stop of stops) stop();
  });
}
