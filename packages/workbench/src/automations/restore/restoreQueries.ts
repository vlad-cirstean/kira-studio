import type { ScriptRunRestoreChoice } from '@shared/domain/scriptRuns';
import { useMutation, useQuery } from '@tanstack/vue-query';
import { queryClient } from '@workbench/state/queryClient';
import { useAutomationsModule } from '../module';

// Server state for the restart offer. The Go side pushes nothing for it, so the query refetches on
// mount, window focus and after each mutation.
const RUNS_KEY = ['scriptRuns'] as const;
const RESTORE_KEY = [...RUNS_KEY, 'restore'] as const;

export function useRunsRestoreState() {
  const { runs } = useAutomationsModule();
  return useQuery(
    {
      queryKey: RESTORE_KEY,
      queryFn: () => runs.restoreState(),
      staleTime: 0,
      refetchOnMount: 'always',
      refetchOnWindowFocus: true,
    },
    queryClient,
  );
}

// Started runs leave the offer and the run list gains them.
const settle = () => queryClient.invalidateQueries({ queryKey: RUNS_KEY });

export function useRestoreRuns() {
  const { runs } = useAutomationsModule();
  return useMutation(
    {
      mutationKey: [...RESTORE_KEY, 'start'],
      mutationFn: (items: ScriptRunRestoreChoice[]) => runs.restore(items),
      onSettled: settle,
    },
    queryClient,
  );
}

export function useDismissRunsRestore() {
  const { runs } = useAutomationsModule();
  return useMutation(
    {
      mutationKey: [...RESTORE_KEY, 'dismiss'],
      mutationFn: () => runs.restoreDismiss(),
      onSettled: settle,
    },
    queryClient,
  );
}
